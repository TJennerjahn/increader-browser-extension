import type { DiscoveryClient } from "../pairing/pairing";
import { parseDiscovery } from "./discovery";

export function createDiscoveryHttpClient(
  fetcher: typeof fetch = globalThis.fetch
): DiscoveryClient {
  return {
    async discover(origin) {
      const response = await fetcher(
        `${origin}/api/browser-capture/discovery`,
        {
          cache: "no-store",
          credentials: "omit",
          headers: { Accept: "application/json" },
          method: "GET",
          redirect: "error"
        }
      );
      if (!response.ok) {
        throw incompatible();
      }

      try {
        return parseDiscovery(await response.json());
      } catch {
        throw incompatible();
      }
    }
  };
}

function incompatible(): Error {
  return new Error(
    "This destination does not support Increader Browser Capture."
  );
}
