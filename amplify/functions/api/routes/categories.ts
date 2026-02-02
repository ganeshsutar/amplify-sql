import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { RouteContext, RouteDefinition } from '../handler';

/**
 * Category management operations (hierarchical)
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

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * List categories (optionally as tree)
 * GET /api/categories
 */
async function listCategories(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  const queryParams = event.queryStringParameters || {};
  const parentId = queryParams.parentId;
  const flat = queryParams.flat === 'true';
  const isActive = queryParams.isActive ? queryParams.isActive === 'true' : undefined;

  const where: Record<string, unknown> = {};
  if (isActive !== undefined) where.isActive = isActive;

  if (flat) {
    // Return flat list
    const categories = await ctx.prisma.category.findMany({
      where,
      include: {
        _count: {
          select: { products: true, children: true },
        },
      },
      orderBy: [{ parentId: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });

    return jsonResponse(200, { data: categories });
  }

  // Return hierarchical - get root or specific parent's children
  where.parentId = parentId || null;

  const categories = await ctx.prisma.category.findMany({
    where,
    include: {
      children: {
        include: {
          children: {
            include: {
              _count: {
                select: { products: true },
              },
            },
            orderBy: { sortOrder: 'asc' },
          },
          _count: {
            select: { products: true },
          },
        },
        orderBy: { sortOrder: 'asc' },
      },
      _count: {
        select: { products: true },
      },
    },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });

  return jsonResponse(200, { data: categories });
}

/**
 * Get category by ID
 * GET /api/categories/:id
 */
async function getCategory(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  const id = event.pathParameters?.id;
  if (!id) {
    return jsonResponse(400, { error: 'Category ID is required' });
  }

  const category = await ctx.prisma.category.findUnique({
    where: { id },
    include: {
      parent: true,
      children: {
        orderBy: { sortOrder: 'asc' },
      },
      products: {
        where: { isActive: true },
        take: 10,
        orderBy: { name: 'asc' },
      },
      _count: {
        select: { products: true, children: true },
      },
    },
  });

  if (!category) {
    return jsonResponse(404, { error: 'Category not found' });
  }

  return jsonResponse(200, { data: category });
}

/**
 * Create a new category
 * POST /api/categories
 */
async function createCategory(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  if (!event.body) {
    return jsonResponse(400, { error: 'Request body is required' });
  }

  const body = JSON.parse(event.body);

  if (!body.name) {
    return jsonResponse(400, { error: 'Name is required' });
  }

  const slug = body.slug || slugify(body.name);

  // Check for duplicate slug under same parent
  const existing = await ctx.prisma.category.findFirst({
    where: {
      slug,
      parentId: body.parentId || null,
    },
  });

  if (existing) {
    return jsonResponse(409, { error: 'Category with this slug already exists under the same parent' });
  }

  // Validate parent exists if provided
  if (body.parentId) {
    const parent = await ctx.prisma.category.findUnique({
      where: { id: body.parentId },
    });
    if (!parent) {
      return jsonResponse(400, { error: 'Parent category not found' });
    }
  }

  // Get next sort order
  const maxSortOrder = await ctx.prisma.category.aggregate({
    where: { parentId: body.parentId || null },
    _max: { sortOrder: true },
  });

  const category = await ctx.prisma.category.create({
    data: {
      name: body.name,
      slug,
      description: body.description,
      imageUrl: body.imageUrl,
      sortOrder: body.sortOrder ?? (maxSortOrder._max.sortOrder ?? 0) + 1,
      parentId: body.parentId,
    },
    include: {
      parent: true,
    },
  });

  return jsonResponse(201, { data: category });
}

/**
 * Update a category
 * PUT /api/categories/:id
 */
async function updateCategory(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  const id = event.pathParameters?.id;
  if (!id) {
    return jsonResponse(400, { error: 'Category ID is required' });
  }

  if (!event.body) {
    return jsonResponse(400, { error: 'Request body is required' });
  }

  const body = JSON.parse(event.body);

  const existing = await ctx.prisma.category.findUnique({
    where: { id },
  });

  if (!existing) {
    return jsonResponse(404, { error: 'Category not found' });
  }

  // Check for slug conflict
  if (body.slug && body.slug !== existing.slug) {
    const slugConflict = await ctx.prisma.category.findFirst({
      where: {
        slug: body.slug,
        parentId: body.parentId ?? existing.parentId,
        id: { not: id },
      },
    });
    if (slugConflict) {
      return jsonResponse(409, { error: 'Another category with this slug already exists under the same parent' });
    }
  }

  // Prevent circular parent reference
  if (body.parentId) {
    if (body.parentId === id) {
      return jsonResponse(400, { error: 'Category cannot be its own parent' });
    }

    // Check if new parent is a descendant of current category
    const isDescendant = await checkIsDescendant(ctx.prisma, body.parentId, id);
    if (isDescendant) {
      return jsonResponse(400, { error: 'Cannot set a descendant as parent' });
    }
  }

  const updateData: Record<string, unknown> = {};
  if (body.name !== undefined) updateData.name = body.name;
  if (body.slug !== undefined) updateData.slug = body.slug;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.imageUrl !== undefined) updateData.imageUrl = body.imageUrl;
  if (body.sortOrder !== undefined) updateData.sortOrder = body.sortOrder;
  if (body.isActive !== undefined) updateData.isActive = body.isActive;
  if (body.parentId !== undefined) updateData.parentId = body.parentId;

  const category = await ctx.prisma.category.update({
    where: { id },
    data: updateData,
    include: {
      parent: true,
      children: true,
    },
  });

  return jsonResponse(200, { data: category });
}

/**
 * Check if targetId is a descendant of ancestorId
 */
async function checkIsDescendant(
  prisma: RouteContext['prisma'],
  targetId: string,
  ancestorId: string
): Promise<boolean> {
  const target = await prisma.category.findUnique({
    where: { id: targetId },
    select: { parentId: true },
  });

  if (!target || !target.parentId) {
    return false;
  }

  if (target.parentId === ancestorId) {
    return true;
  }

  return checkIsDescendant(prisma, target.parentId, ancestorId);
}

/**
 * Delete a category
 * DELETE /api/categories/:id
 */
async function deleteCategory(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  const id = event.pathParameters?.id;
  if (!id) {
    return jsonResponse(400, { error: 'Category ID is required' });
  }

  const existing = await ctx.prisma.category.findUnique({
    where: { id },
    include: {
      _count: {
        select: { products: true, children: true },
      },
    },
  });

  if (!existing) {
    return jsonResponse(404, { error: 'Category not found' });
  }

  if (existing._count.children > 0) {
    return jsonResponse(400, { error: 'Cannot delete category with sub-categories' });
  }

  if (existing._count.products > 0) {
    // Soft delete
    await ctx.prisma.category.update({
      where: { id },
      data: { isActive: false },
    });
  } else {
    // Hard delete
    await ctx.prisma.category.delete({ where: { id } });
  }

  return jsonResponse(200, { data: { id, deleted: true } });
}

// Route definitions
export const categoryRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    path: /^\/api\/categories$/,
    handler: listCategories,
  },
  {
    method: 'GET',
    path: /^\/api\/categories\/(?<id>[^/]+)$/,
    handler: getCategory,
  },
  {
    method: 'POST',
    path: /^\/api\/categories$/,
    handler: createCategory,
  },
  {
    method: 'PUT',
    path: /^\/api\/categories\/(?<id>[^/]+)$/,
    handler: updateCategory,
  },
  {
    method: 'DELETE',
    path: /^\/api\/categories\/(?<id>[^/]+)$/,
    handler: deleteCategory,
  },
];
