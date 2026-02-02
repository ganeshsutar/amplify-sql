import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { RouteContext, RouteDefinition } from '../handler';

/**
 * Warehouse management operations
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
 * List warehouses
 * GET /api/warehouses
 */
async function listWarehouses(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  const queryParams = event.queryStringParameters || {};
  const organizationId = queryParams.organizationId;
  const isActive = queryParams.isActive ? queryParams.isActive === 'true' : undefined;

  // Get current user's organization
  const currentUser = await ctx.prisma.user.findUnique({
    where: { cognitoSub: ctx.userId },
  });

  const where: Record<string, unknown> = {};

  if (organizationId) {
    where.organizationId = organizationId;
  } else if (currentUser?.organizationId) {
    where.organizationId = currentUser.organizationId;
  }

  if (isActive !== undefined) where.isActive = isActive;

  const warehouses = await ctx.prisma.warehouse.findMany({
    where,
    include: {
      organization: true,
      _count: {
        select: { stockItems: true },
      },
    },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
  });

  return jsonResponse(200, { data: warehouses });
}

/**
 * Get warehouse by ID
 * GET /api/warehouses/:id
 */
async function getWarehouse(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  const id = event.pathParameters?.id;
  if (!id) {
    return jsonResponse(400, { error: 'Warehouse ID is required' });
  }

  const warehouse = await ctx.prisma.warehouse.findUnique({
    where: { id },
    include: {
      organization: true,
      stockItems: {
        include: {
          product: true,
        },
        where: {
          quantity: { gt: 0 },
        },
        orderBy: { updatedAt: 'desc' },
        take: 50,
      },
      _count: {
        select: { stockItems: true },
      },
    },
  });

  if (!warehouse) {
    return jsonResponse(404, { error: 'Warehouse not found' });
  }

  return jsonResponse(200, { data: warehouse });
}

/**
 * Create a new warehouse
 * POST /api/warehouses
 */
async function createWarehouse(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  if (!event.body) {
    return jsonResponse(400, { error: 'Request body is required' });
  }

  const body = JSON.parse(event.body);

  if (!body.code || !body.name || !body.organizationId) {
    return jsonResponse(400, { error: 'code, name, and organizationId are required' });
  }

  // Check for duplicate code
  const existing = await ctx.prisma.warehouse.findUnique({
    where: { code: body.code },
  });

  if (existing) {
    return jsonResponse(409, { error: 'Warehouse with this code already exists' });
  }

  // If this is set as default, unset other defaults
  if (body.isDefault) {
    await ctx.prisma.warehouse.updateMany({
      where: { organizationId: body.organizationId, isDefault: true },
      data: { isDefault: false },
    });
  }

  const warehouse = await ctx.prisma.warehouse.create({
    data: {
      code: body.code,
      name: body.name,
      description: body.description,
      address: body.address,
      city: body.city,
      state: body.state,
      postalCode: body.postalCode,
      country: body.country || 'US',
      isDefault: body.isDefault || false,
      organizationId: body.organizationId,
    },
    include: {
      organization: true,
    },
  });

  return jsonResponse(201, { data: warehouse });
}

/**
 * Update a warehouse
 * PUT /api/warehouses/:id
 */
async function updateWarehouse(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  const id = event.pathParameters?.id;
  if (!id) {
    return jsonResponse(400, { error: 'Warehouse ID is required' });
  }

  if (!event.body) {
    return jsonResponse(400, { error: 'Request body is required' });
  }

  const body = JSON.parse(event.body);

  const existing = await ctx.prisma.warehouse.findUnique({
    where: { id },
  });

  if (!existing) {
    return jsonResponse(404, { error: 'Warehouse not found' });
  }

  // Check for code conflict
  if (body.code && body.code !== existing.code) {
    const codeConflict = await ctx.prisma.warehouse.findUnique({
      where: { code: body.code },
    });
    if (codeConflict) {
      return jsonResponse(409, { error: 'Another warehouse with this code already exists' });
    }
  }

  // If setting as default, unset others
  if (body.isDefault && !existing.isDefault) {
    await ctx.prisma.warehouse.updateMany({
      where: { organizationId: existing.organizationId, isDefault: true },
      data: { isDefault: false },
    });
  }

  const updateData: Record<string, unknown> = {};
  if (body.code !== undefined) updateData.code = body.code;
  if (body.name !== undefined) updateData.name = body.name;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.address !== undefined) updateData.address = body.address;
  if (body.city !== undefined) updateData.city = body.city;
  if (body.state !== undefined) updateData.state = body.state;
  if (body.postalCode !== undefined) updateData.postalCode = body.postalCode;
  if (body.country !== undefined) updateData.country = body.country;
  if (body.isDefault !== undefined) updateData.isDefault = body.isDefault;
  if (body.isActive !== undefined) updateData.isActive = body.isActive;

  const warehouse = await ctx.prisma.warehouse.update({
    where: { id },
    data: updateData,
    include: {
      organization: true,
    },
  });

  return jsonResponse(200, { data: warehouse });
}

/**
 * Delete a warehouse
 * DELETE /api/warehouses/:id
 */
async function deleteWarehouse(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  const id = event.pathParameters?.id;
  if (!id) {
    return jsonResponse(400, { error: 'Warehouse ID is required' });
  }

  const existing = await ctx.prisma.warehouse.findUnique({
    where: { id },
    include: {
      stockItems: {
        where: { quantity: { gt: 0 } },
      },
    },
  });

  if (!existing) {
    return jsonResponse(404, { error: 'Warehouse not found' });
  }

  if (existing.stockItems.length > 0) {
    return jsonResponse(400, { error: 'Cannot delete warehouse with existing stock' });
  }

  if (existing.isDefault) {
    return jsonResponse(400, { error: 'Cannot delete the default warehouse' });
  }

  // Delete stock items with zero quantity, then warehouse
  await ctx.prisma.stockItem.deleteMany({ where: { warehouseId: id } });
  await ctx.prisma.warehouse.delete({ where: { id } });

  return jsonResponse(200, { data: { id, deleted: true } });
}

// Route definitions
export const warehouseRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    path: /^\/api\/warehouses$/,
    handler: listWarehouses,
  },
  {
    method: 'GET',
    path: /^\/api\/warehouses\/(?<id>[^/]+)$/,
    handler: getWarehouse,
  },
  {
    method: 'POST',
    path: /^\/api\/warehouses$/,
    handler: createWarehouse,
  },
  {
    method: 'PUT',
    path: /^\/api\/warehouses\/(?<id>[^/]+)$/,
    handler: updateWarehouse,
  },
  {
    method: 'DELETE',
    path: /^\/api\/warehouses\/(?<id>[^/]+)$/,
    handler: deleteWarehouse,
  },
];
