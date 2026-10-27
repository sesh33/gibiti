const normalizedPrefix = "data:image/svg+xml;charset=utf-8,";
const sdkPrefix = /^data:image\/svg\+xml;(?:utf-8|charset=utf-8),/i;
const qrElements = new Set([
  "svg",
  "g",
  "path",
  "rect",
  "circle",
  "line",
  "polyline",
  "polygon",
  "ellipse",
  "title",
  "desc",
]);

/** Normalize Supabase's SVG data URL without nesting it inside another data URL. */
export function normalizeMfaQrCode(value: unknown): string {
  function invalid(): never {
    throw new Error(
      "The authenticator QR code could not be displayed. Please restart setup.",
    );
  }

  if (typeof value !== "string" || value.length > 1_000_000) return invalid();
  let svg = value.trim();
  if (sdkPrefix.test(svg)) {
    svg = svg.replace(sdkPrefix, "");
    // The installed SDK returns raw SVG; also accept an already URI-encoded SVG.
    if (/^\s*%3c/i.test(svg)) {
      try {
        svg = decodeURIComponent(svg);
      } catch {
        return invalid();
      }
    }
    svg = svg.trim();
  }

  if (!/^<svg(?:\s|>)/i.test(svg) || !/<\/svg>$/i.test(svg)) return invalid();
  // QR images need only static drawing elements. Do not accept documents,
  // scripts, event handlers, styles, or references to other resources.
  if (
    /<!|<\?|\b(?:href|src|style)\s*=|(?:^|\s)on[a-z]+\s*=|\burl\s*\(/i.test(svg)
  ) {
    return invalid();
  }
  for (const tag of svg.matchAll(/<\/?([a-zA-Z][\w:.-]*)\b/g)) {
    if (!qrElements.has(tag[1].toLowerCase())) return invalid();
  }

  return normalizedPrefix + encodeURIComponent(svg);
}
