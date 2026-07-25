import { describe, expect, it, vi } from "vitest";

import type { StagedCapturePackage } from "../capture-package/capture-package";
import {
  CaptureTransferError,
  createCapturePackageHttpClient,
  encodeCapturePackageMultipart,
} from "./capture-package-http";

describe("Capture Package multipart transfer", () => {
  it.each([
    [201, true],
    [200, false],
  ])("maps HTTP %s to the normal Bookmark outcome", async (status, created) => {
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

    const [url, request] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://reader.example/api/browser-capture/captures");
    expect(request.credentials).toBe("omit");
    expect(request.headers).toEqual({
      Authorization: "Bearer bca_memory",
      "Content-Type":
        "multipart/form-data; boundary=----increader-browser-capture-019c0000-0000-7000-8000-000000000001",
    });
    expect(request.body).toBeInstanceOf(Blob);
    const body = request.body as Blob;
    const bytes = new Uint8Array(await body.arrayBuffer());
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text).toContain(
      'name="manifest"; filename="capture-part"\r\nContent-Type: application/json',
    );
    expect(text).toContain(JSON.stringify(staged.manifest));
    expect(text).toContain(
      'name="document"; filename="capture-part"\r\nContent-Type: text/html;charset=utf-8',
    );
    expect(text).toContain(staged.documentHtml);
    expect(text).toContain(
      'name="asset-0001"; filename="capture-part"\r\nContent-Type: image/png',
    );
    const firstAssetPart = staged.assetParts[0];
    if (firstAssetPart === undefined) {
      throw new Error("Asset fixture is missing.");
    }
    expect(
      bytes.slice(
        bytes.indexOf(0x89),
        bytes.indexOf(0x89) + firstAssetPart.data.size,
      ),
    ).toEqual(
      Uint8Array.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
      ]),
    );
  });

  it("surfaces bounded Problem Details without reflecting page content", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          type: "about:blank",
          title: "Invalid Capture Package",
          status: 400,
          code: "capture_package_invalid",
          detail:
            "Publisher title SECRET and https://publisher.example/path?token=SECRET",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/problem+json" },
        },
      ),
    );

    const error = await createCapturePackageHttpClient(fetcher)
      .transfer("https://reader.example", "bca_memory", packageFixture())
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(CaptureTransferError);
    expect(error).toMatchObject({
      message: "Capture Package is invalid.",
      code: "capture_package_invalid",
      retryable: false,
      retryAfterSeconds: null,
    });
    expect(String(error)).not.toContain("SECRET");
  });

  it("classifies deterministic validation as nonretryable and bounds 429 Retry-After", async () => {
    const responses = [
      new Response(
        JSON.stringify({
          code: "capture_package_invalid",
          detail: "unsafe reflected publisher content",
        }),
        { status: 400 },
      ),
      new Response(
        JSON.stringify({ code: "capture_transfer_limited" }),
        { status: 429, headers: { "Retry-After": "999999999" } },
      ),
    ];
    const client = createCapturePackageHttpClient(
      vi.fn().mockImplementation(() => {
        const response = responses.shift();
        if (response === undefined) throw new Error("Unexpected transfer");
        return Promise.resolve(response);
      }),
    );

    await expect(
      client.transfer(
        "https://reader.example",
        "bca_memory",
        packageFixture(),
      ),
    ).rejects.toMatchObject({
      name: CaptureTransferError.name,
      code: "capture_package_invalid",
      retryable: false,
      retryAfterSeconds: null,
    });
    await expect(
      client.transfer(
        "https://reader.example",
        "bca_memory",
        packageFixture(),
      ),
    ).rejects.toMatchObject({
      code: "capture_transfer_limited",
      retryable: true,
      retryAfterSeconds: 3600,
    });
  });

  it("accepts exactly 64 MiB of encoded multipart bytes and rejects one byte more", () => {
    const limit = 64 * 1024 * 1024;
    const fixture = packageFixture();
    const emptyAsset = packageWithAssetBlob(fixture, new Blob());
    const fixedBytes = encodeCapturePackageMultipart(emptyAsset).body.size;
    const backing = new Blob([new ArrayBuffer(limit - fixedBytes + 1)]);

    expect(
      encodeCapturePackageMultipart(
        packageWithAssetBlob(
          fixture,
          backing.slice(0, limit - fixedBytes, "image/png"),
        ),
      ).body.size,
    ).toBe(limit);
    expect(() =>
      encodeCapturePackageMultipart(
        packageWithAssetBlob(fixture, backing.slice(0, undefined, "image/png")),
      ),
    ).toThrow("Capture Package request is too large.");
  });
});

function packageFixture(): StagedCapturePackage {
  const png = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
  ]);
  return {
    assetParts: [
      {
        id: "asset-0001",
        mediaType: "image/png",
        data: new Blob([png.buffer], { type: "image/png" }),
      },
    ],
    documentHtml:
      "<!DOCTYPE html><html><body><main>Article</main></body></html>",
    manifest: {
      assets: [
        {
          id: "asset-0001",
          sourceUrl: "https://example.com/diagram.png",
          status: "captured",
          mediaType: "image/png",
          bytes: png.byteLength,
          sha256:
            "1b56b50ac4e976f488f128cabdcdffb2fc9331d6974bb9968131a415d14ade24",
        },
      ],
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

function packageWithAssetBlob(
  fixture: StagedCapturePackage,
  data: Blob,
): StagedCapturePackage {
  const firstAssetPart = fixture.assetParts[0];
  if (firstAssetPart === undefined) {
    throw new Error("Asset fixture is missing.");
  }
  return {
    ...fixture,
    assetParts: [{ ...firstAssetPart, data }],
  };
}
