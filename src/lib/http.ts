import { AppError } from "@/lib/errors";
export function requireSameOrigin(request: Request) {
  const expected = process.env.APP_ORIGIN;
  if (!expected)
    throw new AppError(
      "SETUP_REQUIRED",
      "APP_ORIGIN must be configured for writes.",
      503,
    );
  if (request.headers.get("origin") !== new URL(expected).origin)
    throw new AppError(
      "INVALID_ORIGIN",
      "This request origin is not allowed.",
      403,
    );
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new AppError("INVALID_CONTENT_TYPE", "Send application/json.", 415);
}
export async function readBody(request: Request) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > 65536)
    throw new AppError("BODY_TOO_LARGE", "The request is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("EMPTY_BODY", "A JSON body is required.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 65536) {
      await reader.cancel();
      throw new AppError("BODY_TOO_LARGE", "The request is too large.", 413);
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new AppError("INVALID_JSON", "The request body must be valid JSON.");
  }
}
