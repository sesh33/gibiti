/** HTTPS cookies remain mandatory except for a production build on explicit HTTP loopback. */
export function secureSessionCookies(
  origin = process.env.APP_ORIGIN,
  production = process.env.NODE_ENV === "production",
) {
  if (!production) return false;
  try {
    const url = new URL(origin || "");
    return !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return true;
  }
}
