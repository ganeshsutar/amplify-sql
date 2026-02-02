import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { RouteContext, RouteDefinition } from '../handler';

/**
 * Audit Log operations (read-only)
 */

function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(body),
  };
}

/**
 * List audit logs
 * GET /api/audit-logs
 */
async function listAuditLogs(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  const queryParams = event.queryStringParameters || {};
  const limit = Math.min(parseInt(queryParams.limit || '100'), 500);
  const offset = parseInt(queryParams.offset || '0');
  const userId = queryParams.userId;
  const entityType = queryParams.entityType;
  const entityId = queryParams.entityId;
  const action = queryParams.action;
  const startDate = queryParams.startDate;
  const endDate = queryParams.endDate;

  const where: Record<string, unknown> = {};

  if (userId) where.userId = userId;
  if (entityType) where.entityType = entityType;
  if (entityId) where.entityId = entityId;
  if (action) where.action = action;

  // Date range filter
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) {
      (where.createdAt as Record<string, Date>).gte = new Date(startDate);
    }
    if (endDate) {
      (where.createdAt as Record<string, Date>).lte = new Date(endDate);
    }
  }

  const logs = await ctx.prisma.auditLog.findMany({
    where,
    include: {
      user: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
  });

  const total = await ctx.prisma.auditLog.count({ where });

  return jsonResponse(200, {
    data: logs,
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + logs.length < total,
    },
  });
}

/**
 * Get audit log by ID
 * GET /api/audit-logs/:id
 */
async function getAuditLog(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  const id = event.pathParameters?.id;
  if (!id) {
    return jsonResponse(400, { error: 'Audit Log ID is required' });
  }

  const log = await ctx.prisma.auditLog.findUnique({
    where: { id },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  });

  if (!log) {
    return jsonResponse(404, { error: 'Audit Log not found' });
  }

  return jsonResponse(200, { data: log });
}

/**
 * Get audit history for a specific entity
 * GET /api/audit-logs/entity/:entityType/:entityId
 */
async function getEntityHistory(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  const entityType = event.pathParameters?.entityType;
  const entityId = event.pathParameters?.entityId;

  if (!entityType || !entityId) {
    return jsonResponse(400, { error: 'Entity type and ID are required' });
  }

  const logs = await ctx.prisma.auditLog.findMany({
    where: {
      entityType,
      entityId,
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  return jsonResponse(200, {
    data: logs,
    entityType,
    entityId,
  });
}

// Route definitions
export const auditLogRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    path: /^\/api\/audit-logs$/,
    handler: listAuditLogs,
  },
  {
    method: 'GET',
    path: /^\/api\/audit-logs\/entity\/(?<entityType>[^/]+)\/(?<entityId>[^/]+)$/,
    handler: getEntityHistory,
  },
  {
    method: 'GET',
    path: /^\/api\/audit-logs\/(?<id>[^/]+)$/,
    handler: getAuditLog,
  },
];
