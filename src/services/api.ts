import { fetchAuthSession } from 'aws-amplify/auth';

/**
 * API Client for REST API communication
 *
 * This replaces the Amplify Data client (AppSync/GraphQL) with a REST client
 * that communicates with our Lambda + API Gateway backend.
 */

// API configuration - will be populated from Amplify outputs
let apiEndpoint: string | null = null;

/**
 * Initialize the API client with the endpoint from Amplify outputs
 */
export function initializeApi(endpoint: string): void {
  apiEndpoint = endpoint.replace(/\/$/, ''); // Remove trailing slash
}

/**
 * Get the current auth token from Cognito
 */
async function getAuthToken(): Promise<string> {
  try {
    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString();
    if (!token) {
      throw new Error('No auth token available');
    }
    return token;
  } catch (error) {
    throw new Error('Authentication required');
  }
}

/**
 * API Error class for structured error handling
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Pagination response interface
 */
export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

/**
 * Single item response interface
 */
export interface SingleResponse<T> {
  data: T;
}

/**
 * Request options interface
 */
export interface RequestOptions {
  params?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  skipAuth?: boolean;
}

/**
 * Build URL with query parameters
 */
function buildUrl(path: string, params?: RequestOptions['params']): string {
  if (!apiEndpoint) {
    throw new Error('API not initialized. Call initializeApi() first.');
  }

  const url = new URL(`${apiEndpoint}${path}`);

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, String(value));
      }
    });
  }

  return url.toString();
}

/**
 * Make an authenticated API request
 */
async function request<T>(
  method: string,
  path: string,
  options: RequestOptions & { body?: unknown } = {}
): Promise<T> {
  const { params, headers = {}, skipAuth = false, body } = options;

  // Get auth token unless explicitly skipped
  if (!skipAuth) {
    const token = await getAuthToken();
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Build request
  const url = buildUrl(path, params);
  const requestInit: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  };

  if (body && method !== 'GET') {
    requestInit.body = JSON.stringify(body);
  }

  // Make request
  const response = await fetch(url, requestInit);

  // Parse response
  const data = await response.json().catch(() => ({}));

  // Handle errors
  if (!response.ok) {
    throw new ApiError(
      data.error || data.message || `Request failed with status ${response.status}`,
      response.status,
      data
    );
  }

  return data as T;
}

/**
 * HTTP methods
 */
export const api = {
  /**
   * GET request
   */
  get: <T>(path: string, options?: RequestOptions): Promise<T> =>
    request<T>('GET', path, options),

  /**
   * POST request
   */
  post: <T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> =>
    request<T>('POST', path, { ...options, body }),

  /**
   * PUT request
   */
  put: <T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> =>
    request<T>('PUT', path, { ...options, body }),

  /**
   * PATCH request
   */
  patch: <T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> =>
    request<T>('PATCH', path, { ...options, body }),

  /**
   * DELETE request
   */
  delete: <T>(path: string, options?: RequestOptions): Promise<T> =>
    request<T>('DELETE', path, options),
};

/**
 * Health check
 */
export async function checkHealth(): Promise<{ status: string; timestamp: string; latency: number }> {
  return api.get('/health', { skipAuth: true });
}
