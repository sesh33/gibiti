import "server-only";
import { Readable } from "node:stream";
import {
  EnvHttpProxyAgent,
  fetch as proxyFetch,
  request as httpRequest,
} from "undici";

let dispatcher: EnvHttpProxyAgent | undefined;
function configuredDispatcher() {
  if (
    !process.env.HTTPS_PROXY &&
    !process.env.HTTP_PROXY &&
    !process.env.https_proxy &&
    !process.env.http_proxy
  )
    return undefined;
  return (dispatcher ??= new EnvHttpProxyAgent({
    noProxy: [
      process.env.NO_PROXY || process.env.no_proxy || "",
      "localhost",
      "127.0.0.1",
      "[::1]",
    ]
      .filter(Boolean)
      .join(","),
  }));
}
/** Use the cloud's supported proxy without disabling TLS or bypassing secret routing. */
export async function serverFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const configured = configuredDispatcher();
  if (!configured) return fetch(input, init);
  return proxyFetch(input as Parameters<typeof proxyFetch>[0], {
    ...(init as Parameters<typeof proxyFetch>[1]),
    dispatcher: configured,
  }) as unknown as Promise<Response>;
}

export const currencyOfferSearchBody = JSON.stringify({
  augmentedGameFilter: {},
});
const currencyOfferUrl =
  "https://www.eldorado.gg/api/v1/currency-management/me/offers";

/**
 * Eldorado's verified currency search is a GET with a required JSON body.
 * Fetch forbids that shape, so this one exact read uses Undici's HTTP API.
 * This is deliberately not a general-purpose GET-body or redirect transport.
 */
export async function currencyOffersFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  if (
    String(input) !== currencyOfferUrl ||
    init?.method !== "GET" ||
    init.body !== currencyOfferSearchBody ||
    init.redirect !== "error"
  )
    throw new Error(
      "The currency search transport accepts only its verified read contract.",
    );
  const headers = new Headers(init.headers);
  if (
    headers.get("content-type") !== "application/json" ||
    !headers.get("authorization")?.startsWith("Bearer ")
  )
    throw new Error("The currency search requires authenticated JSON headers.");
  headers.set("accept-encoding", "identity");
  const response = await httpRequest(currencyOfferUrl, {
    method: "GET",
    body: currencyOfferSearchBody,
    headers: Object.fromEntries(headers),
    signal: init.signal,
    headersTimeout: 20_000,
    bodyTimeout: 20_000,
    dispatcher: configuredDispatcher(),
  });
  // Undici request does not follow redirects. Keep only headers used by the
  // caller; upstream cookies and unrelated response metadata stay server-side.
  const responseHeaders = new Headers();
  for (const name of ["content-type", "retry-after"]) {
    const value = response.headers[name];
    if (typeof value === "string") responseHeaders.set(name, value);
  }
  const noBody = [204, 205, 304].includes(response.statusCode);
  if (noBody) await response.body.dump();
  const body = noBody
    ? null
    : (Readable.toWeb(response.body) as ReadableStream<Uint8Array>);
  return new Response(body, {
    status: response.statusCode,
    headers: responseHeaders,
  });
}
