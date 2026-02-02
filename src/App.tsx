import { Authenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import { useTodos, useCreateTodo, useDeleteTodo, useToggleTodo } from "./hooks/useTodos";
import { useCurrentUser } from "./hooks/useUsers";
import type { Todo } from "./services/todos";

/**
 * Main App component with Cognito authentication and Todo management
 *
 * This replaces the previous AppSync/observeQuery pattern with:
 * - Authenticator component for login/signup UI
 * - React Query hooks for data fetching and mutations
 * - Optimistic updates for better UX
 */

function TodoList() {
  // Fetch todos using React Query
  const { data: todosResponse, isLoading, error } = useTodos();
  const createTodo = useCreateTodo();
  const deleteTodo = useDeleteTodo();
  const toggleTodo = useToggleTodo();

  // Get current user for display
  const { data: userResponse } = useCurrentUser();
  const user = userResponse?.data;

  const todos = todosResponse?.data || [];

  function handleCreateTodo() {
    const content = window.prompt("Todo content");
    if (content) {
      createTodo.mutate({ content });
    }
  }

  function handleToggleTodo(todo: Todo) {
    toggleTodo.mutate(todo.id, !todo.isDone);
  }

  function handleDeleteTodo(id: string) {
    if (window.confirm("Delete this todo?")) {
      deleteTodo.mutate(id);
    }
  }

  if (isLoading) {
    return (
      <div className="loading">
        <p>Loading todos...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error">
        <p>Error loading todos: {error.message}</p>
        <button onClick={() => window.location.reload()}>Retry</button>
      </div>
    );
  }

  return (
    <main>
      <header>
        <h1>My Todos</h1>
        {user && (
          <p className="user-info">
            Welcome, {user.firstName || user.email}!
          </p>
        )}
      </header>

      <section className="todo-actions">
        <button
          onClick={handleCreateTodo}
          disabled={createTodo.isPending}
          className="create-button"
        >
          {createTodo.isPending ? "Creating..." : "+ New Todo"}
        </button>
      </section>

      {todos.length === 0 ? (
        <div className="empty-state">
          <p>No todos yet. Create your first one!</p>
        </div>
      ) : (
        <ul className="todo-list">
          {todos.map((todo) => (
            <li
              key={todo.id}
              className={`todo-item ${todo.isDone ? "completed" : ""}`}
            >
              <input
                type="checkbox"
                checked={todo.isDone}
                onChange={() => handleToggleTodo(todo)}
                className="todo-checkbox"
              />
              <span className="todo-content">{todo.content}</span>
              <button
                onClick={() => handleDeleteTodo(todo.id)}
                disabled={deleteTodo.isPending}
                className="delete-button"
                aria-label="Delete todo"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <footer>
        <p className="stats">
          {todos.filter((t) => !t.isDone).length} of {todos.length} remaining
        </p>
        <p className="info">
          🚀 Powered by Aurora PostgreSQL + Lambda + API Gateway
        </p>
      </footer>
    </main>
  );
}

function App() {
  return (
    <Authenticator>
      {({ signOut, user }) => (
        <div className="app-container">
          <nav className="app-nav">
            <span>Logged in as: {user?.signInDetails?.loginId}</span>
            <button onClick={signOut} className="signout-button">
              Sign Out
            </button>
          </nav>
          <TodoList />
        </div>
      )}
    </Authenticator>
  );
}

export default App;
