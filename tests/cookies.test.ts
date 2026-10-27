import { it, expect } from "vitest";
import { secureSessionCookies } from "@/lib/auth-cookie-options";
it("permits functional HTTP-only session cookies on explicit local production origins", () => {
  expect(secureSessionCookies("http://127.0.0.1:3000", true)).toBe(false);
  expect(secureSessionCookies("http://localhost:3000", true)).toBe(false);
});
it("never downgrades secure cookies for hosted or spoofed local origins", () => {
  for (const origin of [
    "https://rivox.example",
    "http://rivox.example",
    "http://localhost@attacker.example",
    "invalid",
    "",
  ])
    expect(secureSessionCookies(origin, true)).toBe(true);
});
