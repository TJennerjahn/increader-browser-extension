import { describe, expect, it, vi } from "vitest";

import { createBookmarkLookupHttpClient } from "./bookmark-lookup-http";

describe("Browser Capture Bookmark Lookup HTTP", () => {
  it("sends only the exact source URL with capture-scoped access", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        bookmarkId: 42,
        exists: true,
        title: "Saved Article",
      }),
    );
    const client = createBookmarkLookupHttpClient(fetcher);

    await expect(
      client.lookup(
        "https://reader.example",
        "session_short_lived",
        "https://example.com/article?campaign=one&next=%2Ftwo",
      ),
    ).resolves.toEqual({
      bookmarkId: 42,
      exists: true,
      title: "Saved Article",
    });

    expect(fetcher).toHaveBeenCalledWith(
      "https://reader.example/api/browser-capture/bookmarks/lookup",
      {
        body: JSON.stringify({
          sourceUrl: "https://example.com/article?campaign=one&next=%2Ftwo",
        }),
        cache: "no-store",
        credentials: "omit",
        headers: {
          Accept: "application/json",
          Authorization: "Bearer session_short_lived",
          "Content-Type": "application/json",
        },
        method: "POST",
        redirect: "error",
      },
    );
  });

  it("projects the minimal result while tolerating additive response fields", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ exists: false, futureHint: "additive" }),
      )
      .mockResolvedValueOnce(
        Response.json({
          exists: true,
          bookmarkId: 42,
          title: "Article",
          futureHint: "additive",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ exists: true, bookmarkId: 42, privateNotes: "secret" }),
      );
    const client = createBookmarkLookupHttpClient(fetcher);

    await expect(
      client.lookup(
        "https://reader.example",
        "session_access",
        "https://example.com/missing",
      ),
    ).resolves.toEqual({ exists: false });
    await expect(
      client.lookup(
        "https://reader.example",
        "session_access",
        "https://example.com/existing",
      ),
    ).resolves.toEqual({
      bookmarkId: 42,
      exists: true,
      title: "Article",
    });
    await expect(
      client.lookup(
        "https://reader.example",
        "session_access",
        "https://example.com/invalid",
      ),
    ).rejects.toThrow("Could not check this page in Increader.");
  });
});
