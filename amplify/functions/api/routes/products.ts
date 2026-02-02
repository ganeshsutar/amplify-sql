import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { RouteContext, RouteDefinition } from '../handler';

/**
 * Product catalog operations
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
 * List products with filtering and pagination
 * GET /api/products
 */
async function listProducts(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  const queryParams = event.queryStringParameters || {};
  const limit = Math.min(parseInt(queryParams.limit || '50'), 100);
  const offset = parseInt(queryParams.offset || '0');
  const organizationId = queryParams.organizationId;
  const categoryId = queryParams.categoryId;
  const isActive = queryParams.isActive ? queryParams.isActive === 'true' : undefined;
  const search = queryParams.search;

  // Get current user's organization
  const currentUser = await ctx.prisma.user.findUnique({
    where: { cognitoSub: ctx.userId },
  });

  // Build filter
  const where: Record<string, unknown> = {};

  // Filter by organization (default to user's org)
  if (organizationId) {
    where.organizationId = organizationId;
  } else if (currentUser?.organizationId) {
    where.organizationId = currentUser.organizationId;
  }

  if (categoryId) where.categoryId = categoryId;
  if (isActive !== undefined) where.isActive = isActive;

  // Search by name or SKU
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { sku: { contains: search, mode: 'insensitive' } },
      { barcode: { contains: search } },
    ];
  }

  const products = await ctx.prisma.product.findMany({
    where,
    include: {
      category: true,
      stockItems: {
        include: {
          warehouse: true,
        },
      },
    },
    orderBy: { name: 'asc' },
    take: limit,
    skip: offset,
  });

  const total = await ctx.prisma.product.count({ where });

  return jsonResponse(200, {
    data: products,
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + products.length < total,
    },
  });
}

/**
 * Get product by ID
 * GET /api/products/:id
 */
async function getProduct(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  const id = event.pathParameters?.id;
  if (!id) {
    return jsonResponse(400, { error: 'Product ID is required' });
  }

  const product = await ctx.prisma.product.findUnique({
    where: { id },
    include: {
      category: true,
      organization: true,
      stockItems: {
        include: {
          warehouse: true,
        },
      },
    },
  });

  if (!product) {
    return jsonResponse(404, { error: 'Product not found' });
  }

  return jsonResponse(200, { data: product });
}

/**
 * Create a new product
 * POST /api/products
 */
async function createProduct(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  if (!event.body) {
    return jsonResponse(400, { error: 'Request body is required' });
  }

  const body = JSON.parse(event.body);

  // Validation
  if (!body.sku || !body.name || !body.organizationId) {
    return jsonResponse(400, { error: 'sku, name, and organizationId are required' });
  }

  if (body.unitPrice === undefined || isNaN(parseFloat(body.unitPrice))) {
    return jsonResponse(400, { error: 'unitPrice must be a valid number' });
  }

  // Check for duplicate SKU
  const existing = await ctx.prisma.product.findUnique({
    where: { sku: body.sku },
  });

  if (existing) {
    return jsonResponse(409, { error: 'Product with this SKU already exists' });
  }

  const product = await ctx.prisma.product.create({
    data: {
      sku: body.sku,
      name: body.name,
      description: body.description,
      barcode: body.barcode,
      unitPrice: body.unitPrice,
      costPrice: body.costPrice,
      weight: body.weight,
      dimensions: body.dimensions,
      minStockLevel: body.minStockLevel || 0,
      maxStockLevel: body.maxStockLevel,
      reorderPoint: body.reorderPoint || 0,
      isTaxable: body.isTaxable ?? true,
      metadata: body.metadata || {},
      organizationId: body.organizationId,
      categoryId: body.categoryId,
    },
    include: {
      category: true,
      organization: true,
    },
  });

  // Create audit log
  const user = await ctx.prisma.user.findUnique({
    where: { cognitoSub: ctx.userId },
  });

  if (user) {
    await ctx.prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'CREATE',
        entityType: 'Product',
        entityId: product.id,
        changes: { after: product },
      },
    });
  }

  return jsonResponse(201, { data: product });
}

/**
 * Update a product
 * PUT /api/products/:id
 */
