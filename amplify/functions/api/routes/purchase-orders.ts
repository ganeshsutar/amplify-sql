import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { RouteContext, RouteDefinition } from '../handler';
import { PurchaseOrderStatus } from '@prisma/client';

/**
 * Purchase Order management operations
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
 * Generate order number
 */
function generateOrderNumber(): string {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `PO-${year}${month}-${random}`;
}

/**
 * List purchase orders
 * GET /api/purchase-orders
 */
async function listPurchaseOrders(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  const queryParams = event.queryStringParameters || {};
  const limit = Math.min(parseInt(queryParams.limit || '50'), 100);
  const offset = parseInt(queryParams.offset || '0');
  const supplierId = queryParams.supplierId;
  const status = queryParams.status as PurchaseOrderStatus | undefined;

  const where: Record<string, unknown> = {};
  if (supplierId) where.supplierId = supplierId;
  if (status) where.status = status;

  const orders = await ctx.prisma.purchaseOrder.findMany({
    where,
    include: {
      supplier: true,
      items: {
        include: {
          product: true,
        },
      },
      _count: {
        select: { items: true },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
  });

  const total = await ctx.prisma.purchaseOrder.count({ where });

  return jsonResponse(200, {
    data: orders,
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + orders.length < total,
    },
  });
}

/**
 * Get purchase order by ID
 * GET /api/purchase-orders/:id
 */
async function getPurchaseOrder(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  const id = event.pathParameters?.id;
  if (!id) {
    return jsonResponse(400, { error: 'Purchase Order ID is required' });
  }

  const order = await ctx.prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: true,
      items: {
        include: {
          product: true,
        },
      },
    },
  });

  if (!order) {
    return jsonResponse(404, { error: 'Purchase Order not found' });
  }

  return jsonResponse(200, { data: order });
}

/**
 * Create a new purchase order
 * POST /api/purchase-orders
 */
async function createPurchaseOrder(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  if (!event.body) {
    return jsonResponse(400, { error: 'Request body is required' });
  }

  const body = JSON.parse(event.body);

  if (!body.supplierId) {
    return jsonResponse(400, { error: 'supplierId is required' });
  }

  // Validate supplier exists
  const supplier = await ctx.prisma.supplier.findUnique({
    where: { id: body.supplierId },
  });

  if (!supplier) {
    return jsonResponse(404, { error: 'Supplier not found' });
  }

  // Generate order number
  const orderNumber = body.orderNumber || generateOrderNumber();

  // Calculate totals from items
  let subtotal = 0;
  const itemsData = [];

  if (body.items && Array.isArray(body.items)) {
    for (const item of body.items) {
      if (!item.productId || !item.quantity || !item.unitPrice) {
        return jsonResponse(400, { error: 'Each item requires productId, quantity, and unitPrice' });
      }

      const totalPrice = parseFloat(item.quantity) * parseFloat(item.unitPrice);
      subtotal += totalPrice;

      itemsData.push({
        productId: item.productId,
        quantity: parseInt(item.quantity),
        unitPrice: parseFloat(item.unitPrice),
        totalPrice,
        notes: item.notes,
      });
    }
  }

  const taxAmount = parseFloat(body.taxAmount) || 0;
  const shippingAmount = parseFloat(body.shippingAmount) || 0;
  const totalAmount = subtotal + taxAmount + shippingAmount;

  const order = await ctx.prisma.purchaseOrder.create({
    data: {
      orderNumber,
      supplierId: body.supplierId,
      subtotal,
      taxAmount,
      shippingAmount,
      totalAmount,
      notes: body.notes,
      expectedAt: body.expectedAt ? new Date(body.expectedAt) : null,
      items: {
        create: itemsData,
      },
    },
    include: {
      supplier: true,
      items: {
        include: {
          product: true,
        },
      },
    },
  });

  return jsonResponse(201, { data: order });
}

/**
 * Update a purchase order
 * PUT /api/purchase-orders/:id
 */
