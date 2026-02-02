import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { RouteContext, RouteDefinition } from '../handler';
import { OrderStatus } from '@prisma/client';

/**
 * Sales Order management operations
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
  return `SO-${year}${month}-${random}`;
}

/**
 * List orders
 * GET /api/orders
 */
async function listOrders(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  const queryParams = event.queryStringParameters || {};
  const limit = Math.min(parseInt(queryParams.limit || '50'), 100);
  const offset = parseInt(queryParams.offset || '0');
  const customerId = queryParams.customerId;
  const status = queryParams.status as OrderStatus | undefined;

  const where: Record<string, unknown> = {};
  if (customerId) where.customerId = customerId;
  if (status) where.status = status;

  const orders = await ctx.prisma.order.findMany({
    where,
    include: {
      customer: true,
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

  const total = await ctx.prisma.order.count({ where });

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
 * Get order by ID
 * GET /api/orders/:id
 */
async function getOrder(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  const id = event.pathParameters?.id;
  if (!id) {
    return jsonResponse(400, { error: 'Order ID is required' });
  }

  const order = await ctx.prisma.order.findUnique({
    where: { id },
    include: {
      customer: true,
      items: {
        include: {
          product: true,
        },
      },
    },
  });

  if (!order) {
    return jsonResponse(404, { error: 'Order not found' });
  }

  return jsonResponse(200, { data: order });
}

/**
 * Create a new order
 * POST /api/orders
 */
async function createOrder(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  if (!event.body) {
    return jsonResponse(400, { error: 'Request body is required' });
  }

  const body = JSON.parse(event.body);

  if (!body.customerId) {
    return jsonResponse(400, { error: 'customerId is required' });
  }

  // Validate customer exists
  const customer = await ctx.prisma.customer.findUnique({
    where: { id: body.customerId },
  });

  if (!customer) {
    return jsonResponse(404, { error: 'Customer not found' });
  }

  // Generate order number
  const orderNumber = body.orderNumber || generateOrderNumber();

  // Calculate totals from items
  let subtotal = 0;
  let totalTax = 0;
  const itemsData = [];

  if (body.items && Array.isArray(body.items)) {
    for (const item of body.items) {
      if (!item.productId || !item.quantity) {
        return jsonResponse(400, { error: 'Each item requires productId and quantity' });
      }

      // Get product for pricing
      const product = await ctx.prisma.product.findUnique({
        where: { id: item.productId },
      });

      if (!product) {
        return jsonResponse(404, { error: `Product ${item.productId} not found` });
      }

      const unitPrice = item.unitPrice !== undefined ? parseFloat(item.unitPrice) : Number(product.unitPrice);
      const discount = parseFloat(item.discount) || 0;
      const quantity = parseInt(item.quantity);
      const lineTotal = quantity * unitPrice - discount;

      // Calculate tax if product is taxable and customer is not tax exempt
      const taxRate = product.isTaxable && !customer.taxExempt ? 0.0825 : 0; // 8.25% example
      const taxAmount = lineTotal * taxRate;

      subtotal += lineTotal;
      totalTax += taxAmount;

      itemsData.push({
        productId: item.productId,
        quantity,
        unitPrice,
        discount,
        taxAmount,
        totalPrice: lineTotal + taxAmount,
        notes: item.notes,
      });
    }
  }

  const discountAmount = parseFloat(body.discountAmount) || 0;
  const shippingAmount = parseFloat(body.shippingAmount) || 0;
  const totalAmount = subtotal - discountAmount + totalTax + shippingAmount;

  const order = await ctx.prisma.order.create({
    data: {
      orderNumber,
      customerId: body.customerId,
      subtotal,
      taxAmount: totalTax,
      discountAmount,
      shippingAmount,
      totalAmount,
      notes: body.notes,
      shippingAddress: body.shippingAddress,
      billingAddress: body.billingAddress,
      items: {
        create: itemsData,
      },
    },
    include: {
      customer: true,
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
 * Update an order
 * PUT /api/orders/:id
 */
async function updateOrder(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  const id = event.pathParameters?.id;
  if (!id) {
    return jsonResponse(400, { error: 'Order ID is required' });
  }

  if (!event.body) {
    return jsonResponse(400, { error: 'Request body is required' });
  }

  const body = JSON.parse(event.body);

  const existing = await ctx.prisma.order.findUnique({
    where: { id },
  });

  if (!existing) {
    return jsonResponse(404, { error: 'Order not found' });
  }

  // Check valid status transitions
  const validTransitions: Record<OrderStatus, OrderStatus[]> = {
    PENDING: ['CONFIRMED', 'CANCELLED'],
    CONFIRMED: ['PROCESSING', 'CANCELLED'],
    PROCESSING: ['SHIPPED', 'CANCELLED'],
    SHIPPED: ['DELIVERED'],
    DELIVERED: ['REFUNDED'],
    CANCELLED: [],
    REFUNDED: [],
  };

  if (body.status && body.status !== existing.status) {
    if (!validTransitions[existing.status].includes(body.status)) {
      return jsonResponse(400, {
        error: `Invalid status transition from ${existing.status} to ${body.status}`,
      });
    }
  }

  const updateData: Record<string, unknown> = {};

  if (body.status !== undefined) {
    updateData.status = body.status;

    // Set timestamps based on status
    if (body.status === 'SHIPPED') {
      updateData.shippedAt = new Date();
    }
    if (body.status === 'DELIVERED') {
      updateData.deliveredAt = new Date();
    }
  }

  if (body.notes !== undefined) updateData.notes = body.notes;
  if (body.shippingAddress !== undefined) updateData.shippingAddress = body.shippingAddress;
  if (body.billingAddress !== undefined) updateData.billingAddress = body.billingAddress;

  // Only allow item updates for PENDING orders
  if (body.items && existing.status === 'PENDING') {
    // This would require recalculating totals - simplified for now
    return jsonResponse(400, { error: 'Item updates not supported via this endpoint' });
  }

  const order = await ctx.prisma.order.update({
    where: { id },
    data: updateData,
    include: {
      customer: true,
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
 * Delete an order
 * DELETE /api/orders/:id
 */
async function deleteOrder(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  const id = event.pathParameters?.id;
  if (!id) {
    return jsonResponse(400, { error: 'Order ID is required' });
  }

  const existing = await ctx.prisma.order.findUnique({
    where: { id },
  });

  if (!existing) {
    return jsonResponse(404, { error: 'Order not found' });
  }

  // Can only delete PENDING orders
  if (existing.status !== 'PENDING') {
    return jsonResponse(400, {
      error: `Cannot delete order with status ${existing.status}. Only PENDING orders can be deleted.`,
    });
  }

  // Delete items first, then order
  await ctx.prisma.orderItem.deleteMany({
    where: { orderId: id },
  });

  await ctx.prisma.order.delete({
    where: { id },
  });

  return jsonResponse(200, { data: { id, deleted: true } });
}

// Route definitions
export const orderRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    path: /^\/api\/orders$/,
    handler: listOrders,
  },
  {
    method: 'GET',
    path: /^\/api\/orders\/(?<id>[^/]+)$/,
    handler: getOrder,
  },
  {
    method: 'POST',
    path: /^\/api\/orders$/,
    handler: createOrder,
  },
  {
    method: 'PUT',
    path: /^\/api\/orders\/(?<id>[^/]+)$/,
    handler: updateOrder,
  },
  {
    method: 'DELETE',
    path: /^\/api\/orders\/(?<id>[^/]+)$/,
    handler: deleteOrder,
  },
];
