import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { userService, User, UpdateUserInput, CreateUserInput, UserFilters } from '../services/users';

/**
 * React Query hooks for User operations
 */

// Query keys for cache management
export const userKeys = {
  all: ['users'] as const,
  lists: () => [...userKeys.all, 'list'] as const,
  list: (filters: UserFilters) => [...userKeys.lists(), filters] as const,
  details: () => [...userKeys.all, 'detail'] as const,
  detail: (id: string) => [...userKeys.details(), id] as const,
  currentUser: () => [...userKeys.all, 'me'] as const,
};

/**
 * Hook to fetch the current user
 */
export function useCurrentUser() {
  return useQuery({
    queryKey: userKeys.currentUser(),
    queryFn: () => userService.getCurrentUser(),
    staleTime: 5 * 60 * 1000, // Consider fresh for 5 minutes
  });
}

/**
 * Hook to update the current user
 */
export function useUpdateCurrentUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateUserInput) => userService.updateCurrentUser(input),
    onSuccess: (data) => {
      queryClient.setQueryData(userKeys.currentUser(), data);
    },
  });
}

/**
 * Hook to fetch list of users (admin)
 */
export function useUsers(filters: UserFilters = {}) {
  return useQuery({
    queryKey: userKeys.list(filters),
    queryFn: () => userService.list(filters),
  });
}

/**
 * Hook to fetch a single user
 */
export function useUser(id: string) {
  return useQuery({
    queryKey: userKeys.detail(id),
    queryFn: () => userService.get(id),
    enabled: !!id,
  });
}

/**
 * Hook to create a user (admin)
 */
export function useCreateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateUserInput) => userService.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.lists() });
    },
  });
}

/**
 * Hook to update a user (admin)
 */
export function useUpdateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<CreateUserInput> & { isActive?: boolean } }) =>
      userService.update(id, input),
    onSuccess: (data, { id }) => {
      queryClient.setQueryData(userKeys.detail(id), data);
      queryClient.invalidateQueries({ queryKey: userKeys.lists() });
    },
  });
}

/**
 * Hook to delete a user (admin)
 */
export function useDeleteUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => userService.delete(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: userKeys.lists() });
      queryClient.removeQueries({ queryKey: userKeys.detail(id) });
    },
  });
}
