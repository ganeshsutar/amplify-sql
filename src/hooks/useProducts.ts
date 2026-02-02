import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productService, CreateProductInput, UpdateProductInput, ProductFilters } from '../services/products';

/**
 * React Query hooks for Product operations
 */

// Query keys for cache management
export const productKeys = {
  all: ['products'] as const,
  lists: () => [...productKeys.all, 'list'] as const,
  list: (filters: ProductFilters) => [...productKeys.lists(), filters] as const,
  details: () => [...productKeys.all, 'detail'] as const,
  detail: (id: string) => [...productKeys.details(), id] as const,
};

/**
 * Hook to fetch list of products
 */
export function useProducts(filters: ProductFilters = {}) {
  return useQuery({
    queryKey: productKeys.list(filters),
    queryFn: () => productService.list(filters),
  });
}

/**
 * Hook to fetch a single product
 */
export function useProduct(id: string) {
  return useQuery({
    queryKey: productKeys.detail(id),
    queryFn: () => productService.get(id),
    enabled: !!id,
  });
}

/**
 * Hook to create a product
 */
export function useCreateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateProductInput) => productService.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productKeys.lists() });
    },
  });
}

/**
 * Hook to update a product
 */
export function useUpdateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateProductInput }) =>
      productService.update(id, input),
    onSuccess: (data, { id }) => {
      queryClient.setQueryData(productKeys.detail(id), data);
      queryClient.invalidateQueries({ queryKey: productKeys.lists() });
    },
  });
}

/**
 * Hook to delete a product
 */
export function useDeleteProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => productService.delete(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: productKeys.lists() });
      queryClient.removeQueries({ queryKey: productKeys.detail(id) });
    },
  });
}

/**
 * Hook to search products
 */
export function useProductSearch(search: string, filters: Omit<ProductFilters, 'search'> = {}) {
  return useQuery({
    queryKey: productKeys.list({ ...filters, search }),
    queryFn: () => productService.list({ ...filters, search }),
    enabled: search.length >= 2, // Only search with 2+ characters
  });
}
