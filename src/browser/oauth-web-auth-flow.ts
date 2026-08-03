export interface OAuthWebAuthFlow {
  getRedirectUrl(): string;
  launch(url: string): Promise<string>;
}

export function createOAuthWebAuthFlow(
  api: typeof chrome.identity = chrome.identity,
  firefoxApi: FirefoxOAuthApi | undefined = firefoxOAuthApi(),
): OAuthWebAuthFlow {
  const identity = firefoxApi?.identity ?? api;
  return {
    getRedirectUrl() {
      return identity.getRedirectURL("clerk");
    },
    async launch(url) {
      // Firefox rejects Clerk's Google URL because its intermediate
      // redirect_uri points to Clerk, even though Clerk ultimately returns to
      // the extension callback. A scoped popup preserves that native Clerk
      // callback without routing the user through the Increader web app.
      if (firefoxApi !== undefined) {
        return launchFirefoxPopup(
          firefoxApi,
          url,
          identity.getRedirectURL("clerk"),
        );
      }
      const details = { interactive: true, url };
      const callbackUrl = await callbackResult<string | undefined>((done) => {
        api.launchWebAuthFlow(details, done);
      });
      if (callbackUrl === undefined || callbackUrl.length === 0) {
        throw new Error("Google sign-in was canceled.");
      }
      return callbackUrl;
    },
  };
}

interface FirefoxIdentityApi {
  getRedirectURL(path?: string): string;
}

type TabUpdatedListener = (
  tabId: number,
  changeInfo: { url?: string },
  tab: { id?: number },
) => void;

type WindowRemovedListener = (windowId: number) => void;

interface FirefoxOAuthApi {
  identity: FirefoxIdentityApi;
  tabs: {
    onUpdated: FirefoxEvent<TabUpdatedListener>;
  };
  windows: {
    create(details: {
      height: number;
      type: "popup";
      url: string;
      width: number;
    }): Promise<{ id?: number; tabs?: Array<{ id?: number }> }>;
    onRemoved: FirefoxEvent<WindowRemovedListener>;
    remove(windowId: number): Promise<void>;
  };
}

interface FirefoxEvent<T> {
  addListener(listener: T): void;
  removeListener(listener: T): void;
}

function firefoxOAuthApi(): FirefoxOAuthApi | undefined {
  return (
    globalThis as typeof globalThis & {
      browser?: FirefoxOAuthApi;
    }
  ).browser;
}

function launchFirefoxPopup(
  api: FirefoxOAuthApi,
  url: string,
  callbackUrl: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let authWindowId: number | undefined;
    let authTabId: number | undefined;
    let settled = false;

    const cleanup = () => {
      api.tabs.onUpdated.removeListener(onUpdated);
      api.windows.onRemoved.removeListener(onRemoved);
    };
    const finish = (returnedUrl: string | null, error?: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      const windowId = authWindowId;
      authWindowId = undefined;
      const closed =
        windowId === undefined
          ? Promise.resolve()
          : api.windows.remove(windowId).catch(() => undefined);
      void closed.then(() => {
        if (returnedUrl !== null) resolve(returnedUrl);
        else reject(toError(error));
      });
    };
    const onUpdated: TabUpdatedListener = (tabId, changeInfo) => {
      if (
        tabId === authTabId &&
        changeInfo.url !== undefined &&
        matchesCallback(changeInfo.url, callbackUrl)
      ) {
        finish(changeInfo.url);
      }
    };
    const onRemoved: WindowRemovedListener = (windowId) => {
      if (windowId === authWindowId) {
        authWindowId = undefined;
        finish(null, new Error("Google sign-in was canceled."));
      }
    };

    api.tabs.onUpdated.addListener(onUpdated);
    api.windows.onRemoved.addListener(onRemoved);
    void api.windows
      .create({ height: 720, type: "popup", url, width: 520 })
      .then((authWindow) => {
        const tabId = authWindow.tabs?.[0]?.id;
        if (authWindow.id === undefined || tabId === undefined) {
          finish(null, new Error("Google sign-in could not open."));
          return;
        }
        authWindowId = authWindow.id;
        authTabId = tabId;
      })
      .catch((error: unknown) => {
        finish(null, error);
      });
  });
}

function matchesCallback(candidate: string, expected: string): boolean {
  try {
    const candidateUrl = new URL(candidate);
    const expectedUrl = new URL(expected);
    return (
      candidateUrl.origin === expectedUrl.origin &&
      candidateUrl.pathname === expectedUrl.pathname
    );
  } catch {
    return false;
  }
}

function toError(value: unknown): Error {
  return value instanceof Error
    ? value
    : new Error("Google sign-in could not open.");
}

function callbackResult<T>(
  invoke: (done: (value: T) => void) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    invoke((value) => {
      const error = chrome.runtime.lastError;
      if (error === undefined) resolve(value);
      else reject(new Error(error.message));
    });
  });
}
