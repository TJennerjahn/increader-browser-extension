import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createBrowserIdentityFlow,
  createCredentialStore,
  createInstallationIdentity,
  createPairingOperationStore,
  createTabOpener,
} from "./chrome-adapters";

describe.each([
  {
    browser: "Chrome",
    callback:
      "https://haipjkpamjpojalajcgfeggbjhifjpnn.chromiumapp.org/browser-capture",
  },
  {
    browser: "Firefox",
    callback:
      "https://0123456789abcdef0123456789abcdef.extensions.allizom.org/browser-capture",
  },
])("$browser pairing browser adapters", ({ callback }) => {
  beforeEach(() => {
    vi.stubGlobal("chrome", {
      runtime: { lastError: undefined },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps installation identity and renewal credentials in local storage", async () => {
    const values: Record<string, unknown> = {};
    const set = vi.fn((next: Record<string, unknown>, done: () => void) => {
      Object.assign(values, next);
      done();
    });
    const remove = vi.fn((key: string, done: () => void) => {
      Reflect.deleteProperty(values, key);
      done();
    });
    const storage = {
      get: vi.fn(
        (key: string, done: (result: Record<string, unknown>) => void) => {
          done({ [key]: values[key] });
        },
      ),
      set,
      remove,
    } as unknown as chrome.storage.StorageArea;
    const installation = createInstallationIdentity(storage);
    const credentials = createCredentialStore(storage);

    const first = await installation.id();
    const second = await installation.id();
    await credentials.save({
      displayName: "Home Reader",
      installationId: first,
      origin: "https://reader.example",
      pairingId: "019bf66d-29df-7a41-950f-c4b36a9d61bd",
      renewalCredential: "bcr_local_only",
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    await expect(credentials.load()).resolves.toMatchObject({
      renewalCredential: "bcr_local_only",
    });
    expect(set).toHaveBeenCalled();
  });

  it("uses the browser identity callback without exposing a web session", async () => {
    const identityApi = {
      getRedirectURL: vi.fn(() => callback),
      launchWebAuthFlow: vi.fn(
        (
          options: chrome.identity.WebAuthFlowDetails,
          done: (redirect?: string) => void,
        ) => {
          expect(options).toEqual({
            interactive: true,
            url: "https://reader.example/approve",
          });
          done(`${callback}?code=bcc_ok`);
        },
      ),
    } as unknown as typeof chrome.identity;
    const identity = createBrowserIdentityFlow(identityApi);

    expect(identity.callbackUri()).toBe(callback);
    await expect(
      identity.launch("https://reader.example/approve"),
    ).resolves.toBe(`${callback}?code=bcc_ok`);
  });

  it("uses Firefox's promise identity API when the packaged runtime is Firefox", async () => {
    const callbackUri =
      "https://0123456789abcdef0123456789abcdef.extensions.allizom.org/browser-capture";
    const promiseApi = {
      getRedirectURL: vi.fn(() => callbackUri),
      launchWebAuthFlow: vi.fn(() =>
        Promise.resolve(`${callbackUri}?code=bcc_firefox`),
      ),
    };
    const callbackApi = {
      getRedirectURL: vi.fn(() => "https://unused.chromiumapp.org/"),
      launchWebAuthFlow: vi.fn(),
    } as unknown as typeof chrome.identity;
    const runtime = {
      getURL: () => "moz-extension://runtime-id/",
    } as unknown as typeof chrome.runtime;

    const identity = createBrowserIdentityFlow(
      callbackApi,
      runtime,
      promiseApi,
    );

    expect(identity.callbackUri()).toBe(callbackUri);
    await expect(
      identity.launch("https://reader.example/approve"),
    ).resolves.toBe(`${callbackUri}?code=bcc_firefox`);
    expect(promiseApi.launchWebAuthFlow).toHaveBeenCalledWith({
      interactive: true,
      url: "https://reader.example/approve",
    });
    expect(callbackApi.launchWebAuthFlow).not.toHaveBeenCalled();
  });

  it("persists an interrupted Pairing operation and clears completed state", async () => {
    const values: Record<string, unknown> = {};
    const remove = vi.fn((key: string, done: () => void) => {
      Reflect.deleteProperty(values, key);
      done();
    });
    const storage = {
      get: vi.fn(
        (key: string, done: (result: Record<string, unknown>) => void) => {
          done({ [key]: values[key] });
        },
      ),
      set: vi.fn((next: Record<string, unknown>, done: () => void) => {
        Object.assign(values, next);
        done();
      }),
      remove,
    } as unknown as chrome.storage.StorageArea;
    const operations = createPairingOperationStore(storage);

    await expect(operations.load()).resolves.toEqual({ phase: "idle" });
    await operations.save({
      phase: "failed",
      origin: "https://reader.example",
      message: "Pairing was cancelled.",
    });
    await expect(operations.load()).resolves.toEqual({
      phase: "failed",
      origin: "https://reader.example",
      message: "Pairing was cancelled.",
    });

    await operations.save({ phase: "idle" });
    await expect(operations.load()).resolves.toEqual({ phase: "idle" });
    expect(remove).toHaveBeenCalled();
  });

  it("uses Firefox Promise storage when chrome.local is a distinct wrapper", async () => {
    const values: Record<string, unknown> = {};
    const promiseStorage = {
      get: vi.fn((key: string) => Promise.resolve({ [key]: values[key] })),
      set: vi.fn((next: Record<string, unknown>) => {
        Object.assign(values, next);
        return Promise.resolve();
      }),
      remove: vi.fn((key: string) => {
        Reflect.deleteProperty(values, key);
        return Promise.resolve();
      }),
    };
    const callbackSet = vi.fn();
    const callbackStorage = {
      get: vi.fn(),
      set: callbackSet,
      remove: vi.fn(),
    } as unknown as chrome.storage.StorageArea;
    vi.stubGlobal("chrome", {
      runtime: {
        getURL: () => "moz-extension://runtime-id/",
        lastError: undefined,
      },
      storage: {
        get local() {
          return { ...callbackStorage };
        },
      },
    });
    vi.stubGlobal("browser", {
      storage: { local: promiseStorage },
    });
    const credentials = createCredentialStore(callbackStorage);

    await credentials.save({
      displayName: "Home Reader",
      installationId: "019bf66d-29df-7a41-950f-c4b36a9d61bd",
      origin: "https://reader.example",
      pairingId: "019bf66d-29df-7a41-950f-c4b36a9d61be",
      renewalCredential: "bcr_firefox_promise_only",
    });

    await expect(credentials.load()).resolves.toMatchObject({
      renewalCredential: "bcr_firefox_promise_only",
    });
    expect(promiseStorage.set).toHaveBeenCalledOnce();
    expect(callbackSet).not.toHaveBeenCalled();
  });

  it("opens Reader only through an explicit browser-tab action", async () => {
    const create = vi.fn(
      (
        properties: chrome.tabs.CreateProperties,
        done: (tab: chrome.tabs.Tab) => void,
      ) => {
        done({ id: 42 } as chrome.tabs.Tab);
      },
    );
    const open = createTabOpener({
      create,
    } as unknown as typeof chrome.tabs);

    expect(create).not.toHaveBeenCalled();
    await open("https://reader.example/bookmarks/42");

    expect(create).toHaveBeenCalledWith(
      {
        active: true,
        url: "https://reader.example/bookmarks/42",
      },
      expect.any(Function),
    );
  });
});
