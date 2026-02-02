import { api, PaginatedResponse, SingleResponse } from './api';

/**
 * Todo Service
 *
 * Provides type-safe methods for Todo CRUD operations.
 * This replaces the Amplify Data client's Todo model operations.
 */

// Todo interfaces
export interface Todo {
  id: string;
  content: string;
  isDone: boolean;
  priority: number;
  dueDate: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  userId: string;
}

export interface CreateTodoInput {
  content: string;
  priority?: number;
  dueDate?: string;
}

export interface UpdateTodoInput {
  content?: string;
  isDone?: boolean;
  priority?: number;
  dueDate?: string | null;
}

export interface TodoFilters {
  isDone?: boolean;
  limit?: number;
  offset?: number;
}

// API methods
export const todoService = {
  /**
   * List all todos for the current user
   */
  list: (filters: TodoFilters = {}): Promise<PaginatedResponse<Todo>> =>
    api.get('/api/todos', {
      params: {
        isDone: filters.isDone,
        limit: filters.limit || 50,
        offset: filters.offset || 0,
      },
    }),

  /**
   * Get a single todo by ID
   */
  get: (id: string): Promise<SingleResponse<Todo>> =>
    api.get(`/api/todos/${id}`),

  /**
   * Create a new todo
   */
  create: (input: CreateTodoInput): Promise<SingleResponse<Todo>> =>
    api.post('/api/todos', input),

  /**
   * Update an existing todo
   */
  update: (id: string, input: UpdateTodoInput): Promise<SingleResponse<Todo>> =>
    api.put(`/api/todos/${id}`, input),

  /**
   * Delete a todo
   */
  delete: (id: string): Promise<SingleResponse<{ id: string; deleted: boolean }>> =>
    api.delete(`/api/todos/${id}`),

  /**
   * Toggle todo completion status
   */
  toggle: async (id: string, isDone: boolean): Promise<SingleResponse<Todo>> =>
    api.put(`/api/todos/${id}`, { isDone }),
};
