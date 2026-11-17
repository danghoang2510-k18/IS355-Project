/**
 * HTTP client dùng chung để Frontend giao tiếp với DSCT FastAPI Backend.
 *
 * Cấu hình trong frontend/.env.local:
 *   VITE_API_BASE_URL=http://localhost:8000
 *
 * Lưu ý: Không đặt PINATA_JWT, private key hoặc secret của Backend ở đây.
 */

export interface ApiEnvelope<T> {
  data: T;
  meta?: {
    requestId?: string;
    [key: string]: unknown;
  };
}

export interface ApiErrorBody {
  code?: string;
  message?: string;
  requestId?: string;
  details?: unknown;
}

interface ApiErrorEnvelope {
  error?: ApiErrorBody;
  detail?: unknown;
}

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: HeadersInit;
  body?: unknown;
  signal?: AbortSignal;
  credentials?: RequestCredentials;
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "")
  .trim()
  .replace(/\/+$/, "");

/** Lỗi HTTP/API đã chuẩn hóa để component có thể kiểm tra status và code. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;
  readonly details?: unknown;
  readonly retryAfterSeconds?: number;

  constructor(args: {
    message: string;
    status: number;
    code: string;
    requestId?: string;
    details?: unknown;
    retryAfterSeconds?: number;
  }) {
    super(args.message);
    this.name = "ApiError";
    this.status = args.status;
    this.code = args.code;
    this.requestId = args.requestId;
    this.details = args.details;
    this.retryAfterSeconds = args.retryAfterSeconds;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function readResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;

  const text = await response.text();
  if (!text) return undefined;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;

  const dateMilliseconds = Date.parse(value);
  if (!Number.isFinite(dateMilliseconds)) return undefined;

  return Math.max(0, Math.ceil((dateMilliseconds - Date.now()) / 1000));
}

function createApiError(response: Response, body: unknown): ApiError {
  const envelope = isRecord(body) ? (body as ApiErrorEnvelope) : undefined;
  const apiError = envelope?.error;
  const fallbackDetail = envelope?.detail;

  const requestId =
    apiError?.requestId ?? response.headers.get("X-Request-ID") ?? undefined;

  let fallbackMessage = `Yêu cầu API thất bại (HTTP ${response.status}).`;
  if (typeof fallbackDetail === "string") {
    fallbackMessage = fallbackDetail;
  } else if (Array.isArray(fallbackDetail)) {
    fallbackMessage = "Dữ liệu gửi lên không hợp lệ.";
  }

  return new ApiError({
    message:
      typeof apiError?.message === "string" && apiError.message.trim()
        ? apiError.message
        : fallbackMessage,
    status: response.status,
    code:
      typeof apiError?.code === "string" && apiError.code.trim()
        ? apiError.code
        : `HTTP_${response.status}`,
    requestId,
    details: apiError?.details ?? fallbackDetail,
    retryAfterSeconds: parseRetryAfter(response.headers.get("Retry-After")),
  });
}

/**
 * Gửi request đến Backend.
 * - Tự thêm Accept: application/json.
 * - Tự JSON.stringify body thông thường.
 * - Luôn gửi cookie session bằng credentials: include mặc định.
 * - Chuẩn hóa lỗi HTTP thành ApiError.
 *
 * Hàm không tự retry. Với API upload Metadata, phía gọi phải giữ nguyên
 * Idempotency-Key nếu muốn thử lại cùng một yêu cầu.
 */
export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  if (!API_BASE_URL) {
    throw new ApiError({
      message:
        "Chưa cấu hình VITE_API_BASE_URL. Hãy thêm địa chỉ FastAPI vào frontend/.env.local.",
      status: 0,
      code: "API_BASE_URL_NOT_CONFIGURED",
    });
  }

  if (!path.startsWith("/")) {
    throw new ApiError({
      message: "Đường dẫn API phải bắt đầu bằng dấu '/'.",
      status: 0,
      code: "INVALID_API_PATH",
    });
  }

  const headers = new Headers(options.headers);
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }

  let requestBody: BodyInit | undefined;
  if (options.body !== undefined) {
    if (typeof FormData !== "undefined" && options.body instanceof FormData) {
      requestBody = options.body;
    } else if (typeof options.body === "string") {
      requestBody = options.body;
      if (!headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }
    } else {
      requestBody = JSON.stringify(options.body);
      if (!headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }
    }
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: requestBody,
      signal: options.signal,
      credentials: options.credentials ?? "include",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Không thể kết nối đến Backend.";

    throw new ApiError({
      message: `Không thể kết nối Backend: ${message}`,
      status: 0,
      code: "NETWORK_ERROR",
    });
  }

  const responseBody = await readResponseBody(response);

  if (!response.ok) {
    throw createApiError(response, responseBody);
  }

  return responseBody as T;
}

/** Trả về URL gốc để hỗ trợ hiển thị/debug cấu hình nếu cần. */
export function getApiBaseUrl(): string {
  return API_BASE_URL;
}
