import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { RouteContext, RouteDefinition } from '../handler';

/**
 * User management operations
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
 * Get current user profile
 * GET /api/users/me
 */
async function getCurrentUser(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  let user = await ctx.prisma.user.findUnique({
    where: { cognitoSub: ctx.userId },
    include: {
      organization: true,
      roles: {
        include: {
          role: true,
        },
      },
    },
  });

  if (!user) {
    // Auto-create user on first access
    user = await ctx.prisma.user.create({
      data: {
        cognitoSub: ctx.userId,
        email: ctx.userEmail,
      },
      include: {
        organization: true,
        roles: {
          include: {
            role: true,
          },
        },
      },
    });
  }

  // Update last login
  await ctx.prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  return jsonResponse(200, { data: user });
}

/**
 * Update current user profile
 * PUT /api/users/me
 */
async function updateCurrentUser(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  if (!event.body) {
    return jsonResponse(400, { error: 'Request body is required' });
  }

  const body = JSON.parse(event.body);

  const user = await ctx.prisma.user.findUnique({
    where: { cognitoSub: ctx.userId },
  });

  if (!user) {
    return jsonResponse(404, { error: 'User not found' });
  }

  // Allowed fields for self-update
  const updateData: Record<string, unknown> = {};
  if (body.firstName !== undefined) updateData.firstName = body.firstName;
  if (body.lastName !== undefined) updateData.lastName = body.lastName;
  if (body.phone !== undefined) updateData.phone = body.phone;
  if (body.avatarUrl !== undefined) updateData.avatarUrl = body.avatarUrl;

  const updatedUser = await ctx.prisma.user.update({
    where: { id: user.id },
    data: updateData,
    include: {
      organization: true,
      roles: {
        include: {
          role: true,
        },
      },
    },
  });

  return jsonResponse(200, { data: updatedUser });
}

/**
 * List all users (admin only)
 * GET /api/users
 */
