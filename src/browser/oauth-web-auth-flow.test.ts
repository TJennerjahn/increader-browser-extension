import { afterEach, describe, expect, it, vi } from "vitest";

import { createOAuthWebAuthFlow } from "./oauth-web-auth-flow";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browser-managed OAuth", () => {
  it("uses Chrome's stable extension callback and interactive auth window", async () => {
    const callbackUrl =
      "https://haipjkpamjpojalajcgfeggbjhifjpnn.chromiumapp.org/clerk";
    const launchWebAuthFlow = vi.fn(
      (
        _details: chrome.identity.WebAuthFlowDetails,
        done: (responseUrl?: string) => void,
      ) => {
        done(`${callbackUrl}?rotating_token_nonce=nonce`);
      },
    );
    const identity = {
      getRedirectURL: vi.fn().mockReturnValue(callbackUrl),
      launchWebAuthFlow,
    } as unknown as typeof chrome.identity;
    vi.stubGlobal("chrome", { runtime: {} });
    const flow = createOAuthWebAuthFlow(identity);

    expect(flow.getRedirectUrl()).toBe(callbackUrl);
    await expect(flow.launch("https://accounts.google.com/auth")).resolves.toBe(
      `${callbackUrl}?rotating_token_nonce=nonce`,
    );
    expect(identity.getRedirectURL).toHaveBeenCalledWith("clerk");
    expect(launchWebAuthFlow).toHaveBeenCalledWith(
      {
        interactive: true,
        url: "https://accounts.google.com/auth",
      },
      expect.any(Function),
    );
  });

  it("uses a Firefox popup when Clerk's provider URL has its own redirect_uri", async () => {
    const callbackUrl =
      "https://67a4223028cae940bb8b49e4730746728ae11c28.extensions.allizom.org/clerk";
    const identity = {
      getRedirectURL: vi.fn().mockReturnValue(callbackUrl),
      launchWebAuthFlow: vi
        .fn()
        .mockRejectedValue(new Error("redirect_uri not allowed")),
    };
    const updatedListeners = new Set<
      (
        tabId: number,
        changeInfo: { url?: string },
        tab: { id?: number },
      ) => void
    >();
    const removedListeners = new Set<(windowId: number) => void>();
    const windows = {
      create: vi.fn().mockResolvedValue({ id: 41, tabs: [{ id: 73 }] }),
      onRemoved: event(removedListeners),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const tabs = { onUpdated: event(updatedListeners) };
    const flow = createOAuthWebAuthFlow(
      {} as typeof chrome.identity,
      { identity, tabs, windows },
    );

    expect(flow.getRedirectUrl()).toBe(callbackUrl);
    const launched = flow.launch(
      "https://accounts.google.com/o/oauth2/auth?redirect_uri=https%3A%2F%2Fclerk.increader.com%2Fv1%2Foauth_callback",
    );
    await vi.waitFor(() => {
      expect(windows.create).toHaveBeenCalledOnce();
    });
    for (const listener of updatedListeners) {
      listener(
        73,
        { url: `${callbackUrl}?rotating_token_nonce=nonce` },
        { id: 73 },
      );
    }

    await expect(launched).resolves.toBe(
      `${callbackUrl}?rotating_token_nonce=nonce`,
    );
    expect(identity.launchWebAuthFlow).not.toHaveBeenCalled();
    expect(windows.create).toHaveBeenCalledWith({
      height: 720,
      type: "popup",
      url: "https://accounts.google.com/o/oauth2/auth?redirect_uri=https%3A%2F%2Fclerk.increader.com%2Fv1%2Foauth_callback",
      width: 520,
    });
    expect(windows.remove).toHaveBeenCalledWith(41);
    expect(updatedListeners).toHaveLength(0);
    expect(removedListeners).toHaveLength(0);
  });
});

function event<T>(listeners: Set<T>) {
  return {
    addListener(listener: T) {
      listeners.add(listener);
    },
    removeListener(listener: T) {
      listeners.delete(listener);
    },
  };
}
