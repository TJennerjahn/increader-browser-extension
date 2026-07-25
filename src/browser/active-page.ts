export type ActivePageInspection =
  | {
      faviconUrl?: string;
      kind: "supported";
      sourceUrl: string;
      tabId: number;
      title: string;
    }
  | {
      faviconUrl?: string;
      kind: "unsupported";
      reason: string;
    };

export interface ActivePageInspector {
  inspect(): Promise<ActivePageInspection>;
  observe(listener: () => void): () => void;
}

interface ObservedTopLevelDocument {
  contentType: string;
  sourceUrl: string;
  title: string;
}

export function createActivePageInspector(
  tabs: typeof chrome.tabs = chrome.tabs,
  scripting: typeof chrome.scripting = chrome.scripting,
  promiseApis: PromisePageApis | undefined = firefoxPageApis(),
): ActivePageInspector {
  return {
    async inspect() {
      const query = { active: true, currentWindow: true };
      const activeTabs =
        promiseApis === undefined
          ? await callbackResult<chrome.tabs.Tab[]>((done) => {
              tabs.query(query, done);
            })
          : await promiseApis.tabs.query(query);
      const active = activeTabs[0];
      if (active?.id === undefined || active.url === undefined) {
        return unsupported("No active page is available.");
      }
      const faviconUrl = safeFaviconUrl(active.favIconUrl);
      const candidate = classifyTabUrl(active.url);
      if (candidate !== null) {
        return unsupported(candidate, faviconUrl);
      }

      let results: chrome.scripting.InjectionResult<unknown>[];
      try {
        const injection = {
          func: observeTopLevelDocument,
          target: { tabId: active.id },
          world: "ISOLATED",
        } satisfies chrome.scripting.ScriptInjection<[], unknown>;
        results =
          promiseApis === undefined
            ? await callbackResult((done) => {
                scripting.executeScript(injection, done);
              })
            : await promiseApis.scripting.executeScript(injection);
      } catch {
        return unsupported("This page cannot be inspected for import.");
      }
      const observed = results.find((result) => result.frameId === 0)?.result;
      if (!isObservedDocument(observed)) {
        return unsupported("This page cannot be inspected for import.");
      }
      if (observed.contentType === "application/pdf") {
        return unsupported("PDF pages cannot be imported.");
      }
      if (observed.contentType !== "text/html") {
        return unsupported("Only HTML pages can be imported.");
      }
      const sourceUrl = fragmentFreeHttpUrl(observed.sourceUrl);
      if (sourceUrl === null) {
        return unsupported("This page cannot be imported.");
      }
      return {
        kind: "supported",
        ...(faviconUrl === undefined ? {} : { faviconUrl }),
        sourceUrl,
        tabId: active.id,
        title: observed.title,
      };
    },

    observe(listener) {
      const activated = (): void => {
        listener();
      };
      const updated = (
        _tabId: number,
        changeInfo: chrome.tabs.OnUpdatedInfo,
      ): void => {
        if (
          changeInfo.url !== undefined ||
          changeInfo.status === "complete" ||
          "title" in changeInfo ||
          "favIconUrl" in changeInfo
        ) {
          listener();
        }
      };
      tabs.onActivated.addListener(activated);
      tabs.onUpdated.addListener(updated);
      return () => {
        tabs.onActivated.removeListener(activated);
        tabs.onUpdated.removeListener(updated);
      };
    },
  };
}

interface PromisePageApis {
  tabs: {
    query(query: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]>;
  };
  scripting: {
    executeScript(
      injection: chrome.scripting.ScriptInjection<[], unknown>,
    ): Promise<chrome.scripting.InjectionResult<unknown>[]>;
  };
}

function firefoxPageApis(): PromisePageApis | undefined {
  const candidate = (
    globalThis as typeof globalThis & {
      browser?: Partial<PromisePageApis>;
    }
  ).browser;
  if (candidate?.tabs === undefined || candidate.scripting === undefined) {
    return undefined;
  }
  return candidate as PromisePageApis;
}

function observeTopLevelDocument(): ObservedTopLevelDocument {
  return {
    contentType: document.contentType,
    sourceUrl: location.href,
    title: document.title,
  };
}

function classifyTabUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "This page cannot be imported.";
  }
  if (url.protocol === "http:" || url.protocol === "https:") {
    return null;
  }
  if (url.protocol === "file:") {
    return "Local files cannot be imported.";
  }
  if (
    url.protocol === "chrome-extension:" ||
    url.protocol === "moz-extension:" ||
    url.protocol === "safari-web-extension:"
  ) {
    return "Extension pages cannot be imported.";
  }
  return "Browser-protected pages cannot be imported.";
}

function fragmentFreeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      !(url.protocol === "http:" || url.protocol === "https:") ||
      url.username !== "" ||
      url.password !== ""
    ) {
      return null;
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function isObservedDocument(value: unknown): value is ObservedTopLevelDocument {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.contentType === "string" &&
    typeof candidate.sourceUrl === "string" &&
    typeof candidate.title === "string"
  );
}

function safeFaviconUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") return value;
    return url.protocol === "data:" &&
      value.toLowerCase().startsWith("data:image/")
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

function unsupported(
  reason: string,
  faviconUrl?: string,
): ActivePageInspection {
  return {
    ...(faviconUrl === undefined ? {} : { faviconUrl }),
    kind: "unsupported",
    reason,
  };
}

function callbackResult<T>(
  invoke: (done: (value: T) => void) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    invoke((value) => {
      const error = chrome.runtime.lastError;
      if (error === undefined) {
        resolve(value);
      } else {
        reject(new Error(error.message));
      }
    });
  });
}
