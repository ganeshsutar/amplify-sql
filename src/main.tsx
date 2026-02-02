import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { Amplify } from "aws-amplify";
import App from "./App.tsx";
import "./index.css";
import outputs from "../amplify_outputs.json";
import { initializeApi } from "./services/api";

// Configure Amplify for authentication
Amplify.configure(outputs);

// Initialize API client with the custom endpoint
// The endpoint comes from our CDK stack outputs
const apiEndpoint = (outputs as { custom?: { apiEndpoint?: string } }).custom?.apiEndpoint;
if (apiEndpoint) {
  initializeApi(apiEndpoint);
} else {
  console.warn("API endpoint not found in outputs. API calls will fail.");
}

// Create React Query client with sensible defaults
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Stale time: how long data is considered fresh
      staleTime: 1000 * 60 * 1, // 1 minute
      // Cache time: how long inactive data stays in cache
      gcTime: 1000 * 60 * 5, // 5 minutes
      // Retry failed requests
      retry: 2,
      // Refetch on window focus
      refetchOnWindowFocus: true,
    },
    mutations: {
      // Retry mutations once on failure
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      {/* React Query Devtools - only in development */}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  </React.StrictMode>
);