async function updatePurchaseOrder(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  const id = event.pathParameters?.id;
  if (!id) {
    return jsonResponse(400, { error: 'Purchase Order ID is required' });
  }

  if (!event.body) {
    return jsonResponse(400, { error: 'Request body is required' });
  }

  const body = JSON.parse(event.body);

  const existing = await ctx.prisma.purchaseOrder.findUnique({
    where: { id },
    include: { items: true },
  });

  if (!existing) {
    return jsonResponse(404, { error: 'Purchase Order not found' });
  }

  // Can only update DRAFT or PENDING orders
  if (!['DRAFT', 'PENDING'].includes(existing.status)) {
    return jsonResponse(400, {
      error: `Cannot update order with status ${existing.status}`,
    });
  }

  const updateData: Record<string, unknown> = {};

  if (body.status !== undefined) {
    updateData.status = body.status;

    // Set timestamps based on status change
    if (body.status === 'ORDERED' && !existing.orderedAt) {
      updateData.orderedAt = new Date();
    }
    if (body.status === 'RECEIVED') {
      updateData.receivedAt = new Date();
    }
  }

  if (body.notes !== undefined) updateData.notes = body.notes;
  if (body.expectedAt !== undefined) updateData.expectedAt = body.expectedAt ? new Date(body.expectedAt) : null;
  if (body.taxAmount !== undefined) updateData.taxAmount = parseFloat(body.taxAmount);
  if (body.shippingAmount !== undefined) updateData.shippingAmount = parseFloat(body.shippingAmount);

  // Recalculate total if tax or shipping changed
  if (body.taxAmount !== undefined || body.shippingAmount !== undefined) {
    const taxAmount = body.taxAmount !== undefined ? parseFloat(body.taxAmount) : Number(existing.taxAmount);
    const shippingAmount = body.shippingAmount !== undefined ? parseFloat(body.shippingAmount) : Number(existing.shippingAmount);
    updateData.totalAmount = Number(existing.subtotal) + taxAmount + shippingAmount;
  }

  // Update items if provided
  if (body.items && Array.isArray(body.items)) {
    // Delete existing items and recreate
    await ctx.prisma.purchaseOrderItem.deleteMany({
      where: { purchaseOrderId: id },
    });

    let subtotal = 0;
    const itemsData = [];

    for (const item of body.items) {
      const totalPrice = parseFloat(item.quantity) * parseFloat(item.unitPrice);
      subtotal += totalPrice;

      itemsData.push({
        purchaseOrderId: id,
        productId: item.productId,
        quantity: parseInt(item.quantity),
        unitPrice: parseFloat(item.unitPrice),
        totalPrice,
        receivedQty: item.receivedQty || 0,
        notes: item.notes,
      });
    }

    await ctx.prisma.purchaseOrderItem.createMany({
      data: itemsData,
    });

    updateData.subtotal = subtotal;
    const taxAmount = body.taxAmount !== undefined ? parseFloat(body.taxAmount) : Number(existing.taxAmount);
    const shippingAmount = body.shippingAmount !== undefined ? parseFloat(body.shippingAmount) : Number(existing.shippingAmount);
    updateData.totalAmount = subtotal + taxAmount + shippingAmount;
  }

  const order = await ctx.prisma.purchaseOrder.update({
    where: { id },
    data: updateData,
    include: {
      supplier: true,
      items: {
        include: {
          product: true,
        },
      },
    },
  });

  return jsonResponse(200, { data: order });
}

/**
 * Delete a purchase order
 * DELETE /api/purchase-orders/:id
 */
async function deletePurchaseOrder(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  const id = event.pathParameters?.id;
  if (!id) {
    return jsonResponse(400, { error: 'Purchase Order ID is required' });
  }

  const existing = await ctx.prisma.purchaseOrder.findUnique({
    where: { id },
  });

  if (!existing) {
    return jsonResponse(404, { error: 'Purchase Order not found' });
  }

  // Can only delete DRAFT orders
  if (existing.status !== 'DRAFT') {
    return jsonResponse(400, {
      error: `Cannot delete order with status ${existing.status}. Only DRAFT orders can be deleted.`,
    });
  }

  // Delete items first, then order
  await ctx.prisma.purchaseOrderItem.deleteMany({
    where: { purchaseOrderId: id },
  });

  await ctx.prisma.purchaseOrder.delete({
    where: { id },
  });

  return jsonResponse(200, { data: { id, deleted: true } });
}

