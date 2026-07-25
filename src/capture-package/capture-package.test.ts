// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ActivePageInspection } from "../browser/active-page";
import { createCapturePackageAssembler } from "./capture-package";

describe.each(["Chrome", "Firefox"])("%s text-only Capture Package", () => {
  beforeEach(() => {
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

    const staged = await assembler.capture({
      kind: "supported",
      sourceUrl: `${location.origin}/article?view=full`,
      tabId: 19,
      title: "Rendered title",
    });

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
