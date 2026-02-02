import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { RouteContext, RouteDefinition } from '../handler';

/**
 * Todo CRUD operations
 * Migrated from AppSync/DynamoDB to REST/PostgreSQL
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
 * List all todos for the current user
 * GET /api/todos
 */
async function listTodos(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  const queryParams = event.queryStringParameters || {};
  const limit = Math.min(parseInt(queryParams.limit || '50'), 100);
  const offset = parseInt(queryParams.offset || '0');
  const isDone = queryParams.isDone ? queryParams.isDone === 'true' : undefined;

  // First, ensure user exists in our database
  let user = await ctx.prisma.user.findUnique({
    where: { cognitoSub: ctx.userId },
  });

  if (!user) {
    // Create user if first time
    user = await ctx.prisma.user.create({
      data: {
        cognitoSub: ctx.userId,
        email: ctx.userEmail,
      },
    });
  }

  const todos = await ctx.prisma.todo.findMany({
    where: {
      userId: user.id,
      ...(isDone !== undefined && { isDone }),
    },
    orderBy: [{ isDone: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
    take: limit,
    skip: offset,
  });

  const total = await ctx.prisma.todo.count({
    where: {
      userId: user.id,
      ...(isDone !== undefined && { isDone }),
    },
  });

  return jsonResponse(200, {
    data: todos,
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + todos.length < total,
    },
  });
}

/**
 * Get a single todo by ID
 * GET /api/todos/:id
 */
async function getTodo(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  const id = event.pathParameters?.id;
  if (!id) {
    return jsonResponse(400, { error: 'Todo ID is required' });
  }

  const user = await ctx.prisma.user.findUnique({
    where: { cognitoSub: ctx.userId },
  });

  if (!user) {
    return jsonResponse(404, { error: 'User not found' });
  }

  const todo = await ctx.prisma.todo.findFirst({
    where: {
      id,
      userId: user.id,
    },
  });

  if (!todo) {
    return jsonResponse(404, { error: 'Todo not found' });
  }

  return jsonResponse(200, { data: todo });
}

/**
 * Create a new todo
 * POST /api/todos
 */
async function createTodo(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  if (!event.body) {
    return jsonResponse(400, { error: 'Request body is required' });
  }

  const body = JSON.parse(event.body);

  if (!body.content || typeof body.content !== 'string') {
    return jsonResponse(400, { error: 'Content is required and must be a string' });
  }

  // Ensure user exists
  let user = await ctx.prisma.user.findUnique({
    where: { cognitoSub: ctx.userId },
  });

  if (!user) {
    user = await ctx.prisma.user.create({
      data: {
        cognitoSub: ctx.userId,
        email: ctx.userEmail,
      },
    });
  }

  const todo = await ctx.prisma.todo.create({
    data: {
      content: body.content,
      priority: body.priority || 0,
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      userId: user.id,
    },
  });

  // Create audit log
  await ctx.prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'CREATE',
      entityType: 'Todo',
      entityId: todo.id,
      changes: { after: todo },
    },
  });

  return jsonResponse(201, { data: todo });
}

/**
 * Update a todo
 * PUT /api/todos/:id
 */
async function updateTodo(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  const id = event.pathParameters?.id;
  if (!id) {
    return jsonResponse(400, { error: 'Todo ID is required' });
  }

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

  // Check if todo exists and belongs to user
  const existingTodo = await ctx.prisma.todo.findFirst({
    where: {
      id,
      userId: user.id,
    },
  });

  if (!existingTodo) {
    return jsonResponse(404, { error: 'Todo not found' });
  }

  // Build update data
  const updateData: Record<string, unknown> = {};
  if (body.content !== undefined) updateData.content = body.content;
  if (body.isDone !== undefined) {
    updateData.isDone = body.isDone;
    updateData.completedAt = body.isDone ? new Date() : null;
  }
  if (body.priority !== undefined) updateData.priority = body.priority;
  if (body.dueDate !== undefined) updateData.dueDate = body.dueDate ? new Date(body.dueDate) : null;

  const todo = await ctx.prisma.todo.update({
    where: { id },
    data: updateData,
  });

  // Create audit log
  await ctx.prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'UPDATE',
      entityType: 'Todo',
      entityId: todo.id,
      changes: { before: existingTodo, after: todo },
    },
  });

  return jsonResponse(200, { data: todo });
}

/**
 * Delete a todo
 * DELETE /api/todos/:id
 */
async function deleteTodo(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  const id = event.pathParameters?.id;
  if (!id) {
    return jsonResponse(400, { error: 'Todo ID is required' });
  }

  const user = await ctx.prisma.user.findUnique({
    where: { cognitoSub: ctx.userId },
  });

  if (!user) {
    return jsonResponse(404, { error: 'User not found' });
  }

  // Check if todo exists and belongs to user
  const existingTodo = await ctx.prisma.todo.findFirst({
    where: {
      id,
      userId: user.id,
    },
  });

  if (!existingTodo) {
    return jsonResponse(404, { error: 'Todo not found' });
  }

  await ctx.prisma.todo.delete({
    where: { id },
  });

  // Create audit log
  await ctx.prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'DELETE',
      entityType: 'Todo',
      entityId: id,
      changes: { before: existingTodo },
    },
  });

  return jsonResponse(200, { data: { id, deleted: true } });
}

// Route definitions
export const todoRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    path: /^\/api\/todos$/,
    handler: listTodos,
  },
  {
    method: 'GET',
    path: /^\/api\/todos\/(?<id>[^/]+)$/,
    handler: getTodo,
  },
  {
    method: 'POST',
    path: /^\/api\/todos$/,
    handler: createTodo,
  },
  {
    method: 'PUT',
    path: /^\/api\/todos\/(?<id>[^/]+)$/,
    handler: updateTodo,
  },
  {
    method: 'DELETE',
    path: /^\/api\/todos\/(?<id>[^/]+)$/,
    handler: deleteTodo,
  },
];
