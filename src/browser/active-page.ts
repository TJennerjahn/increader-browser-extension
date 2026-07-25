export type ActivePageInspection =
  | {
      kind: "supported";
      sourceUrl: string;
      tabId: number;
      title: string;
    }
  | {
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
): ActivePageInspector {
  return {
    async inspect() {
      const activeTabs = await callbackResult<chrome.tabs.Tab[]>((done) => {
        tabs.query({ active: true, currentWindow: true }, done);
      });
      const active = activeTabs[0];
      if (active?.id === undefined || active.url === undefined) {
        return unsupported("No active page is available.");
      }
      const candidate = classifyTabUrl(active.url);
      if (candidate !== null) {
        return unsupported(candidate);
      }

      let results: chrome.scripting.InjectionResult<unknown>[];
      try {
        results = await callbackResult((done) => {
          scripting.executeScript(
            {
              func: observeTopLevelDocument,
              target: { tabId: active.id as number },
              world: "ISOLATED",
            },
            done,
          );
        });
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
          "title" in changeInfo
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

function unsupported(reason: string): ActivePageInspection {
  return { kind: "unsupported", reason };
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
