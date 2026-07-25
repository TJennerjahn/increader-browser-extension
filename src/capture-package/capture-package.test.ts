// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ActivePageInspection } from "../browser/active-page";
import { createCapturePackageAssembler } from "./capture-package";

describe.each(["Chrome", "Firefox"])("%s text-only Capture Package", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.open();
    // JSDOM requires document.write to replace the synthetic document,
    // including its doctype, before exercising the injected browser seam.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    document.write(`<!doctype html>
      <html lang="en">
        <head>
          <base href="https://cdn.example/articles/">
          <link rel="canonical" href="../canonical">
          <link rel="stylesheet" href="publisher.css">
          <link rel="icon" href="favicon.png">
          <meta property="og:image" content="metadata-cover.png">
          <meta property="og:image:secure_url" content="metadata-secure.png">
          <meta name="twitter:image:src" content="metadata-twitter.png">
          <meta itemprop="image" content="metadata-itemprop.png">
          <style>main { background-image: url(background.png); }</style>
          <title>Initial title</title>
        </head>
        <body>
          <main data-increader-capture-asset="spoofed">
            <h1 style="background-image: url(inline.png); font-family: secret;">
              Initial heading
            </h1>
            <button onclick="steal()">Do not run</button>
            <script>globalThis.stolen = true</script>
            <iframe src="https://evil.example/frame"></iframe>
            <object data="https://evil.example/object"></object>
            <embed src="https://evil.example/embed">
            <canvas width="10" height="10"></canvas>
            <video src="publisher.mp4"></video>
            <audio src="publisher.mp3"></audio>
          </main>
        </body>
      </html>`);
    document.close();
    window.history.replaceState(
      {},
      "",
      `${location.origin}/article?view=full#section`,
    );
    document.title = "Rendered title";
    const heading = document.querySelector("h1");
    if (heading === null) {
      throw new Error("Synthetic heading is missing.");
    }
    heading.textContent = "Rendered heading";
  });

  it("captures the live top-level document only after Import and makes the staged package immutable", async () => {
    const expectedPage: Extract<ActivePageInspection, { kind: "supported" }> = {
      kind: "supported",
      sourceUrl: `${location.origin}/article?view=full`,
      tabId: 19,
      title: "Rendered title",
    };
    const assembler = createCapturePackageAssembler({
      now: () => new Date("2026-07-25T12:34:56.000Z"),
      producer: {
        browser: "Firefox",
        extensionVersion: "0.1.0",
      },
      randomUuid: () => "019c0000-0000-7000-8000-000000000001",
      scripting: executingScripting(),
    });

    const staged = await assembler.capture(expectedPage);
    const documentBytes = staged.manifest.document.bytes;
    const documentSha256 = staged.manifest.document.sha256;

    expect(typeof documentBytes).toBe("number");
    expect(documentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(staged.manifest).toEqual({
      captureId: "019c0000-0000-7000-8000-000000000001",
      capturedAt: "2026-07-25T12:34:56.000Z",
      sourceUrl: expectedPage.sourceUrl,
      baseUrl: "https://cdn.example/articles/",
      canonicalUrl: "https://cdn.example/canonical",
      title: "Rendered title",
      language: "en",
      document: {
        bytes: documentBytes,
        sha256: documentSha256,
      },
      producer: {
        browser: "Firefox",
        extensionVersion: "0.1.0",
      },
      assets: [],
    });
    expect(staged.documentHtml).toContain("<!DOCTYPE html>");
    expect(staged.documentHtml).toContain("Rendered heading");
    expect(staged.documentHtml).not.toContain("Initial heading");
    expect(staged.documentHtml).not.toMatch(
      /<script|<style|stylesheet|rel="icon"|og:image|style=|onclick=|<iframe|<object|<embed|<canvas|<video|<audio|data-increader-capture/i,
    );
    expect(staged.documentHtml).not.toMatch(
      /metadata-(?:cover|secure|twitter|itemprop)\.png/,
    );
    expect(Object.isFrozen(staged)).toBe(true);
    expect(Object.isFrozen(staged.manifest)).toBe(true);
    expect(Object.isFrozen(staged.manifest.document)).toBe(true);
    expect(Object.isFrozen(staged.manifest.assets)).toBe(true);
    expect(new TextEncoder().encode(staged.documentHtml).byteLength).toBe(
      staged.manifest.document.bytes,
    );
  });

  it("selects rendered and lazy image candidates, shares repeated assets, and keeps unsupported images unavailable", async () => {
    document.querySelector("main")?.insertAdjacentHTML(
      "beforeend",
      `
        <figure>
          <picture>
            <source srcset="small.png 1x, large.png 2x">
            <img id="responsive" src="fallback.png" srcset="small.png 1x, large.png 2x"
                 alt="Responsive diagram" width="640" height="320">
          </picture>
          <figcaption>Figure semantics survive.</figcaption>
        </figure>
        <img id="duplicate" src="fallback.png" alt="Repeated diagram">
        <img id="lazy"
             src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="
             data-src="../lazy.png" alt="Lazy diagram">
        <img id="unsupported" src="../diagram.svg" alt="SVG diagram">
      `,
    );
    defineCurrentSource(
      requiredImage("responsive"),
      "https://cdn.example/articles/large.png",
    );
    defineCurrentSource(
      requiredImage("duplicate"),
      "https://cdn.example/articles/large.png",
    );
    defineCurrentSource(
      requiredImage("lazy"),
      "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
    );
    defineCurrentSource(
      requiredImage("unsupported"),
      "https://cdn.example/diagram.svg",
    );
    const png = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
    ]);
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input) => {
        const url = requestUrl(input);
        if (url.endsWith(".svg")) {
          return Promise.resolve(
            new Response("<svg></svg>", {
              headers: { "Content-Type": "image/svg+xml" },
            }),
          );
        }
        return Promise.resolve(
          new Response(png, {
            headers: { "Content-Type": "image/png" },
          }),
        );
      });
    fetcher.mockClear();
    const assembler = createCapturePackageAssembler({
      now: () => new Date("2026-07-25T12:34:56.000Z"),
      producer: { browser: "Chrome", extensionVersion: "0.1.0" },
      randomUuid: () => "019c0000-0000-7000-8000-000000000002",
      scripting: executingScripting(),
    });
    const progress = vi.fn();

    const staged = await assembler.capture(
      {
        kind: "supported",
        sourceUrl: `${location.origin}/article?view=full`,
        tabId: 19,
        title: "Rendered title",
      },
      progress,
    );

    expect(staged.manifest.assets).toEqual([
      expect.objectContaining({
        id: "asset-0001",
        sourceUrl: "https://cdn.example/articles/large.png",
        status: "captured",
        mediaType: "image/png",
        bytes: png.byteLength,
      }),
      expect.objectContaining({
        id: "asset-0002",
        sourceUrl: "https://cdn.example/lazy.png",
        status: "captured",
        mediaType: "image/png",
        bytes: png.byteLength,
      }),
      {
        id: "asset-0003",
        sourceUrl: "https://cdn.example/diagram.svg",
        status: "unavailable",
        reason: "unsupported_type",
      },
    ]);
    expect(staged.assetParts).toHaveLength(2);
    expect(staged.assetParts.map((part) => part.id)).toEqual([
      "asset-0001",
      "asset-0002",
    ]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls).toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          "https://cdn.example/articles/large.png",
          expect.objectContaining({ credentials: "include" }),
        ]),
        expect.arrayContaining([
          "https://cdn.example/lazy.png",
          expect.objectContaining({ credentials: "include" }),
        ]),
      ]),
    );
    expect(staged.documentHtml).toContain(
      'alt="Responsive diagram" width="640" height="320"',
    );
    expect(staged.documentHtml).toContain("Figure semantics survive.");
    expect(staged.documentHtml).not.toMatch(/srcset=|data-src=|<source/i);
    expect(
      staged.documentHtml.match(
        /src="increader:browser-capture-asset\/asset-0001"/g,
      ),
    ).toHaveLength(2);
    expect(progress.mock.calls).toEqual([
      [{ completedAssets: 0, totalAssets: 3 }],
      [{ completedAssets: 1, totalAssets: 3 }],
      [{ completedAssets: 2, totalAssets: 3 }],
      [{ completedAssets: 3, totalAssets: 3 }],
    ]);
  });

  it("acquires same-origin, credentialed CORS, data, and blob bytes by magic while isolating one failed image", async () => {
    const sources = {
      authenticated: `${location.origin}/private.jpeg`,
      cors: "https://cors.example/diagram.gif",
      data: "data:image/png;base64,iVBORw0KGgoAAAAA",
      blob: `blob:${location.origin}/019c0000-0000-7000-8000-000000000099`,
      avif: "https://cdn.example/diagram.avif",
      failed: "https://blocked.example/no-cors.png",
    };
    document.querySelector("main")?.insertAdjacentHTML(
      "beforeend",
      Object.entries(sources)
        .map(
          ([id, source]) =>
            `<img id="${id}" src="${source}" alt="${id} image">`,
        )
        .join(""),
    );
    for (const [id, source] of Object.entries(sources)) {
      defineCurrentSource(requiredImage(id), source);
    }
    const signatures = {
      jpeg: Uint8Array.from([0xff, 0xd8, 0xff, 0, 1]),
      gif: new TextEncoder().encode("GIF89a_payload"),
      png: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]),
      webp: new TextEncoder().encode("RIFF0000WEBPpayload"),
      avif: Uint8Array.from([
        0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66, 0, 0, 0, 0,
        0x61, 0x76, 0x69, 0x66, 0, 0, 0, 0,
      ]),
    };
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input) => {
        const url = requestUrl(input);
        if (url === sources.failed) {
          return Promise.reject(new TypeError("CORS blocked"));
        }
        const bytes =
          url === sources.authenticated
            ? signatures.jpeg
            : url === sources.cors
              ? signatures.gif
              : url === sources.data
                ? signatures.png
                : url === sources.blob
                  ? signatures.webp
                  : signatures.avif;
        return Promise.resolve(
          new Response(bytes, {
            // Deliberately untrusted: the package media type comes from magic.
            headers: { "Content-Type": "application/octet-stream" },
          }),
        );
      });
    fetcher.mockClear();
    const assembler = createCapturePackageAssembler({
      producer: { browser: "Firefox", extensionVersion: "0.1.0" },
      randomUuid: () => "019c0000-0000-7000-8000-000000000003",
      scripting: executingScripting(),
    });

    const staged = await assembler.capture({
      kind: "supported",
      sourceUrl: `${location.origin}/article?view=full`,
      tabId: 19,
      title: "Rendered title",
    });

    expect(
      staged.manifest.assets.map((asset) =>
        asset.status === "captured" ? asset.mediaType : asset.reason,
      ),
    ).toEqual([
      "image/jpeg",
      "image/gif",
      "image/png",
      "image/webp",
      "image/avif",
      "acquisition_failed",
    ]);
    expect(staged.manifest.assets[2]?.sourceUrl).toBe("data:");
    expect(staged.manifest.assets[3]?.sourceUrl).toBe(sources.blob);
    expect(staged.assetParts).toHaveLength(5);
    expect(
      fetcher.mock.calls.every(
        ([, options]) => (options as RequestInit).credentials === "include",
      ),
    ).toBe(true);
    expect(staged.documentHtml).toContain(
      "increader:browser-capture-asset/asset-0006",
    );
  });

  it("limits page-context asset acquisition to four concurrent reads", async () => {
    const imageCount = 8;
    document.querySelector("main")?.insertAdjacentHTML(
      "beforeend",
      Array.from(
        { length: imageCount },
        (_, index) =>
          `<img id="bounded-${String(index)}" src="https://cdn.example/${String(index)}.png">`,
      ).join(""),
    );
    for (let index = 0; index < imageCount; index += 1) {
      defineCurrentSource(
        requiredImage(`bounded-${String(index)}`),
        `https://cdn.example/${String(index)}.png`,
      );
    }
    const pending: Array<(response: Response) => void> = [];
    let active = 0;
    let maximumActive = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          pending.push((response) => {
            active -= 1;
            resolve(response);
          });
        }),
    );
    const assembler = createCapturePackageAssembler({
      producer: { browser: "Chrome", extensionVersion: "0.1.0" },
      randomUuid: () => "019c0000-0000-7000-8000-000000000004",
      scripting: executingScripting(),
    });

    const capture = assembler.capture({
      kind: "supported",
      sourceUrl: `${location.origin}/article?view=full`,
      tabId: 19,
      title: "Rendered title",
    });
    await vi.waitFor(() => {
      expect(pending).toHaveLength(4);
    });
    resolvePendingImages(pending);
    await vi.waitFor(() => {
      expect(pending).toHaveLength(4);
    });
    resolvePendingImages(pending);

    const staged = await capture;
    expect(staged.manifest.assets.length).toBeGreaterThan(0);
    expect(maximumActive).toBe(4);
  });

  it("stops an oversized asset stream without buffering the remaining response", async () => {
    document.querySelector("main")?.insertAdjacentHTML(
      "beforeend",
      '<img id="streaming-large" src="https://cdn.example/streaming-large.png">',
    );
    defineCurrentSource(
      requiredImage("streaming-large"),
      "https://cdn.example/streaming-large.png",
    );
    const cancel = vi.fn();
    let pulls = 0;
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      headers: new Headers(),
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls += 1;
          controller.enqueue(new Uint8Array(1024 * 1024));
        },
        cancel,
      }),
    } as Response);
    const assembler = createCapturePackageAssembler({
      producer: { browser: "Chrome", extensionVersion: "0.1.0" },
      randomUuid: () => "019c0000-0000-7000-8000-000000000005",
      scripting: executingScripting(),
    });

    const staged = await assembler.capture({
      kind: "supported",
      sourceUrl: `${location.origin}/article?view=full`,
      tabId: 19,
      title: "Rendered title",
    });

    expect(staged.manifest.assets).toEqual([
      expect.objectContaining({
        status: "unavailable",
        reason: "asset_too_large",
      }),
    ]);
    expect(staged.assetParts).toEqual([]);
    expect(pulls).toBeLessThanOrEqual(10);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("stages a valid partial package when the 90-second capture deadline expires", async () => {
    vi.useFakeTimers();
    try {
      const imageCount = 28;
      document.querySelector("main")?.insertAdjacentHTML(
        "beforeend",
        Array.from(
          { length: imageCount },
          (_, index) =>
            `<img id="deadline-${String(index)}" src="https://cdn.example/${String(index)}.png">`,
        ).join(""),
      );
      for (let index = 0; index < imageCount; index += 1) {
        defineCurrentSource(
          requiredImage(`deadline-${String(index)}`),
          `https://cdn.example/${String(index)}.png`,
        );
      }
      vi.spyOn(globalThis, "fetch").mockImplementation(
        (_input, options) =>
          new Promise<Response>((_resolve, reject) => {
            options?.signal?.addEventListener(
              "abort",
              () => { reject(new DOMException("Timed out", "AbortError")); },
              { once: true },
            );
          }),
      );
      const assembler = createCapturePackageAssembler({
        producer: { browser: "Firefox", extensionVersion: "0.1.0" },
        randomUuid: () => "019c0000-0000-7000-8000-000000000006",
        scripting: executingScripting(),
      });
      const capture = assembler.capture({
        kind: "supported",
        sourceUrl: `${location.origin}/article?view=full`,
        tabId: 19,
        title: "Rendered title",
      });

      await vi.advanceTimersByTimeAsync(90_001);
      vi.useRealTimers();
      const staged = await Promise.race([
        capture,
        new Promise<"still-capturing">((resolve) => {
          setTimeout(() => { resolve("still-capturing"); }, 50);
        }),
      ]);
      expect(staged).not.toBe("still-capturing");
      if (staged === "still-capturing") return;
      expect(staged.manifest.assets).toHaveLength(imageCount);
      expect(
        staged.manifest.assets.every(
          (asset) =>
            asset.status === "unavailable" && asset.reason === "timeout",
        ),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops scheduling image reads after the 60-binary limit is reached", async () => {
    const imageCount = 70;
    document.querySelector("main")?.insertAdjacentHTML(
      "beforeend",
      Array.from(
        { length: imageCount },
        (_, index) =>
          `<img id="binary-limit-${String(index)}" src="https://cdn.example/${String(index)}.png">`,
      ).join(""),
    );
    for (let index = 0; index < imageCount; index += 1) {
      defineCurrentSource(
        requiredImage(`binary-limit-${String(index)}`),
        `https://cdn.example/${String(index)}.png`,
      );
    }
    const png = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
    ]);
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(new Response(png)));
    const assembler = createCapturePackageAssembler({
      producer: { browser: "Chrome", extensionVersion: "0.1.0" },
      randomUuid: () => "019c0000-0000-7000-8000-000000000008",
      scripting: executingScripting(),
    });

    const staged = await assembler.capture({
      kind: "supported",
      sourceUrl: `${location.origin}/article?view=full`,
      tabId: 19,
      title: "Rendered title",
    });

    expect(staged.assetParts).toHaveLength(60);
    expect(
      staged.manifest.assets.slice(60).every(
        (asset) =>
          asset.status === "unavailable" &&
          asset.reason === "binary_limit",
      ),
    ).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(60);
  });

  it("marks every later DOM-order record unavailable after aggregate overflow", async () => {
    const imageCount = 8;
    document.querySelector("main")?.insertAdjacentHTML(
      "beforeend",
      Array.from(
        { length: imageCount },
        (_, index) =>
          `<img id="aggregate-limit-${String(index)}" src="https://cdn.example/${String(index)}.png">`,
      ).join(""),
    );
    for (let index = 0; index < imageCount; index += 1) {
      defineCurrentSource(
        requiredImage(`aggregate-limit-${String(index)}`),
        `https://cdn.example/${String(index)}.png`,
      );
    }
    const png = (size: number) => {
      const bytes = new Uint8Array(size);
      bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      return bytes;
    };
    const sizes = [
      ...Array.from({ length: 6 }, () => 8 * 1024 * 1024),
      3 * 1024 * 1024,
      12,
    ];
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      const size = sizes.shift();
      if (size === undefined) throw new Error("Unexpected asset read");
      return Promise.resolve(new Response(png(size)));
    });
    const assembler = createCapturePackageAssembler({
      producer: { browser: "Chrome", extensionVersion: "0.1.0" },
      randomUuid: () => "019c0000-0000-7000-8000-000000000010",
      scripting: executingScripting(),
    });

    const staged = await assembler.capture({
      kind: "supported",
      sourceUrl: `${location.origin}/article?view=full`,
      tabId: 19,
      title: "Rendered title",
    });

    expect(staged.assetParts).toHaveLength(6);
    expect(staged.manifest.assets.slice(6)).toEqual([
      expect.objectContaining({
        status: "unavailable",
        reason: "aggregate_limit",
      }),
      expect.objectContaining({
        status: "unavailable",
        reason: "aggregate_limit",
      }),
    ]);
  });

  it("keeps aggregate overflow sticky after the scripting boundary", async () => {
    const chunkBytes = 192 * 1024;
    const fullChunk = btoa("\0".repeat(chunkBytes));
    const chunksFor = (bytes: number): string[] => {
      const chunks = Array.from(
        { length: Math.floor(bytes / chunkBytes) },
        () => fullChunk,
      );
      const remainder = bytes % chunkBytes;
      if (remainder > 0) chunks.push(btoa("\0".repeat(remainder)));
      return chunks;
    };
    const eightMiB = chunksFor(8 * 1024 * 1024);
    const injectedAssets = [
      ...Array.from({ length: 6 }, (_unused, index) => ({
        id: `asset-${String(index + 1).padStart(4, "0")}`,
        sourceUrl: `https://cdn.example/${String(index)}.png`,
        outcome: {
          status: "captured",
          mediaType: "image/png",
          chunks: eightMiB,
        },
      })),
      {
        id: "asset-0007",
        sourceUrl: "https://cdn.example/overflow.png",
        outcome: {
          status: "captured",
          mediaType: "image/png",
          chunks: chunksFor(3 * 1024 * 1024),
        },
      },
      {
        id: "asset-0008",
        sourceUrl: "https://cdn.example/later-small.png",
        outcome: {
          status: "captured",
          mediaType: "image/png",
          chunks: chunksFor(12),
        },
      },
    ];
    const assembler = createCapturePackageAssembler({
      producer: { browser: "Firefox", extensionVersion: "0.1.0" },
      randomUuid: () => "019c0000-0000-7000-8000-000000000011",
      scripting: executingScripting((captured) => ({
        ...captured,
        assets: injectedAssets,
      })),
    });

    const staged = await assembler.capture({
      kind: "supported",
      sourceUrl: `${location.origin}/article?view=full`,
      tabId: 19,
      title: "Rendered title",
    });

    expect(staged.assetParts).toHaveLength(6);
    expect(staged.manifest.assets.slice(6)).toEqual([
      expect.objectContaining({
        status: "unavailable",
        reason: "aggregate_limit",
      }),
      expect.objectContaining({
        status: "unavailable",
        reason: "aggregate_limit",
      }),
    ]);
  });

  it("does not fetch or preserve a blob URL with embedded credentials", async () => {
    document.querySelector("main")?.insertAdjacentHTML(
      "beforeend",
      '<img id="credentialed-blob" src="blob:https://user:secret@publisher.example/id">',
    );
    defineCurrentSource(
      requiredImage("credentialed-blob"),
      "blob:https://user:secret@publisher.example/id",
    );
    const fetcher = vi.spyOn(globalThis, "fetch");
    const assembler = createCapturePackageAssembler({
      producer: { browser: "Firefox", extensionVersion: "0.1.0" },
      randomUuid: () => "019c0000-0000-7000-8000-000000000009",
      scripting: executingScripting(),
    });

    const staged = await assembler.capture({
      kind: "supported",
      sourceUrl: `${location.origin}/article?view=full`,
      tabId: 19,
      title: "Rendered title",
    });

    expect(fetcher).not.toHaveBeenCalled();
    expect(staged.manifest.assets).toEqual([]);
    expect(staged.documentHtml).not.toContain("user:secret");
  });

  it("rejects a changed source before allocating a Capture ID", async () => {
    const randomUuid = vi.fn(() => crypto.randomUUID());
    const assembler = createCapturePackageAssembler({
      now: () => new Date(),
      producer: { browser: "Chrome", extensionVersion: "0.1.0" },
      randomUuid,
      scripting: executingScripting(),
    });

    await expect(
      assembler.capture({
        kind: "supported",
        sourceUrl: "https://different.example/article",
        tabId: 19,
        title: "Expected title",
      }),
    ).rejects.toThrow("The active page changed before capture started.");
    expect(randomUuid).not.toHaveBeenCalled();
  });

  it("does not reflect a scripting error containing publisher content", async () => {
    vi.stubGlobal("chrome", {
      runtime: {
        lastError: {
          message:
            "Publisher SECRET https://publisher.example/path?token=SECRET",
        },
      },
    });
    try {
      const assembler = createCapturePackageAssembler({
        producer: { browser: "Chrome", extensionVersion: "0.1.0" },
        randomUuid: () => crypto.randomUUID(),
        scripting: {
          executeScript(
            _injection: chrome.scripting.ScriptInjection<unknown[], unknown>,
            callback?: (
              results: chrome.scripting.InjectionResult[],
            ) => void,
          ) {
            callback?.([]);
          },
        } as unknown as typeof chrome.scripting,
      });

      const error = await assembler
        .capture({
          kind: "supported",
          sourceUrl: `${location.origin}/article?view=full`,
          tabId: 19,
          title: "Rendered title",
        })
        .catch((reason: unknown) => reason);

      expect(error).toMatchObject({
        message: "The active page could not be captured.",
      });
      expect(String(error)).not.toContain("SECRET");
      expect(String(error)).not.toContain("publisher.example");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("revalidates that the click-authorized document is still HTML", async () => {
    const assembler = createCapturePackageAssembler({
      now: () => new Date(),
      producer: { browser: "Chrome", extensionVersion: "0.1.0" },
      randomUuid: () => crypto.randomUUID(),
      scripting: executingScripting((captured) => ({
        ...captured,
        contentType: "application/pdf",
      })),
    });

    await expect(
      assembler.capture({
        kind: "supported",
        sourceUrl: `${location.origin}/article?view=full`,
        tabId: 19,
        title: "Rendered title",
      }),
    ).rejects.toThrow("Only HTML pages can be imported.");
  });

  it.each([
    "javascript:spoofed()",
    "https://user:secret@publisher.example/article",
    "https://publisher.example/article#fragment",
  ])("omits invalid publisher canonical hint %s", async (canonicalHref) => {
    document
      .querySelector('link[rel~="canonical"]')
      ?.setAttribute("href", canonicalHref);
    const assembler = createCapturePackageAssembler({
      now: () => new Date(),
      producer: { browser: "Chrome", extensionVersion: "0.1.0" },
      randomUuid: () => crypto.randomUUID(),
      scripting: executingScripting(),
    });

    const staged = await assembler.capture({
      kind: "supported",
      sourceUrl: `${location.origin}/article?view=full`,
      tabId: 19,
      title: "Rendered title",
    });

    expect(staged.manifest.canonicalUrl).toBeUndefined();
  });

  it("uses a fragment-free final page URL as the fallback base", async () => {
    document.querySelector("base")?.remove();
    const assembler = createCapturePackageAssembler({
      now: () => new Date(),
      producer: { browser: "Chrome", extensionVersion: "0.1.0" },
      randomUuid: () => crypto.randomUUID(),
      scripting: executingScripting(),
    });
    const sourceUrl = `${location.origin}/article?view=full`;

    const staged = await assembler.capture({
      kind: "supported",
      sourceUrl,
      tabId: 19,
      title: "Rendered title",
    });

    expect(staged.manifest.baseUrl).toBe(sourceUrl);
  });

  it("rejects a manifest whose UTF-8 representation exceeds 512 KiB", async () => {
    const assembler = createCapturePackageAssembler({
      producer: { browser: "Chrome", extensionVersion: "0.1.0" },
      randomUuid: () => "019c0000-0000-7000-8000-000000000007",
      scripting: executingScripting((captured) => ({
        ...captured,
        assets: Array.from({ length: 70 }, (_, index) => ({
          id: `asset-${String(index + 1).padStart(4, "0")}`,
          sourceUrl: `https://cdn.example/${String(index)}/${"a".repeat(7_500)}`,
          outcome: {
            status: "unavailable",
            reason: "acquisition_failed",
          },
        })),
      })),
    });

    await expect(
      assembler.capture({
        kind: "supported",
        sourceUrl: `${location.origin}/article?view=full`,
        tabId: 19,
        title: "Rendered title",
      }),
    ).rejects.toThrow("Capture Package manifest is too large.");
  });
});

function executingScripting(
  transform: (captured: Record<string, unknown>) => Record<string, unknown> = (
    captured,
  ) => captured,
): typeof chrome.scripting {
  return {
    executeScript(
      injection: chrome.scripting.ScriptInjection<unknown[], unknown>,
      callback?: (results: chrome.scripting.InjectionResult[]) => void,
    ) {
      const script = injection as chrome.scripting.ScriptInjection<
        unknown[],
        unknown
      > & { args?: unknown[] };
      const rawResult =
        "func" in script && script.func !== undefined
          ? script.func(...(script.args ?? []))
          : undefined;
      void Promise.resolve(rawResult).then((resolved) => {
        const result =
          resolved !== null && typeof resolved === "object"
            ? transform(resolved as Record<string, unknown>)
            : resolved;
        callback?.([{ documentId: "top", frameId: 0, result }]);
      });
    },
  } as unknown as typeof chrome.scripting;
}

function requiredImage(id: string): HTMLImageElement {
  const image = document.querySelector<HTMLImageElement>(`#${id}`);
  if (image === null) {
    throw new Error(`Synthetic image ${id} is missing.`);
  }
  return image;
}

function defineCurrentSource(
  image: HTMLImageElement,
  currentSource: string,
): void {
  Object.defineProperty(image, "currentSrc", {
    configurable: true,
    value: currentSource,
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.toString() : input.url;
}

function resolvePendingImages(
  pending: Array<(response: Response) => void>,
): void {
  const png = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
  ]);
  for (const resolve of pending.splice(0)) {
    resolve(new Response(png, { headers: { "Content-Type": "image/png" } }));
  }
}
