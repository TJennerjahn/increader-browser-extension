import type { components } from "./generated/browser-capture";

export type BrowserCaptureBookmarkLookup =
  components["schemas"]["BrowserCaptureBookmarkLookup"];

export interface BookmarkLookupClient {
  lookup(
    origin: string,
    accessToken: string,
    sourceUrl: string,
  ): Promise<BrowserCaptureBookmarkLookup>;
}

export function createBookmarkLookupHttpClient(
  fetcher: typeof fetch = globalThis.fetch,
): BookmarkLookupClient {
  return {
    async lookup(origin, accessToken, sourceUrl) {
      const endpoint = new URL(
        "/api/browser-capture/bookmarks/lookup",
        `${origin}/`,
      );
      const response = await fetcher(endpoint.toString(), {
        body: JSON.stringify({ sourceUrl }),
        cache: "no-store",
        credentials: "omit",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        method: "POST",
        redirect: "error",
      });
      if (!response.ok) {
        throw lookupFailure();
      }
      try {
        return parseLookup(await response.json());
      } catch {
        throw lookupFailure();
      }
    },
  };
}

function parseLookup(value: unknown): BrowserCaptureBookmarkLookup {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw lookupFailure();
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.exists === false) {
    return { exists: false };
  }
  if (
    candidate.exists === true &&
    Number.isInteger(candidate.bookmarkId) &&
    (candidate.bookmarkId as number) > 0 &&
    typeof candidate.title === "string"
  ) {
    return {
      bookmarkId: candidate.bookmarkId as number,
      exists: true,
      title: candidate.title,
    };
  }
  throw lookupFailure();
}

function lookupFailure(): Error {
  return new Error("Could not check this page in Increader.");
}
