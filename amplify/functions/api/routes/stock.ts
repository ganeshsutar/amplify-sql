import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { RouteContext, RouteDefinition } from '../handler';

/**
 * Stock/Inventory management operations
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
 * List stock items with filtering
 * GET /api/stock
 */
async function listStock(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  const queryParams = event.queryStringParameters || {};
  const limit = Math.min(parseInt(queryParams.limit || '100'), 500);
  const offset = parseInt(queryParams.offset || '0');
  const warehouseId = queryParams.warehouseId;
  const productId = queryParams.productId;
  const lowStock = queryParams.lowStock === 'true';

  const where: Record<string, unknown> = {};

  if (warehouseId) where.warehouseId = warehouseId;
  if (productId) where.productId = productId;

  // Include product to filter by organization and low stock
  const stockItems = await ctx.prisma.stockItem.findMany({
    where,
    include: {
      product: {
        include: {
          category: true,
        },
      },
      warehouse: true,
    },
    orderBy: [{ updatedAt: 'desc' }],
    take: limit,
    skip: offset,
  });

  // Filter for low stock items if requested
  let filteredItems = stockItems;
  if (lowStock) {
    filteredItems = stockItems.filter(
      (item) => item.quantity <= item.product.minStockLevel
    );
  }

  // Calculate totals
  const aggregates = await ctx.prisma.stockItem.aggregate({
    where,
    _sum: {
      quantity: true,
      reservedQty: true,
    },
    _count: true,
  });

  return jsonResponse(200, {
    data: filteredItems,
    summary: {
      totalItems: aggregates._count,
      totalQuantity: aggregates._sum.quantity || 0,
      totalReserved: aggregates._sum.reservedQty || 0,
    },
    pagination: {
      limit,
      offset,
      hasMore: stockItems.length === limit,
    },
  });
}

/**
 * Get stock for a specific product/warehouse combination
 * GET /api/stock/:productId/:warehouseId
 */
async function getStockItem(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  const productId = event.pathParameters?.productId;
  const warehouseId = event.pathParameters?.warehouseId;

  if (!productId || !warehouseId) {
    return jsonResponse(400, { error: 'Product ID and Warehouse ID are required' });
  }

  const stockItem = await ctx.prisma.stockItem.findUnique({
    where: {
      productId_warehouseId: {
        productId,
        warehouseId,
      },
    },
    include: {
      product: true,
      warehouse: true,
    },
  });

  if (!stockItem) {
    // Return zero stock if not found
    return jsonResponse(200, {
      data: {
        productId,
        warehouseId,
        quantity: 0,
        reservedQty: 0,
        availableQty: 0,
      },
    });
  }

  return jsonResponse(200, { data: stockItem });
}

/**
 * Update stock for a product/warehouse
 * PUT /api/stock/:productId/:warehouseId
 */