async function listUsers(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  const queryParams = event.queryStringParameters || {};
  const limit = Math.min(parseInt(queryParams.limit || '50'), 100);
  const offset = parseInt(queryParams.offset || '0');
  const organizationId = queryParams.organizationId;
  const isActive = queryParams.isActive ? queryParams.isActive === 'true' : undefined;

  // Get current user to check permissions
  const currentUser = await ctx.prisma.user.findUnique({
    where: { cognitoSub: ctx.userId },
    include: {
      roles: {
        include: { role: true },
      },
    },
  });

  if (!currentUser) {
    return jsonResponse(404, { error: 'User not found' });
  }

  // Check if user has admin role
  const isAdmin = currentUser.roles.some(
    (ur) => ur.role.name === 'Admin' || ur.role.permissions?.toString().includes('users:read')
  );

  // Build filter - non-admins can only see users in their organization
  const where: Record<string, unknown> = {};
  if (!isAdmin && currentUser.organizationId) {
    where.organizationId = currentUser.organizationId;
  } else if (organizationId) {
    where.organizationId = organizationId;
  }
  if (isActive !== undefined) {
    where.isActive = isActive;
  }

  const users = await ctx.prisma.user.findMany({
    where,
    include: {
      organization: true,
      roles: {
        include: { role: true },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
  });

  const total = await ctx.prisma.user.count({ where });

  return jsonResponse(200, {
    data: users,
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + users.length < total,
    },
  });
}

/**
 * Get user by ID (admin only)
 * GET /api/users/:id
 */
async function getUser(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  const id = event.pathParameters?.id;
  if (!id) {
    return jsonResponse(400, { error: 'User ID is required' });
  }

  const user = await ctx.prisma.user.findUnique({
    where: { id },
    include: {
      organization: true,
      roles: {
        include: { role: true },
      },
    },
  });

  if (!user) {
    return jsonResponse(404, { error: 'User not found' });
  }

  return jsonResponse(200, { data: user });
}

/**
 * Create a new user (admin only)
 * POST /api/users
 */
async function createUser(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  if (!event.body) {
    return jsonResponse(400, { error: 'Request body is required' });
  }

  const body = JSON.parse(event.body);

  if (!body.cognitoSub || !body.email) {
    return jsonResponse(400, { error: 'cognitoSub and email are required' });
  }

  // Check for existing user
  const existing = await ctx.prisma.user.findFirst({
    where: {
      OR: [{ cognitoSub: body.cognitoSub }, { email: body.email }],
    },
  });

  if (existing) {
    return jsonResponse(409, { error: 'User with this email or Cognito ID already exists' });
  }

  const user = await ctx.prisma.user.create({
    data: {
      cognitoSub: body.cognitoSub,
      email: body.email,
      firstName: body.firstName,
      lastName: body.lastName,
      phone: body.phone,
      organizationId: body.organizationId,
    },
    include: {
      organization: true,
    },
  });

  // Assign roles if provided
  if (body.roleIds && Array.isArray(body.roleIds)) {
    await ctx.prisma.userRole.createMany({
      data: body.roleIds.map((roleId: string) => ({
        userId: user.id,
        roleId,
      })),
    });
  }

  return jsonResponse(201, { data: user });
}

/**
 * Update a user (admin only)
 * PUT /api/users/:id
 */
async function updateUser(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  const id = event.pathParameters?.id;
  if (!id) {
    return jsonResponse(400, { error: 'User ID is required' });
  }

  if (!event.body) {
    return jsonResponse(400, { error: 'Request body is required' });
  }

  const body = JSON.parse(event.body);

  const existingUser = await ctx.prisma.user.findUnique({
    where: { id },
  });

  if (!existingUser) {
    return jsonResponse(404, { error: 'User not found' });
  }

  const updateData: Record<string, unknown> = {};
  if (body.firstName !== undefined) updateData.firstName = body.firstName;
  if (body.lastName !== undefined) updateData.lastName = body.lastName;
  if (body.phone !== undefined) updateData.phone = body.phone;
  if (body.avatarUrl !== undefined) updateData.avatarUrl = body.avatarUrl;
  if (body.isActive !== undefined) updateData.isActive = body.isActive;
  if (body.organizationId !== undefined) updateData.organizationId = body.organizationId;

  const user = await ctx.prisma.user.update({
    where: { id },
    data: updateData,
    include: {
      organization: true,
      roles: {
        include: { role: true },
      },
    },
  });

  // Update roles if provided
  if (body.roleIds && Array.isArray(body.roleIds)) {
    // Remove existing roles
    await ctx.prisma.userRole.deleteMany({
      where: { userId: id },
    });

    // Add new roles
    await ctx.prisma.userRole.createMany({
      data: body.roleIds.map((roleId: string) => ({
        userId: id,
        roleId,
      })),
    });
  }

  return jsonResponse(200, { data: user });
}

/**
 * Delete a user (admin only)
 * DELETE /api/users/:id
 */
async function deleteUser(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  const id = event.pathParameters?.id;
  if (!id) {
    return jsonResponse(400, { error: 'User ID is required' });
  }

  const existingUser = await ctx.prisma.user.findUnique({
    where: { id },
  });

  if (!existingUser) {
    return jsonResponse(404, { error: 'User not found' });
  }

  // Soft delete by setting isActive to false
  await ctx.prisma.user.update({
    where: { id },
    data: { isActive: false },
  });

  return jsonResponse(200, { data: { id, deleted: true } });
}

// Route definitions
export const userRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    path: /^\/api\/users\/me$/,
    handler: getCurrentUser,
  },
  {
    method: 'PUT',
    path: /^\/api\/users\/me$/,
    handler: updateCurrentUser,
  },
  {
    method: 'GET',
    path: /^\/api\/users$/,
    handler: listUsers,
  },
  {
    method: 'GET',
    path: /^\/api\/users\/(?<id>[^/]+)$/,
    handler: getUser,
  },
  {
    method: 'POST',
    path: /^\/api\/users$/,
    handler: createUser,
  },
  {
    method: 'PUT',
    path: /^\/api\/users\/(?<id>[^/]+)$/,
    handler: updateUser,
  },
  {
    method: 'DELETE',
    path: /^\/api\/users\/(?<id>[^/]+)$/,
    handler: deleteUser,
  },
];
