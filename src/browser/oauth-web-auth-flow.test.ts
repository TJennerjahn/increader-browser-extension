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

  it("uses Firefox's promise identity API", async () => {
    const callbackUrl =
      "https://browser-capture_increader_com.extensions.allizom.org/clerk";
    const promiseIdentity = {
      getRedirectURL: vi.fn().mockReturnValue(callbackUrl),
      launchWebAuthFlow: vi
        .fn()
        .mockResolvedValue(`${callbackUrl}?rotating_token_nonce=nonce`),
    };
    const flow = createOAuthWebAuthFlow(
      {} as typeof chrome.identity,
      promiseIdentity,
    );

    expect(flow.getRedirectUrl()).toBe(callbackUrl);
    await expect(flow.launch("https://accounts.google.com/auth")).resolves.toBe(
      `${callbackUrl}?rotating_token_nonce=nonce`,
    );
    expect(promiseIdentity.launchWebAuthFlow).toHaveBeenCalledWith({
      interactive: true,
      url: "https://accounts.google.com/auth",
    });
  });
});
