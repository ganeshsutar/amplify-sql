import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { RouteContext, RouteDefinition } from '../handler';

/**
 * Customer management operations
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
 * List customers
 * GET /api/customers
 */
async function listCustomers(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  const queryParams = event.queryStringParameters || {};
  const limit = Math.min(parseInt(queryParams.limit || '50'), 100);
  const offset = parseInt(queryParams.offset || '0');
  const organizationId = queryParams.organizationId;
  const isActive = queryParams.isActive ? queryParams.isActive === 'true' : undefined;
  const search = queryParams.search;

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

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { code: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ];
  }

  const customers = await ctx.prisma.customer.findMany({
    where,
    include: {
      _count: {
        select: { orders: true },
      },
    },
    orderBy: { name: 'asc' },
    take: limit,
    skip: offset,
  });

  const total = await ctx.prisma.customer.count({ where });

  return jsonResponse(200, {
    data: customers,
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + customers.length < total,
    },
  });
}

/**
 * Get customer by ID
 * GET /api/customers/:id
 */
async function getCustomer(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  const id = event.pathParameters?.id;
  if (!id) {
    return jsonResponse(400, { error: 'Customer ID is required' });
  }

  const customer = await ctx.prisma.customer.findUnique({
    where: { id },
    include: {
      organization: true,
      orders: {
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          _count: { select: { items: true } },
        },
      },
      _count: {
        select: { orders: true },
      },
    },
  });

  if (!customer) {
    return jsonResponse(404, { error: 'Customer not found' });
  }

  return jsonResponse(200, { data: customer });
}

/**
 * Create a new customer
 * POST /api/customers
 */
async function createCustomer(
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
  const existing = await ctx.prisma.customer.findUnique({
    where: { code: body.code },
  });

  if (existing) {
    return jsonResponse(409, { error: 'Customer with this code already exists' });
  }

  const customer = await ctx.prisma.customer.create({
    data: {
      code: body.code,
      name: body.name,
      email: body.email,
      phone: body.phone,
      address: body.address,
      city: body.city,
      state: body.state,
      postalCode: body.postalCode,
      country: body.country || 'US',
      taxExempt: body.taxExempt || false,
      creditLimit: body.creditLimit,
      notes: body.notes,
      organizationId: body.organizationId,
    },
    include: {
      organization: true,
    },
  });

  return jsonResponse(201, { data: customer });
}

/**
 * Update a customer
 * PUT /api/customers/:id
 */
async function updateCustomer(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  const id = event.pathParameters?.id;
  if (!id) {
    return jsonResponse(400, { error: 'Customer ID is required' });
  }

  if (!event.body) {
    return jsonResponse(400, { error: 'Request body is required' });
  }

  const body = JSON.parse(event.body);

  const existing = await ctx.prisma.customer.findUnique({
    where: { id },
  });

  if (!existing) {
    return jsonResponse(404, { error: 'Customer not found' });
  }

  // Check for code conflict
  if (body.code && body.code !== existing.code) {
    const codeConflict = await ctx.prisma.customer.findUnique({
      where: { code: body.code },
    });
    if (codeConflict) {
      return jsonResponse(409, { error: 'Another customer with this code already exists' });
    }
  }

  const updateData: Record<string, unknown> = {};
  if (body.code !== undefined) updateData.code = body.code;
  if (body.name !== undefined) updateData.name = body.name;
  if (body.email !== undefined) updateData.email = body.email;
  if (body.phone !== undefined) updateData.phone = body.phone;
  if (body.address !== undefined) updateData.address = body.address;
  if (body.city !== undefined) updateData.city = body.city;
  if (body.state !== undefined) updateData.state = body.state;
  if (body.postalCode !== undefined) updateData.postalCode = body.postalCode;
  if (body.country !== undefined) updateData.country = body.country;
  if (body.taxExempt !== undefined) updateData.taxExempt = body.taxExempt;
  if (body.creditLimit !== undefined) updateData.creditLimit = body.creditLimit;
  if (body.balance !== undefined) updateData.balance = body.balance;
  if (body.isActive !== undefined) updateData.isActive = body.isActive;
  if (body.notes !== undefined) updateData.notes = body.notes;

  const customer = await ctx.prisma.customer.update({
    where: { id },
    data: updateData,
    include: {
      organization: true,
    },
  });

  return jsonResponse(200, { data: customer });
}

/**
 * Delete a customer
 * DELETE /api/customers/:id
 */
async function deleteCustomer(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  const id = event.pathParameters?.id;
  if (!id) {
    return jsonResponse(400, { error: 'Customer ID is required' });
  }

  const existing = await ctx.prisma.customer.findUnique({
    where: { id },
    include: {
      _count: {
        select: { orders: true },
      },
    },
  });

  if (!existing) {
    return jsonResponse(404, { error: 'Customer not found' });
  }

  if (existing._count.orders > 0) {
    // Soft delete if there are orders
    await ctx.prisma.customer.update({
      where: { id },
      data: { isActive: false },
    });
  } else {
    // Hard delete if no orders
    await ctx.prisma.customer.delete({ where: { id } });
  }

  return jsonResponse(200, { data: { id, deleted: true } });
}

// Route definitions
export const customerRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    path: /^\/api\/customers$/,
    handler: listCustomers,
  },
  {
    method: 'GET',
    path: /^\/api\/customers\/(?<id>[^/]+)$/,
    handler: getCustomer,
  },
  {
    method: 'POST',
    path: /^\/api\/customers$/,
    handler: createCustomer,
  },
  {
    method: 'PUT',
    path: /^\/api\/customers\/(?<id>[^/]+)$/,
    handler: updateCustomer,
  },
  {
    method: 'DELETE',
    path: /^\/api\/customers\/(?<id>[^/]+)$/,
    handler: deleteCustomer,
  },
];
