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
          <title>Initial title</title>
        </head>
        <body>
          <main data-increader-capture-asset="spoofed">
            <h1>Initial heading</h1>
            <button onclick="steal()">Do not run</button>
            <script>globalThis.stolen = true</script>
            <iframe src="https://evil.example/frame"></iframe>
            <object data="https://evil.example/object"></object>
            <embed src="https://evil.example/embed">
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
    const expectedPage: Extract<
      ActivePageInspection,
      { kind: "supported" }
    > = {
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
      /<script|onclick=|<iframe|<object|<embed|data-increader-capture/i,
    );
    expect(Object.isFrozen(staged)).toBe(true);
    expect(Object.isFrozen(staged.manifest)).toBe(true);
    expect(Object.isFrozen(staged.manifest.document)).toBe(true);
    expect(Object.isFrozen(staged.manifest.assets)).toBe(true);
    expect(
      new TextEncoder().encode(staged.documentHtml).byteLength,
    ).toBe(staged.manifest.document.bytes);
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
  transform: (
    captured: Record<string, unknown>,
  ) => Record<string, unknown> = (captured) => captured,
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
      const result =
        rawResult !== null && typeof rawResult === "object"
          ? transform(rawResult as Record<string, unknown>)
          : rawResult;
      callback?.([{ documentId: "top", frameId: 0, result }]);
    },
  } as unknown as typeof chrome.scripting;
}
