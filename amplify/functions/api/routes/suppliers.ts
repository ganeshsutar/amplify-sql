import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { RouteContext, RouteDefinition } from '../handler';

/**
 * Supplier management operations
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
 * List suppliers
 * GET /api/suppliers
 */
async function listSuppliers(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  const queryParams = event.queryStringParameters || {};
  const limit = Math.min(parseInt(queryParams.limit || '50'), 100);
  const offset = parseInt(queryParams.offset || '0');
  const isActive = queryParams.isActive ? queryParams.isActive === 'true' : undefined;
  const search = queryParams.search;

  const where: Record<string, unknown> = {};
  if (isActive !== undefined) where.isActive = isActive;

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { code: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ];
  }

  const suppliers = await ctx.prisma.supplier.findMany({
    where,
    include: {
      _count: {
        select: { purchaseOrders: true },
      },
    },
    orderBy: { name: 'asc' },
    take: limit,
    skip: offset,
  });

  const total = await ctx.prisma.supplier.count({ where });

  return jsonResponse(200, {
    data: suppliers,
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + suppliers.length < total,
    },
  });
}

/**
 * Get supplier by ID
 * GET /api/suppliers/:id
 */
async function getSupplier(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  const id = event.pathParameters?.id;
  if (!id) {
    return jsonResponse(400, { error: 'Supplier ID is required' });
  }

  const supplier = await ctx.prisma.supplier.findUnique({
    where: { id },
    include: {
      purchaseOrders: {
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
      _count: {
        select: { purchaseOrders: true },
      },
    },
  });

  if (!supplier) {
    return jsonResponse(404, { error: 'Supplier not found' });
  }

  return jsonResponse(200, { data: supplier });
}

/**
 * Create a new supplier
 * POST /api/suppliers
 */
async function createSupplier(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  if (!event.body) {
    return jsonResponse(400, { error: 'Request body is required' });
  }

  const body = JSON.parse(event.body);

  if (!body.code || !body.name) {
    return jsonResponse(400, { error: 'code and name are required' });
  }

  // Check for duplicate code
  const existing = await ctx.prisma.supplier.findUnique({
    where: { code: body.code },
  });

  if (existing) {
    return jsonResponse(409, { error: 'Supplier with this code already exists' });
  }

  const supplier = await ctx.prisma.supplier.create({
    data: {
      code: body.code,
      name: body.name,
      contactName: body.contactName,
      email: body.email,
      phone: body.phone,
      address: body.address,
      city: body.city,
      state: body.state,
      postalCode: body.postalCode,
      country: body.country || 'US',
      website: body.website,
      paymentTerms: body.paymentTerms,
      notes: body.notes,
    },
  });

  return jsonResponse(201, { data: supplier });
}

/**
 * Update a supplier
 * PUT /api/suppliers/:id
 */
async function updateSupplier(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  const id = event.pathParameters?.id;
  if (!id) {
    return jsonResponse(400, { error: 'Supplier ID is required' });
  }

  if (!event.body) {
    return jsonResponse(400, { error: 'Request body is required' });
  }

  const body = JSON.parse(event.body);

  const existing = await ctx.prisma.supplier.findUnique({
    where: { id },
  });

  if (!existing) {
    return jsonResponse(404, { error: 'Supplier not found' });
  }

  // Check for code conflict
  if (body.code && body.code !== existing.code) {
    const codeConflict = await ctx.prisma.supplier.findUnique({
      where: { code: body.code },
    });
    if (codeConflict) {
      return jsonResponse(409, { error: 'Another supplier with this code already exists' });
    }
  }

  const updateData: Record<string, unknown> = {};
  if (body.code !== undefined) updateData.code = body.code;
  if (body.name !== undefined) updateData.name = body.name;
  if (body.contactName !== undefined) updateData.contactName = body.contactName;
  if (body.email !== undefined) updateData.email = body.email;
  if (body.phone !== undefined) updateData.phone = body.phone;
  if (body.address !== undefined) updateData.address = body.address;
  if (body.city !== undefined) updateData.city = body.city;
  if (body.state !== undefined) updateData.state = body.state;
  if (body.postalCode !== undefined) updateData.postalCode = body.postalCode;
  if (body.country !== undefined) updateData.country = body.country;
  if (body.website !== undefined) updateData.website = body.website;
  if (body.paymentTerms !== undefined) updateData.paymentTerms = body.paymentTerms;
  if (body.isActive !== undefined) updateData.isActive = body.isActive;
  if (body.notes !== undefined) updateData.notes = body.notes;

  const supplier = await ctx.prisma.supplier.update({
    where: { id },
    data: updateData,
  });

  return jsonResponse(200, { data: supplier });
}

/**
 * Delete a supplier
 * DELETE /api/suppliers/:id
 */
async function deleteSupplier(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  const id = event.pathParameters?.id;
  if (!id) {
    return jsonResponse(400, { error: 'Supplier ID is required' });
  }

  const existing = await ctx.prisma.supplier.findUnique({
    where: { id },
    include: {
      _count: {
        select: { purchaseOrders: true },
      },
    },
  });

  if (!existing) {
    return jsonResponse(404, { error: 'Supplier not found' });
  }

  if (existing._count.purchaseOrders > 0) {
    // Soft delete if there are orders
    await ctx.prisma.supplier.update({
      where: { id },
      data: { isActive: false },
    });
  } else {
    // Hard delete if no orders
    await ctx.prisma.supplier.delete({ where: { id } });
  }

  return jsonResponse(200, { data: { id, deleted: true } });
}

// Route definitions
export const supplierRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    path: /^\/api\/suppliers$/,
    handler: listSuppliers,
  },
  {
    method: 'GET',
    path: /^\/api\/suppliers\/(?<id>[^/]+)$/,
    handler: getSupplier,
  },
  {
    method: 'POST',
    path: /^\/api\/suppliers$/,
    handler: createSupplier,
  },
  {
    method: 'PUT',
    path: /^\/api\/suppliers\/(?<id>[^/]+)$/,
    handler: updateSupplier,
  },
  {
    method: 'DELETE',
    path: /^\/api\/suppliers\/(?<id>[^/]+)$/,
    handler: deleteSupplier,
  },
];
