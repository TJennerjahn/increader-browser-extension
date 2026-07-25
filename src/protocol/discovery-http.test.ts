import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { createDiscoveryHttpClient } from "./discovery-http";

const validFixture = readFileSync(
  fileURLToPath(
    new URL("../../protocol/fixtures/discovery.valid.json", import.meta.url)
  ),
  "utf8"
);

describe("Browser Capture discovery HTTP", () => {
  it("reads only the public discovery resource at the exact instance origin", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(validFixture, {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    const client = createDiscoveryHttpClient(fetcher);

    const result = await client.discover("https://reader.example:8443");

    expect({
      displayName: result.displayName,
      request: fetcher.mock.calls[0]
    }).toEqual({
      displayName: "Increader",
      request: [
        "https://reader.example:8443/api/browser-capture/discovery",
        {
          cache: "no-store",
          credentials: "omit",
          headers: { Accept: "application/json" },
          method: "GET",
          redirect: "error"
        }
      ]
    });
  });

  it("rejects a successful non-Increader response", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("<html>not Increader</html>"));
    const client = createDiscoveryHttpClient(fetcher);

    await expect(client.discover("https://reader.example")).rejects.toThrow(
      "This destination does not support Increader Browser Capture."
    );
  });
});
