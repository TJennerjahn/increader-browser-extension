const INVALID_ORIGIN_MESSAGE =
  "Enter an HTTPS Increader origin, or loopback HTTP for local development.";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function normalizeInstanceOrigin(candidate: string): string {
  try {
    const url = new URL(candidate);
    const isLoopbackHttp =
      url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
    const isHttps = url.protocol === "https:";
    const hasOnlyOrigin =
      url.username === "" &&
      url.password === "" &&
      (url.pathname === "" || url.pathname === "/") &&
      url.search === "" &&
      url.hash === "";

    if ((!isHttps && !isLoopbackHttp) || !hasOnlyOrigin) {
      throw new Error(INVALID_ORIGIN_MESSAGE);
    }
    return url.origin;
  } catch {
    throw new Error(INVALID_ORIGIN_MESSAGE);
  }
}