/**
 * Receive items for a purchase order
 * POST /api/purchase-orders/:id/receive
 */
async function receivePurchaseOrder(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  const id = event.pathParameters?.id;
  if (!id) {
    return jsonResponse(400, { error: 'Purchase Order ID is required' });
  }

  if (!event.body) {
    return jsonResponse(400, { error: 'Request body is required' });
  }

  const body = JSON.parse(event.body);

  if (!body.warehouseId) {
    return jsonResponse(400, { error: 'warehouseId is required' });
  }

  const order = await ctx.prisma.purchaseOrder.findUnique({
    where: { id },
    include: { items: true },
  });

  if (!order) {
    return jsonResponse(404, { error: 'Purchase Order not found' });
  }

  if (!['ORDERED', 'PARTIAL'].includes(order.status)) {
    return jsonResponse(400, {
      error: `Cannot receive items for order with status ${order.status}`,
    });
  }

  // Process received items
  const receivedItems = body.items || order.items.map((i) => ({
    itemId: i.id,
    receivedQty: i.quantity - i.receivedQty, // Receive remaining
  }));

  await ctx.prisma.$transaction(async (tx) => {
    for (const received of receivedItems) {
      const item = order.items.find((i) => i.id === received.itemId);
      if (!item) continue;

      const qty = Math.min(received.receivedQty, item.quantity - item.receivedQty);
      if (qty <= 0) continue;

      // Update item received quantity
      await tx.purchaseOrderItem.update({
        where: { id: item.id },
        data: { receivedQty: item.receivedQty + qty },
      });

      // Update stock
      await tx.stockItem.upsert({
        where: {
          productId_warehouseId: {
            productId: item.productId,
            warehouseId: body.warehouseId,
          },
        },
        update: {
          quantity: { increment: qty },
          availableQty: { increment: qty },
        },
        create: {
          productId: item.productId,
          warehouseId: body.warehouseId,
          quantity: qty,
          availableQty: qty,
        },
      });
    }

    // Check if all items are fully received
    const updatedItems = await tx.purchaseOrderItem.findMany({
      where: { purchaseOrderId: id },
    });

    const allReceived = updatedItems.every((i) => i.receivedQty >= i.quantity);
    const someReceived = updatedItems.some((i) => i.receivedQty > 0);

    let newStatus: PurchaseOrderStatus = order.status;
    if (allReceived) {
      newStatus = 'RECEIVED';
    } else if (someReceived) {
      newStatus = 'PARTIAL';
    }

    await tx.purchaseOrder.update({
      where: { id },
      data: {
        status: newStatus,
        receivedAt: allReceived ? new Date() : null,
      },
    });
  });

  // Fetch updated order
  const updatedOrder = await ctx.prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: true,
      items: {
        include: { product: true },
      },
    },
  });

  return jsonResponse(200, { data: updatedOrder });
}

// Route definitions
export const purchaseOrderRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    path: /^\/api\/purchase-orders$/,
    handler: listPurchaseOrders,
  },
  {
    method: 'GET',
    path: /^\/api\/purchase-orders\/(?<id>[^/]+)$/,
    handler: getPurchaseOrder,
  },
  {
    method: 'POST',
    path: /^\/api\/purchase-orders$/,
    handler: createPurchaseOrder,
  },
  {
    method: 'PUT',
    path: /^\/api\/purchase-orders\/(?<id>[^/]+)$/,
    handler: updatePurchaseOrder,
  },
  {
    method: 'DELETE',
    path: /^\/api\/purchase-orders\/(?<id>[^/]+)$/,
    handler: deletePurchaseOrder,
  },
  {
    method: 'POST',
    path: /^\/api\/purchase-orders\/(?<id>[^/]+)\/receive$/,
    handler: receivePurchaseOrder,
  },
];