async function updateProduct(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  const id = event.pathParameters?.id;
  if (!id) {
    return jsonResponse(400, { error: 'Product ID is required' });
  }

  if (!event.body) {
    return jsonResponse(400, { error: 'Request body is required' });
  }

  const body = JSON.parse(event.body);

  const existing = await ctx.prisma.product.findUnique({
    where: { id },
  });

  if (!existing) {
    return jsonResponse(404, { error: 'Product not found' });
  }

  // Check for SKU conflict if changing SKU
  if (body.sku && body.sku !== existing.sku) {
    const skuConflict = await ctx.prisma.product.findUnique({
      where: { sku: body.sku },
    });
    if (skuConflict) {
      return jsonResponse(409, { error: 'Another product with this SKU already exists' });
    }
  }

  const updateData: Record<string, unknown> = {};
  if (body.sku !== undefined) updateData.sku = body.sku;
  if (body.name !== undefined) updateData.name = body.name;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.barcode !== undefined) updateData.barcode = body.barcode;
  if (body.unitPrice !== undefined) updateData.unitPrice = body.unitPrice;
  if (body.costPrice !== undefined) updateData.costPrice = body.costPrice;
  if (body.weight !== undefined) updateData.weight = body.weight;
  if (body.dimensions !== undefined) updateData.dimensions = body.dimensions;
  if (body.minStockLevel !== undefined) updateData.minStockLevel = body.minStockLevel;
  if (body.maxStockLevel !== undefined) updateData.maxStockLevel = body.maxStockLevel;
  if (body.reorderPoint !== undefined) updateData.reorderPoint = body.reorderPoint;
  if (body.isActive !== undefined) updateData.isActive = body.isActive;
  if (body.isTaxable !== undefined) updateData.isTaxable = body.isTaxable;
  if (body.metadata !== undefined) updateData.metadata = body.metadata;
  if (body.categoryId !== undefined) updateData.categoryId = body.categoryId;

  const product = await ctx.prisma.product.update({
    where: { id },
    data: updateData,
    include: {
      category: true,
      organization: true,
    },
  });

  // Create audit log
  const user = await ctx.prisma.user.findUnique({
    where: { cognitoSub: ctx.userId },
  });

  if (user) {
    await ctx.prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'UPDATE',
        entityType: 'Product',
        entityId: product.id,
        changes: { before: existing, after: product },
      },
    });
  }

  return jsonResponse(200, { data: product });
}

/**
 * Delete a product
 * DELETE /api/products/:id
 */
async function deleteProduct(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  const id = event.pathParameters?.id;
  if (!id) {
    return jsonResponse(400, { error: 'Product ID is required' });
  }

  const existing = await ctx.prisma.product.findUnique({
    where: { id },
    include: {
      stockItems: true,
      orderItems: true,
    },
  });

  if (!existing) {
    return jsonResponse(404, { error: 'Product not found' });
  }

  // Check for stock or orders
  const hasStock = existing.stockItems.some((s) => s.quantity > 0);
  if (hasStock) {
    return jsonResponse(400, { error: 'Cannot delete product with existing stock' });
  }

  if (existing.orderItems.length > 0) {
    // Soft delete if there are orders
    await ctx.prisma.product.update({
      where: { id },
      data: { isActive: false },
    });
  } else {
    // Hard delete if no orders
    await ctx.prisma.stockItem.deleteMany({ where: { productId: id } });
    await ctx.prisma.product.delete({ where: { id } });
  }

  // Create audit log
  const user = await ctx.prisma.user.findUnique({
    where: { cognitoSub: ctx.userId },
  });

  if (user) {
    await ctx.prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'DELETE',
        entityType: 'Product',
        entityId: id,
        changes: { before: existing },
      },
    });
  }

  return jsonResponse(200, { data: { id, deleted: true } });
}

// Route definitions
export const productRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    path: /^\/api\/products$/,
    handler: listProducts,
  },
  {
    method: 'GET',
    path: /^\/api\/products\/(?<id>[^/]+)$/,
    handler: getProduct,
  },
  {
    method: 'POST',
    path: /^\/api\/products$/,
    handler: createProduct,
  },
  {
    method: 'PUT',
    path: /^\/api\/products\/(?<id>[^/]+)$/,
    handler: updateProduct,
  },
  {
    method: 'DELETE',
    path: /^\/api\/products\/(?<id>[^/]+)$/,
    handler: deleteProduct,
  },
];
