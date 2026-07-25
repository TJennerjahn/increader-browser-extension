import { describe, expect, it, vi } from "vitest";

import { createActivePageInspector } from "./active-page";

describe.each(["Chrome", "Firefox"])("%s active page inspection", () => {
  it("observes only the active top-level HTML page without serializing content", async () => {
    const query = vi.fn(
      (
        queryInfo: chrome.tabs.QueryInfo,
        done: (tabs: chrome.tabs.Tab[]) => void,
      ) => {
        expect(queryInfo).toEqual({ active: true, currentWindow: true });
        done([
          {
            id: 91,
            title: "Untrusted tab title",
            url: "https://example.com/articles/one#comments",
          } as chrome.tabs.Tab,
        ]);
      },
    );
    const executeScript = vi.fn(
      (
        details: chrome.scripting.ScriptInjection<[], unknown>,
        done: (results: chrome.scripting.InjectionResult[]) => void,
      ) => {
        expect(details.target).toEqual({ tabId: 91 });
        expect(details.world).toBe("ISOLATED");
        expect(details.func?.toString()).not.toMatch(
          /body|documentElement|innerHTML|outerHTML|XMLSerializer/,
        );
        done([
          {
            documentId: "document-91",
            frameId: 0,
            result: {
              contentType: "text/html",
              sourceUrl: "https://example.com/articles/one#comments",
              title: "Observed Article",
            },
          },
        ]);
      },
    );
    vi.stubGlobal("chrome", { runtime: { lastError: undefined } });
    const inspector = createActivePageInspector(tabsApi(query), {
      executeScript,
    } as unknown as typeof chrome.scripting);

    await expect(inspector.inspect()).resolves.toEqual({
      kind: "supported",
      sourceUrl: "https://example.com/articles/one",
      tabId: 91,
      title: "Observed Article",
    });
    expect(executeScript).toHaveBeenCalledOnce();
  });

  it.each([
    ["chrome://settings", "Browser-protected pages cannot be imported."],
    ["about:preferences", "Browser-protected pages cannot be imported."],
    [
      "moz-extension://extension-id/popup.html",
      "Extension pages cannot be imported.",
    ],
    ["file:///home/user/article.html", "Local files cannot be imported."],
  ])("rejects unsupported active tab %s", async (url, reason) => {
    const executeScript = vi.fn();
    vi.stubGlobal("chrome", { runtime: { lastError: undefined } });
    const inspector = createActivePageInspector(
      tabsApi((_query, done) => {
        done([{ id: 17, url } as chrome.tabs.Tab]);
      }),
      { executeScript } as unknown as typeof chrome.scripting,
    );

    await expect(inspector.inspect()).resolves.toEqual({
      kind: "unsupported",
      reason,
    });
    expect(executeScript).not.toHaveBeenCalled();
  });

  it.each([
    ["application/pdf", "PDF pages cannot be imported."],
    ["text/plain", "Only HTML pages can be imported."],
  ])("rejects top-level %s documents", async (contentType, reason) => {
    vi.stubGlobal("chrome", { runtime: { lastError: undefined } });
    const inspector = createActivePageInspector(
      tabsApi((_query, done) => {
        done([
          {
            id: 17,
            url: "https://example.com/document",
          } as chrome.tabs.Tab,
        ]);
      }),
      {
        executeScript: vi.fn(
          (
            _details: chrome.scripting.ScriptInjection<[], unknown>,
            done: (results: chrome.scripting.InjectionResult[]) => void,
          ) => {
            done([
              {
                documentId: "document-17",
                frameId: 0,
                result: {
                  contentType,
                  sourceUrl: "https://example.com/document",
                  title: "Document",
                },
              },
            ]);
          },
        ),
      } as unknown as typeof chrome.scripting,
    );

    await expect(inspector.inspect()).resolves.toEqual({
      kind: "unsupported",
      reason,
    });
  });

  it("refreshes after active-tab switches and top-level navigation", () => {
    const activatedListeners = new Set<() => void>();
    const updatedListeners = new Set<
      (tabId: number, change: chrome.tabs.OnUpdatedInfo) => void
    >();
    const tabs = tabsApi(
      (_query, done) => {
        done([]);
      },
      {
        activatedListeners,
        updatedListeners,
      },
    );
    vi.stubGlobal("chrome", { runtime: { lastError: undefined } });
    const inspector = createActivePageInspector(tabs, {
      executeScript: vi.fn(),
    } as unknown as typeof chrome.scripting);
    const refresh = vi.fn();

    const stop = inspector.observe(refresh);
    for (const listener of activatedListeners) listener();
    for (const listener of updatedListeners)
      listener(19, { url: "https://two.example" });
    for (const listener of updatedListeners)
      listener(19, { status: "complete" });

    expect(refresh).toHaveBeenCalledTimes(3);
    stop();
    expect(activatedListeners).toHaveLength(0);
    expect(updatedListeners).toHaveLength(0);
  });
});

function tabsApi(
  query: (
    queryInfo: chrome.tabs.QueryInfo,
    done: (tabs: chrome.tabs.Tab[]) => void,
  ) => void,
  listeners?: {
    activatedListeners: Set<() => void>;
    updatedListeners: Set<
      (tabId: number, change: chrome.tabs.OnUpdatedInfo) => void
    >;
  },
): typeof chrome.tabs {
  return {
    onActivated: {
      addListener: (listener: () => void) =>
        listeners?.activatedListeners.add(listener),
      removeListener: (listener: () => void) =>
        listeners?.activatedListeners.delete(listener),
    },
    onUpdated: {
      addListener: (
        listener: (tabId: number, change: chrome.tabs.OnUpdatedInfo) => void,
      ) => listeners?.updatedListeners.add(listener),
      removeListener: (
        listener: (tabId: number, change: chrome.tabs.OnUpdatedInfo) => void,
      ) => listeners?.updatedListeners.delete(listener),
    },
    query,
  } as unknown as typeof chrome.tabs;
}
