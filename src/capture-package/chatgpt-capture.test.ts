// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://chatgpt.com/c/fixture-chat"}

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCapturePackageAssembler } from "./capture-package";

// Capture boundary failures: app chrome leaks, hidden branches leak, rendered
// alternatives are duplicated, streaming/empty chats appear successful, and
// narrowing the document loses the original image-to-clone correspondence.
describe("ChatGPT Capture Package", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.head.innerHTML = "<title>A useful conversation</title>";
    document.body.innerHTML = `
      <nav><img src="https://example.org/avatar.png">Private sidebar history</nav>
      <main>
        <article><div data-message-author-role="user"><div class="whitespace-pre-wrap">Why?</div></div></article>
        <article><div data-message-author-role="assistant"><div class="markdown"><p>Because.</p></div></div></article>
        <article style="display:none"><div data-message-author-role="assistant">Hidden alternative</div></article>
        <article aria-hidden="true"><div data-message-author-role="user">Old branch</div></article>
        <form><textarea>Unsent draft</textarea><button>Send</button></form>
      </main>`;
  });

  it("captures the displayed conversation without app chrome or hidden branches", async () => {
    const result = await capture();
    expect(result.documentHtml).toContain("Why?");
    expect(result.documentHtml).toContain("Because.");
    expect(result.documentHtml).not.toMatch(/Private sidebar|Hidden alternative|Old branch|Unsent draft/);
    expect(result.documentHtml).toContain('data-message-author-role="user"');
    expect(result.manifest.assets).toEqual([]);
    // Capturing must never modify the active chat.
    expect(document.querySelector("nav")).not.toBeNull();
  });

  it("bounds visibility checks for long conversations", async () => {
    // Repeated ancestor style queries otherwise grow with message depth and length.
    document.querySelector('.markdown')?.insertAdjacentHTML("beforeend", "<p>Another paragraph.</p>".repeat(200));
    const styles = vi.spyOn(globalThis, "getComputedStyle");
    const elements = document.querySelectorAll("*").length;
    await capture();
    expect(styles.mock.calls.length).toBeLessThanOrEqual(elements);
  });

  it("asks the user to finish an in-progress response before capturing", async () => {
    document.querySelector("main")?.insertAdjacentHTML("beforeend", '<button data-testid="stop-button">Stop</button>');
    await expect(capture()).rejects.toThrow("Wait for ChatGPT to finish responding, then import again.");
  });

  it("rejects an empty or unloaded chat", async () => {
    document.querySelectorAll("[data-message-author-role]").forEach((node) => { node.remove(); });
    await expect(capture()).rejects.toThrow("Open a ChatGPT conversation with messages, then import again.");
  });
});

async function capture() {
  const assembler = createCapturePackageAssembler({
    producer: { browser: "Firefox", extensionVersion: "0.1.2" },
    scripting: {} as typeof chrome.scripting,
    promiseScripting: {
      async executeScript(injection) {
        const result = await injection.func?.();
        return [{ frameId: 0, documentId: "fixture", result }];
      },
    },
  });
  return assembler.capture({ kind: "supported", sourceUrl: location.href, tabId: 1, title: document.title });
}
