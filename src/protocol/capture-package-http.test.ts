import { describe, expect, it, vi } from "vitest";

import type { StagedCapturePackage } from "../capture-package/capture-package";
import { createCapturePackageHttpClient } from "./capture-package-http";

describe("Capture Package multipart transfer", () => {
  it.each([
    [201, true],
    [200, false],
  ])(
    "maps HTTP %s to the normal Bookmark outcome",
    async (status, created) => {
      const fetcher = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: 42,
            url: "https://example.com/article",
            title: "Captured article",
          }),
          {
            status,
            headers: {
              "Content-Type": "application/json",
              Location: "/api/bookmarks/42",
            },
          },
        ),
      );
      const client = createCapturePackageHttpClient(fetcher);
      const staged = packageFixture();

      await expect(
        client.transfer("https://reader.example", "bca_memory", staged),
      ).resolves.toEqual({
        bookmarkId: 42,
        created,
        title: "Captured article",
      });

      const [url, request] = fetcher.mock.calls[0] as [
        string,
        RequestInit,
      ];
      expect(url).toBe(
        "https://reader.example/api/browser-capture/captures",
      );
      expect(request.credentials).toBe("omit");
      expect(request.headers).toEqual({
        Authorization: "Bearer bca_memory",
      });
      expect(request.body).toBeInstanceOf(FormData);
      const body = request.body as FormData;
      expect(body.has("manifest")).toBe(true);
      expect(body.has("document")).toBe(true);
      expect(
        JSON.parse(await (body.get("manifest") as Blob).text()),
      ).toEqual(staged.manifest);
      expect(await (body.get("document") as Blob).text()).toBe(
        staged.documentHtml,
      );
    },
  );

  it("surfaces bounded Problem Details without reflecting page content", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          type: "about:blank",
          title: "Invalid Capture Package",
          status: 400,
          code: "capture_package_invalid",
          detail: "Capture Package is invalid.",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/problem+json" },
        },
      ),
    );

    await expect(
      createCapturePackageHttpClient(fetcher).transfer(
        "https://reader.example",
        "bca_memory",
        packageFixture(),
      ),
    ).rejects.toThrow("Capture Package is invalid.");
  });
});

function packageFixture(): StagedCapturePackage {
  return {
    documentHtml:
      "<!DOCTYPE html><html><body><main>Article</main></body></html>",
    manifest: {
      assets: [],
      baseUrl: "https://example.com/article",
      capturedAt: "2026-07-25T12:34:56.000Z",
      captureId: "019c0000-0000-7000-8000-000000000001",
      document: {
        bytes: 65,
        sha256:
          "ea350ef5c7c06fda235e9b8928118c3b5120baf4f34dc15c637d24454e77eb8b",
      },
      producer: {
        browser: "Chrome",
        extensionVersion: "0.1.0",
      },
      sourceUrl: "https://example.com/article",
      title: "Captured article",
    },
  };
}
