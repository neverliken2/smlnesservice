/**
 * Standard API response envelope
 */
export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  error: null;
  requestId: string;
  timestamp: string;
}

export interface ApiErrorResponse {
  success: false;
  data: null;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId: string;
  timestamp: string;
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;
