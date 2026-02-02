import {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  Context,
} from 'aws-lambda';
import { PrismaClient } from '@prisma/client';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

// Route handlers
import { todoRoutes } from './routes/todos';
import { userRoutes } from './routes/users';
import { organizationRoutes } from './routes/organizations';
import { productRoutes } from './routes/products';
import { categoryRoutes } from './routes/categories';
import { warehouseRoutes } from './routes/warehouses';
import { stockRoutes } from './routes/stock';
import { supplierRoutes } from './routes/suppliers';
import { purchaseOrderRoutes } from './routes/purchase-orders';
import { customerRoutes } from './routes/customers';
import { orderRoutes } from './routes/orders';
import { auditLogRoutes } from './routes/audit-logs';

// Types
export interface RouteContext {
  prisma: PrismaClient;
  userId: string;
  userEmail: string;
  organizationId?: string;
}

export interface RouteHandler {
  (
    event: APIGatewayProxyEventV2,
    context: RouteContext
  ): Promise<APIGatewayProxyResultV2>;
}

export interface RouteDefinition {
  method: string;
  path: RegExp;
  handler: RouteHandler;
}

// Global Prisma client (reused across invocations)
let prisma: PrismaClient | null = null;
let databaseUrl: string | null = null;

// Secrets Manager client
const secretsManager = new SecretsManagerClient({});

/**
 * Get database credentials from Secrets Manager and build connection URL
 */
async function getDatabaseUrl(): Promise<string> {
  if (databaseUrl) {
    return databaseUrl;
  }

  const secretArn = process.env.DATABASE_SECRET_ARN;
  if (!secretArn) {
    throw new Error('DATABASE_SECRET_ARN environment variable not set');
  }

  const response = await secretsManager.send(
    new GetSecretValueCommand({ SecretId: secretArn })
  );

  if (!response.SecretString) {
    throw new Error('Secret value is empty');
  }

  const secret = JSON.parse(response.SecretString);
  const { username, password, host, port, dbname } = secret;

  // Use RDS Proxy endpoint from environment or fall back to direct host
  const proxyHost = process.env.DATABASE_URL?.match(/@([^:]+):/)?.[1] || host;
  const dbName = dbname || 'appdb';
  const dbPort = port || 5432;

  databaseUrl = `postgresql://${username}:${encodeURIComponent(password)}@${proxyHost}:${dbPort}/${dbName}?schema=public&connection_limit=1`;

  return databaseUrl;
}

/**
 * Get or create Prisma client
 */
async function getPrismaClient(): Promise<PrismaClient> {
  if (prisma) {
    return prisma;
  }

  const url = await getDatabaseUrl();

  prisma = new PrismaClient({
    datasources: {
      db: { url },
    },
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

  // Test connection
  await prisma.$connect();

  return prisma;
}

/**
 * Extract user information from JWT claims in the event
 */
function extractUserFromEvent(event: APIGatewayProxyEventV2): {
  userId: string;
  userEmail: string;
} {
  const claims = event.requestContext.authorizer?.jwt?.claims;

  if (!claims) {
    throw new Error('No JWT claims found in request');
  }

  const userId = claims.sub as string;
  const userEmail = claims.email as string;

  if (!userId) {
    throw new Error('User ID (sub) not found in JWT claims');
  }

  return { userId, userEmail: userEmail || '' };
}

/**
 * All route definitions
 */
const routes: RouteDefinition[] = [
  // Todos
  ...todoRoutes,
  // Users
  ...userRoutes,
  // Organizations
  ...organizationRoutes,
  // Products
  ...productRoutes,
  // Categories
  ...categoryRoutes,
  // Warehouses
  ...warehouseRoutes,
  // Stock
  ...stockRoutes,
  // Suppliers
  ...supplierRoutes,
  // Purchase Orders
  ...purchaseOrderRoutes,
  // Customers
  ...customerRoutes,
  // Orders
  ...orderRoutes,
  // Audit Logs
  ...auditLogRoutes,
];

/**
 * Match a route based on method and path
 */
function matchRoute(
  method: string,
  path: string
): { route: RouteDefinition; params: Record<string, string> } | null {
  for (const route of routes) {
    if (route.method !== method && route.method !== 'ANY') {
      continue;
    }

    const match = path.match(route.path);
    if (match) {
      // Extract named groups from regex match
      const params = match.groups || {};
      return { route, params };
    }
  }

  return null;
}

/**
 * Create a JSON response
 */
function jsonResponse(
  statusCode: number,
  body: unknown,
  headers: Record<string, string> = {}
): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Credentials': 'true',
      ...headers,
    },
    body: JSON.stringify(body),
  };
}

/**
 * Main Lambda handler
 */
export async function handler(
  event: APIGatewayProxyEventV2,
  lambdaContext: Context
): Promise<APIGatewayProxyResultV2> {
  const startTime = Date.now();

  // Log request (minimal in production)
  console.log('Request:', {
    method: event.requestContext.http.method,
    path: event.rawPath,
    requestId: lambdaContext.awsRequestId,
  });

  try {
    // Health check endpoint (no auth required)
    if (event.rawPath === '/health') {
      const prismaClient = await getPrismaClient();
      await prismaClient.$queryRaw`SELECT 1`;

      return jsonResponse(200, {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        latency: Date.now() - startTime,
      });
    }

    // Get Prisma client
    const prismaClient = await getPrismaClient();

    // Extract user from JWT (for authenticated routes)
    let userId = '';
    let userEmail = '';

    try {
      const user = extractUserFromEvent(event);
      userId = user.userId;
      userEmail = user.userEmail;
    } catch (error) {
      // For routes that don't require auth (like health), this is fine
      if (!event.rawPath.startsWith('/api/')) {
        return jsonResponse(401, { error: 'Unauthorized' });
      }
    }

    // Match route
    const method = event.requestContext.http.method;
    const path = event.rawPath;

    const matched = matchRoute(method, path);

    if (!matched) {
      return jsonResponse(404, {
        error: 'Not Found',
        message: `No route found for ${method} ${path}`,
      });
    }

    // Add path parameters to event
    if (matched.params) {
      event.pathParameters = {
        ...event.pathParameters,
        ...matched.params,
      };
    }

    // Create route context
    const routeContext: RouteContext = {
      prisma: prismaClient,
      userId,
      userEmail,
    };

    // Execute handler
    const response = await matched.route.handler(event, routeContext);

    // Log response time
    console.log('Response:', {
      statusCode: response.statusCode,
      latency: Date.now() - startTime,
    });

    return response;
  } catch (error) {
    console.error('Error:', error);

    // Handle known error types
    if (error instanceof Error) {
      if (error.message.includes('Unauthorized')) {
        return jsonResponse(401, { error: 'Unauthorized' });
      }

      if (error.message.includes('Not found') || error.message.includes('not found')) {
        return jsonResponse(404, { error: error.message });
      }

      if (error.message.includes('Validation') || error.message.includes('Invalid')) {
        return jsonResponse(400, { error: error.message });
      }
    }

    // Generic error
    return jsonResponse(500, {
      error: 'Internal Server Error',
      message: process.env.NODE_ENV === 'development' ? String(error) : undefined,
    });
  }
}
