import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { RouteContext, RouteDefinition } from '../handler';

/**
 * Organization management operations
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
 * List organizations
 * GET /api/organizations
 */
async function listOrganizations(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  const queryParams = event.queryStringParameters || {};
  const limit = Math.min(parseInt(queryParams.limit || '50'), 100);
  const offset = parseInt(queryParams.offset || '0');
  const isActive = queryParams.isActive ? queryParams.isActive === 'true' : undefined;

  const where: Record<string, unknown> = {};
  if (isActive !== undefined) {
    where.isActive = isActive;
  }

  const organizations = await ctx.prisma.organization.findMany({
    where,
    include: {
      _count: {
        select: { users: true, products: true, warehouses: true },
      },
    },
    orderBy: { name: 'asc' },
    take: limit,
    skip: offset,
  });

  const total = await ctx.prisma.organization.count({ where });

  return jsonResponse(200, {
    data: organizations,
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + organizations.length < total,
    },
  });
}

/**
 * Get organization by ID
 * GET /api/organizations/:id
 */
async function getOrganization(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  const id = event.pathParameters?.id;
  if (!id) {
    return jsonResponse(400, { error: 'Organization ID is required' });
  }

  const organization = await ctx.prisma.organization.findUnique({
    where: { id },
    include: {
      _count: {
        select: { users: true, products: true, warehouses: true },
      },
    },
  });

  if (!organization) {
    return jsonResponse(404, { error: 'Organization not found' });
  }

  return jsonResponse(200, { data: organization });
}

/**
 * Create a new organization
 * POST /api/organizations
 */
async function createOrganization(
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

  // Generate slug if not provided
  const slug = body.slug || slugify(body.name);

  // Check for existing slug
  const existing = await ctx.prisma.organization.findUnique({
    where: { slug },
  });

  if (existing) {
    return jsonResponse(409, { error: 'Organization with this slug already exists' });
  }

  const organization = await ctx.prisma.organization.create({
    data: {
      name: body.name,
      slug,
      description: body.description,
      logoUrl: body.logoUrl,
      website: body.website,
      settings: body.settings || {},
    },
  });

  return jsonResponse(201, { data: organization });
}

/**
 * Update an organization
 * PUT /api/organizations/:id
 */
async function updateOrganization(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  const id = event.pathParameters?.id;
  if (!id) {
    return jsonResponse(400, { error: 'Organization ID is required' });
  }

  if (!event.body) {
    return jsonResponse(400, { error: 'Request body is required' });
  }

  const body = JSON.parse(event.body);

  const existing = await ctx.prisma.organization.findUnique({
    where: { id },
  });

  if (!existing) {
    return jsonResponse(404, { error: 'Organization not found' });
  }

  const updateData: Record<string, unknown> = {};
  if (body.name !== undefined) updateData.name = body.name;
  if (body.slug !== undefined) updateData.slug = body.slug;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.logoUrl !== undefined) updateData.logoUrl = body.logoUrl;
  if (body.website !== undefined) updateData.website = body.website;
  if (body.isActive !== undefined) updateData.isActive = body.isActive;
  if (body.settings !== undefined) updateData.settings = body.settings;

  const organization = await ctx.prisma.organization.update({
    where: { id },
    data: updateData,
  });

  return jsonResponse(200, { data: organization });
}

/**
 * Delete an organization
 * DELETE /api/organizations/:id
 */
async function deleteOrganization(
  event: APIGatewayProxyEventV2,
  ctx: RouteContext
): Promise<APIGatewayProxyResultV2> {
  const id = event.pathParameters?.id;
  if (!id) {
    return jsonResponse(400, { error: 'Organization ID is required' });
  }

  const existing = await ctx.prisma.organization.findUnique({
    where: { id },
    include: {
      _count: {
        select: { users: true },
      },
    },
  });

  if (!existing) {
    return jsonResponse(404, { error: 'Organization not found' });
  }

  if (existing._count.users > 0) {
    return jsonResponse(400, { error: 'Cannot delete organization with existing users' });
  }

  // Soft delete
  await ctx.prisma.organization.update({
    where: { id },
    data: { isActive: false },
  });

  return jsonResponse(200, { data: { id, deleted: true } });
}

// Route definitions
export const organizationRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    path: /^\/api\/organizations$/,
    handler: listOrganizations,
  },
  {
    method: 'GET',
    path: /^\/api\/organizations\/(?<id>[^/]+)$/,
    handler: getOrganization,
  },
  {
    method: 'POST',
    path: /^\/api\/organizations$/,
    handler: createOrganization,
  },
  {
    method: 'PUT',
    path: /^\/api\/organizations\/(?<id>[^/]+)$/,
    handler: updateOrganization,
  },
  {
    method: 'DELETE',
    path: /^\/api\/organizations\/(?<id>[^/]+)$/,
    handler: deleteOrganization,
  },
];
