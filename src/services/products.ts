import { api, PaginatedResponse, SingleResponse } from './api';

/**
 * Product Service
 *
 * Provides type-safe methods for Product operations.
 */

// Product interfaces
export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  barcode: string | null;
  unitPrice: string; // Decimal as string
  costPrice: string | null;
  weight: string | null;
  dimensions: {
    length?: number;
    width?: number;
    height?: number;
    unit?: string;
  } | null;
  minStockLevel: number;
  maxStockLevel: number | null;
  reorderPoint: number;
  isActive: boolean;
  isTaxable: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  organizationId: string;
  categoryId: string | null;
  category?: Category | null;
  stockItems?: StockItem[];
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

export interface StockItem {
  id: string;
  quantity: number;
  reservedQty: number;
  availableQty: number;
  warehouseId: string;
  warehouse?: {
    id: string;
    name: string;
    code: string;
  };
}

export interface CreateProductInput {
  sku: string;
  name: string;
  organizationId: string;
  description?: string;
  barcode?: string;
  unitPrice: number;
  costPrice?: number;
  weight?: number;
  dimensions?: {
    length?: number;
    width?: number;
    height?: number;
    unit?: string;
  };
  minStockLevel?: number;
  maxStockLevel?: number;
  reorderPoint?: number;
  isTaxable?: boolean;
  categoryId?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateProductInput {
  sku?: string;
  name?: string;
  description?: string;
  barcode?: string;
  unitPrice?: number;
  costPrice?: number;
  weight?: number;
  dimensions?: {
    length?: number;
    width?: number;
    height?: number;
    unit?: string;
  };
  minStockLevel?: number;
  maxStockLevel?: number;
  reorderPoint?: number;
  isActive?: boolean;
  isTaxable?: boolean;
  categoryId?: string;
  metadata?: Record<string, unknown>;
}

export interface ProductFilters {
  organizationId?: string;
  categoryId?: string;
  isActive?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

// API methods
export const productService = {
  /**
   * List products with filtering
   */
  list: (filters: ProductFilters = {}): Promise<PaginatedResponse<Product>> =>
    api.get('/api/products', {
      params: {
        organizationId: filters.organizationId,
        categoryId: filters.categoryId,
        isActive: filters.isActive,
        search: filters.search,
        limit: filters.limit || 50,
        offset: filters.offset || 0,
      },
    }),

  /**
   * Get a product by ID
   */
  get: (id: string): Promise<SingleResponse<Product>> =>
    api.get(`/api/products/${id}`),

  /**
   * Create a new product
   */
  create: (input: CreateProductInput): Promise<SingleResponse<Product>> =>
    api.post('/api/products', input),

  /**
   * Update a product
   */
  update: (id: string, input: UpdateProductInput): Promise<SingleResponse<Product>> =>
    api.put(`/api/products/${id}`, input),

  /**
   * Delete a product
   */
  delete: (id: string): Promise<SingleResponse<{ id: string; deleted: boolean }>> =>
    api.delete(`/api/products/${id}`),
};
