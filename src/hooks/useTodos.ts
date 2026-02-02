import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { todoService, Todo, CreateTodoInput, UpdateTodoInput, TodoFilters } from '../services/todos';

/**
 * React Query hooks for Todo operations
 *
 * These hooks replace the Amplify Data client's observeQuery and mutation patterns
 * with React Query's data fetching and caching capabilities.
 *
 * Benefits over observeQuery:
 * - Automatic caching and cache invalidation
 * - Optimistic updates for better UX
 * - Automatic retries on failure
 * - Background refetching
 * - Devtools for debugging
 */

// Query keys for cache management
export const todoKeys = {
  all: ['todos'] as const,
  lists: () => [...todoKeys.all, 'list'] as const,
  list: (filters: TodoFilters) => [...todoKeys.lists(), filters] as const,
  details: () => [...todoKeys.all, 'detail'] as const,
  detail: (id: string) => [...todoKeys.details(), id] as const,
};

/**
 * Hook to fetch list of todos
 */
export function useTodos(filters: TodoFilters = {}) {
  return useQuery({
    queryKey: todoKeys.list(filters),
    queryFn: () => todoService.list(filters),
    // Refetch every 30 seconds for "real-time" updates
    refetchInterval: 30000,
  });
}

/**
 * Hook to fetch a single todo
 */
export function useTodo(id: string) {
  return useQuery({
    queryKey: todoKeys.detail(id),
    queryFn: () => todoService.get(id),
    enabled: !!id,
  });
}

/**
 * Hook to create a new todo
 */
export function useCreateTodo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateTodoInput) => todoService.create(input),
    onSuccess: () => {
      // Invalidate all todo lists to refetch
      queryClient.invalidateQueries({ queryKey: todoKeys.lists() });
    },
  });
}

/**
 * Hook to update a todo
 */
export function useUpdateTodo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateTodoInput }) =>
      todoService.update(id, input),
    onMutate: async ({ id, input }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: todoKeys.lists() });

      // Snapshot previous value for rollback
      const previousTodos = queryClient.getQueryData(todoKeys.lists());

      // Optimistically update the cache
      queryClient.setQueriesData(
        { queryKey: todoKeys.lists() },
        (old: { data: Todo[] } | undefined) => {
          if (!old) return old;
          return {
            ...old,
            data: old.data.map((todo) =>
              todo.id === id ? { ...todo, ...input } : todo
            ),
          };
        }
      );

      return { previousTodos };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousTodos) {
        queryClient.setQueriesData(
          { queryKey: todoKeys.lists() },
          context.previousTodos
        );
      }
    },
    onSettled: () => {
      // Refetch after mutation settles
      queryClient.invalidateQueries({ queryKey: todoKeys.lists() });
    },
  });
}

/**
 * Hook to delete a todo
 */
export function useDeleteTodo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => todoService.delete(id),
    onMutate: async (id) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: todoKeys.lists() });

      // Snapshot previous value for rollback
      const previousTodos = queryClient.getQueryData(todoKeys.lists());

      // Optimistically remove from cache
      queryClient.setQueriesData(
        { queryKey: todoKeys.lists() },
        (old: { data: Todo[] } | undefined) => {
          if (!old) return old;
          return {
            ...old,
            data: old.data.filter((todo) => todo.id !== id),
          };
        }
      );

      return { previousTodos };
    },
    onError: (err, id, context) => {
      // Rollback on error
      if (context?.previousTodos) {
        queryClient.setQueriesData(
          { queryKey: todoKeys.lists() },
          context.previousTodos
        );
      }
    },
    onSettled: () => {
      // Refetch after mutation settles
      queryClient.invalidateQueries({ queryKey: todoKeys.lists() });
    },
  });
}

/**
 * Hook to toggle todo completion
 */
export function useToggleTodo() {
  const updateMutation = useUpdateTodo();

  return {
    ...updateMutation,
    mutate: (id: string, isDone: boolean) =>
      updateMutation.mutate({ id, input: { isDone } }),
    mutateAsync: (id: string, isDone: boolean) =>
      updateMutation.mutateAsync({ id, input: { isDone } }),
  };
}
