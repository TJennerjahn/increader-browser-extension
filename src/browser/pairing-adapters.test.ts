import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createBrowserIdentityFlow,
  createCredentialStore,
  createInstallationIdentity
} from "./chrome-adapters";

describe.each([
  {
    browser: "Chrome",
    callback:
      "https://haipjkpamjpojalajcgfeggbjhifjpnn.chromiumapp.org/browser-capture"
  },
  {
    browser: "Firefox",
    callback:
      "https://0123456789abcdef0123456789abcdef.extensions.allizom.org/browser-capture"
  }
])("$browser pairing browser adapters", ({ callback }) => {
  beforeEach(() => {
    vi.stubGlobal("chrome", {
      runtime: { lastError: undefined }
    });
  });

  it("keeps installation identity and renewal credentials in local storage", async () => {
    const values: Record<string, unknown> = {};
    const set = vi.fn((next: Record<string, unknown>, done: () => void) => {
      Object.assign(values, next);
      done();
    });
    const storage = {
      get: vi.fn((key: string, done: (result: Record<string, unknown>) => void) => {
        done({ [key]: values[key] });
      }),
      set,
      remove: vi.fn((key: string, done: () => void) => {
        Reflect.deleteProperty(values, key);
        done();
      })
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
      renewalCredential: "bcr_local_only"
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    await expect(credentials.load()).resolves.toMatchObject({
      renewalCredential: "bcr_local_only"
    });
    expect(set).toHaveBeenCalled();
  });

  it("uses the browser identity callback without exposing a web session", async () => {
    const identityApi = {
      getRedirectURL: vi.fn(() => callback),
      launchWebAuthFlow: vi.fn(
        (
          options: chrome.identity.WebAuthFlowDetails,
          done: (redirect?: string) => void
        ) => {
          expect(options).toEqual({
            interactive: true,
            url: "https://reader.example/approve"
          });
          done(`${callback}?code=bcc_ok`);
        }
      )
    } as unknown as typeof chrome.identity;
    const identity = createBrowserIdentityFlow(identityApi);

    expect(identity.callbackUri()).toBe(callback);
    await expect(
      identity.launch("https://reader.example/approve")
    ).resolves.toBe(`${callback}?code=bcc_ok`);
  });
});
