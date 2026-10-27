import "server-only";
import { EnvHttpProxyAgent, fetch as proxyFetch } from "undici";

let dispatcher: EnvHttpProxyAgent | undefined;
/** Use the cloud's supported proxy without disabling TLS or bypassing secret routing. */
export async function serverFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  if (
    !process.env.HTTPS_PROXY &&
    !process.env.HTTP_PROXY &&
    !process.env.https_proxy &&
    !process.env.http_proxy
  )
    return fetch(input, init);
  dispatcher ??= new EnvHttpProxyAgent({
    noProxy: [
      process.env.NO_PROXY || process.env.no_proxy || "",
      "localhost",
      "127.0.0.1",
      "[::1]",
    ]
      .filter(Boolean)
      .join(","),
  });
  return proxyFetch(input as Parameters<typeof proxyFetch>[0], {
    ...(init as Parameters<typeof proxyFetch>[1]),
    dispatcher,
  }) as unknown as Promise<Response>;
}
