import { api, PaginatedResponse, SingleResponse } from './api';

/**
 * User Service
 *
 * Provides type-safe methods for User operations.
 */

// User interfaces
export interface User {
  id: string;
  cognitoSub: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  phone: string | null;
  isActive: boolean;
  emailVerified: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  organizationId: string | null;
  organization?: Organization | null;
  roles?: UserRoleWithRole[];
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;
  website: string | null;
  isActive: boolean;
}

export interface Role {
  id: string;
  name: string;
  description: string | null;
  permissions: unknown;
}

export interface UserRoleWithRole {
  userId: string;
  roleId: string;
  assignedAt: string;
  role: Role;
}

export interface UpdateUserInput {
  firstName?: string;
  lastName?: string;
  phone?: string;
  avatarUrl?: string;
}

export interface CreateUserInput {
  cognitoSub: string;
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  organizationId?: string;
  roleIds?: string[];
}

export interface UserFilters {
  organizationId?: string;
  isActive?: boolean;
  limit?: number;
  offset?: number;
}

// API methods
export const userService = {
  /**
   * Get current user's profile
   */
  getCurrentUser: (): Promise<SingleResponse<User>> =>
    api.get('/api/users/me'),

  /**
   * Update current user's profile
   */
  updateCurrentUser: (input: UpdateUserInput): Promise<SingleResponse<User>> =>
    api.put('/api/users/me', input),

  /**
   * List all users (admin only)
   */
  list: (filters: UserFilters = {}): Promise<PaginatedResponse<User>> =>
    api.get('/api/users', {
      params: {
        organizationId: filters.organizationId,
        isActive: filters.isActive,
        limit: filters.limit || 50,
        offset: filters.offset || 0,
      },
    }),

  /**
   * Get a user by ID
   */
  get: (id: string): Promise<SingleResponse<User>> =>
    api.get(`/api/users/${id}`),

  /**
   * Create a new user (admin only)
   */
  create: (input: CreateUserInput): Promise<SingleResponse<User>> =>
    api.post('/api/users', input),

  /**
   * Update a user (admin only)
   */
  update: (id: string, input: Partial<CreateUserInput> & { isActive?: boolean }): Promise<SingleResponse<User>> =>
    api.put(`/api/users/${id}`, input),

  /**
   * Delete a user (admin only)
   */
  delete: (id: string): Promise<SingleResponse<{ id: string; deleted: boolean }>> =>
    api.delete(`/api/users/${id}`),
};
