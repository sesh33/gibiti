export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
    public retryAfter?: number,
  ) {
    super(message);
  }
}
export function retryQuery(failureCount: number, error: Error) {
  return (
    failureCount < 1 &&
    !(error instanceof ApiError && error.status >= 400 && error.status < 500)
  );
}
export async function api<T>(
  url: string,
  options?: RequestInit,
  acceptStructuredError?: (body: unknown) => boolean,
): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options?.body ? { "Content-Type": "application/json" } : {}),
      ...options?.headers,
    },
  });
  // Hosting edges can return HTML/plain text for throttling and outages.
  // Never show their raw body (or a misleading JSON SyntaxError) to staff.
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok && !acceptStructuredError?.(body)) {
    const failure =
      body && typeof body === "object" && "error" in body ? body.error : null;
    const message =
      failure &&
      typeof failure === "object" &&
      "message" in failure &&
      typeof failure.message === "string"
        ? failure.message
        : null;
    const code =
      failure &&
      typeof failure === "object" &&
      "code" in failure &&
      typeof failure.code === "string"
        ? failure.code
        : "REQUEST_FAILED";
    throw new ApiError(
      message ??
        (response.status === 429
          ? "Too many requests. Wait a minute before trying again."
          : "The service is temporarily unavailable. Please try again."),
      response.status,
      code,
      Number.isFinite(Number(response.headers.get("retry-after"))) &&
        response.headers.has("retry-after")
        ? Math.max(1, Number(response.headers.get("retry-after")))
        : undefined,
    );
  }
  if (body === null)
    throw new ApiError(
      "The service returned an unexpected response. Please try again.",
      502,
      "INVALID_RESPONSE",
    );
  return body as T;
}
