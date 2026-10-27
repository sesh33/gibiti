import { describe, expect, it } from "vitest";
import { normalizeMfaQrCode } from "@/domains/authentication/mfa-qr";

// Synthetic image fixture only; it contains no authenticator enrollment data.
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path fill="#000" d="M0 0h10v10H0z"/></svg>';
const prefix = "data:image/svg+xml;charset=utf-8,";

describe("MFA QR image normalization", () => {
  it("unwraps the installed Supabase SDK data URL and preserves SVG content", () => {
    const normalized = normalizeMfaQrCode(`data:image/svg+xml;utf-8,${svg}`);
    expect(normalized.startsWith(prefix)).toBe(true);
    expect(decodeURIComponent(normalized.slice(prefix.length))).toBe(svg);
    // A fragment marker in the SVG must be encoded instead of truncating the URL.
    expect(normalized).not.toContain("#");
    expect(normalized.match(/data:image/g)).toHaveLength(1);
  });

  it("accepts a raw SVG fallback", () => {
    expect(normalizeMfaQrCode(`  ${svg}\n`)).toBe(
      prefix + encodeURIComponent(svg),
    );
  });

  it("accepts an already encoded SVG without double encoding", () => {
    expect(normalizeMfaQrCode(prefix + encodeURIComponent(svg))).toBe(
      prefix + encodeURIComponent(svg),
    );
  });

  it.each([
    "https://example.test/authenticator.svg",
    "//example.test/authenticator.svg",
    "javascript:alert(1)",
    "data:text/html,<svg></svg>",
    "data:image/png;base64,fixture",
    "data:image/svg+xml;base64,fixture",
    "data:image/svg+xml;utf-8,%3Csvg%ZZ",
    "not an image",
    "<svg>",
    '<svg><image href="https://example.test/image"/></svg>',
    '<svg><use href="#remote"/></svg>',
    '<svg onload="alert(1)"></svg>',
    "<svg><script>alert(1)</script></svg>",
    "<svg><foreignObject>unexpected payload</foreignObject></svg>",
    '<!DOCTYPE svg SYSTEM "https://example.test/fixture"><svg></svg>',
    '<svg><path style="fill:url(https://example.test/paint)"/></svg>',
    null,
    {},
  ])("rejects an unexpected URL or image payload: %j", (value) => {
    expect(() => normalizeMfaQrCode(value)).toThrow(
      "The authenticator QR code could not be displayed.",
    );
  });
});

it("accepts the real GoTrue XML declaration and static paint style format without allowing active CSS", () => {
  const raw =
    '<?xml version="1.0" encoding="UTF-8"?>\n<!-- Generated local QR fixture -->\n<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect style="fill: rgb(255, 255, 255);" width="20" height="20"/><rect style="fill: #000000;" width="5" height="5"/></svg>';
  const result = normalizeMfaQrCode("data:image/svg+xml;utf-8," + raw);
  const decoded = decodeURIComponent(result.split(",").slice(1).join(","));
  expect(decoded).toContain('fill="rgb(255, 255, 255)"');
  expect(decoded).not.toContain("<?xml");
  expect(decoded).not.toContain("style=");
  expect(() =>
    normalizeMfaQrCode(
      '<svg><rect style="fill:url(https://example.test)"/></svg>',
    ),
  ).toThrow();
});