async function updateStock(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  const productId = event.pathParameters?.productId;
  const warehouseId = event.pathParameters?.warehouseId;

  if (!productId || !warehouseId) {
    return jsonResponse(400, { error: 'Product ID and Warehouse ID are required' });
  }

  if (!event.body) {
    return jsonResponse(400, { error: 'Request body is required' });
  }

  const body = JSON.parse(event.body);

  // Validate product and warehouse exist
  const [product, warehouse] = await Promise.all([
    ctx.prisma.product.findUnique({ where: { id: productId } }),
    ctx.prisma.warehouse.findUnique({ where: { id: warehouseId } }),
  ]);

  if (!product) {
    return jsonResponse(404, { error: 'Product not found' });
  }

  if (!warehouse) {
    return jsonResponse(404, { error: 'Warehouse not found' });
  }

  // Get existing stock
  const existing = await ctx.prisma.stockItem.findUnique({
    where: {
      productId_warehouseId: { productId, warehouseId },
    },
  });

  // Determine update operation
  let newQuantity: number;
  let newReservedQty: number;

  if (body.adjustment !== undefined) {
    // Relative adjustment
    const currentQty = existing?.quantity || 0;
    newQuantity = Math.max(0, currentQty + parseInt(body.adjustment));
    newReservedQty = existing?.reservedQty || 0;
  } else if (body.quantity !== undefined) {
    // Absolute quantity
    newQuantity = Math.max(0, parseInt(body.quantity));
    newReservedQty = body.reservedQty !== undefined
      ? parseInt(body.reservedQty)
      : (existing?.reservedQty || 0);
  } else {
    return jsonResponse(400, { error: 'quantity or adjustment is required' });
  }

  // Validate reserved doesn't exceed quantity
  if (newReservedQty > newQuantity) {
    return jsonResponse(400, { error: 'Reserved quantity cannot exceed total quantity' });
  }

  const stockItem = await ctx.prisma.stockItem.upsert({
    where: {
      productId_warehouseId: { productId, warehouseId },
    },
    update: {
      quantity: newQuantity,
      reservedQty: newReservedQty,
      availableQty: newQuantity - newReservedQty,
      lastCountAt: body.isCount ? new Date() : undefined,
    },
    create: {
      productId,
      warehouseId,
      quantity: newQuantity,
      reservedQty: newReservedQty,
      availableQty: newQuantity - newReservedQty,
      lastCountAt: body.isCount ? new Date() : undefined,
    },
    include: {
      product: true,
      warehouse: true,
    },
  });

  // Create audit log for stock change
  const user = await ctx.prisma.user.findUnique({
    where: { cognitoSub: ctx.userId },
  });

  if (user) {
    await ctx.prisma.auditLog.create({
      data: {
        userId: user.id,
        action: existing ? 'UPDATE' : 'CREATE',
        entityType: 'StockItem',
        entityId: stockItem.id,
        changes: {
          productId,
          warehouseId,
          before: existing ? { quantity: existing.quantity, reservedQty: existing.reservedQty } : null,
          after: { quantity: newQuantity, reservedQty: newReservedQty },
          adjustment: body.adjustment,
          isCount: body.isCount,
        },
      },
    });
  }

  return jsonResponse(200, { data: stockItem });
}

/**
 * Bulk update stock (for inventory counts)
 * POST /api/stock/bulk
 */
async function bulkUpdateStock(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  if (!event.body) {
    return jsonResponse(400, { error: 'Request body is required' });
  }

  const body = JSON.parse(event.body);

  if (!Array.isArray(body.items)) {
    return jsonResponse(400, { error: 'items array is required' });
  }

  const results: Array<{ productId: string; warehouseId: string; success: boolean; error?: string }> = [];

  // Process in transaction
  await ctx.prisma.$transaction(async (tx) => {
    for (const item of body.items) {
      try {
        if (!item.productId || !item.warehouseId) {
          results.push({
            productId: item.productId,
            warehouseId: item.warehouseId,
            success: false,
            error: 'productId and warehouseId are required',
          });
          continue;
        }

        const quantity = parseInt(item.quantity) || 0;
        const reservedQty = parseInt(item.reservedQty) || 0;

        await tx.stockItem.upsert({
          where: {
            productId_warehouseId: {
              productId: item.productId,
              warehouseId: item.warehouseId,
            },
          },
          update: {
            quantity,
            reservedQty,
            availableQty: quantity - reservedQty,
            lastCountAt: new Date(),
          },
          create: {
            productId: item.productId,
            warehouseId: item.warehouseId,
            quantity,
            reservedQty,
            availableQty: quantity - reservedQty,
            lastCountAt: new Date(),
          },
        });

        results.push({
          productId: item.productId,
          warehouseId: item.warehouseId,
          success: true,
        });
      } catch (error) {
        results.push({
          productId: item.productId,
          warehouseId: item.warehouseId,
          success: false,
          error: String(error),
        });
      }
    }
  });

  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;

  return jsonResponse(200, {
    data: results,
    summary: {
      total: results.length,
      success: successCount,
      failed: failCount,
    },
  });
}

// Route definitions
export const stockRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    path: /^\/api\/stock$/,
    handler: listStock,
  },
  {
    method: 'GET',
    path: /^\/api\/stock\/(?<productId>[^/]+)\/(?<warehouseId>[^/]+)$/,
    handler: getStockItem,
  },
  {
    method: 'PUT',
    path: /^\/api\/stock\/(?<productId>[^/]+)\/(?<warehouseId>[^/]+)$/,
    handler: updateStock,
  },
  {
    method: 'POST',
    path: /^\/api\/stock\/bulk$/,
    handler: bulkUpdateStock,
  },
];
