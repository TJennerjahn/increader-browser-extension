import { describe, expect, it, vi } from "vitest";

import { createAuthenticationClient } from "./auth-runtime";

describe("popup authentication runtime", () => {
  it("requests the instance and Clerk origins for Increader Cloud", async () => {
    const request = vi.fn().mockResolvedValue(true);
    const sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        displayName: "reader@example.com",
        email: "reader@example.com",
        origin: "https://app.increader.com",
      },
    });
    const runtime = {
      getURL: () => "chrome-extension://extension-id/",
    } as unknown as typeof chrome.runtime;
    const client = createAuthenticationClient(
      runtime,
      {} as typeof chrome.permissions,
      { sendMessage },
      { request },
    );

    await client.signIn(
      "https://app.increader.com",
      "reader@example.com",
      "secret",
    );

    expect(request).toHaveBeenCalledWith({
      origins: ["https://app.increader.com/*", "https://clerk.increader.com/*"],
    });
    expect(sendMessage).toHaveBeenCalledWith({
      command: "sign-in",
      email: "reader@example.com",
      origin: "https://app.increader.com",
      password: "secret",
      target: "authentication",
    });
  });

  it("requests only the selected self-hosted origin", async () => {
    const request = vi.fn().mockResolvedValue(true);
    const sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        displayName: "reader@example.com",
        email: "reader@example.com",
        origin: "https://reader.example",
      },
    });
    const client = createAuthenticationClient(
      {
        getURL: () => "chrome-extension://extension-id/",
      } as unknown as typeof chrome.runtime,
      {} as typeof chrome.permissions,
      { sendMessage },
      { request },
    );

    await client.signIn(
      "https://reader.example/",
      "reader@example.com",
      "secret",
    );

    expect(request).toHaveBeenCalledWith({
      origins: ["https://reader.example/*"],
    });
  });

  it("requests Cloud and Clerk origins before Google sign-in", async () => {
    const request = vi.fn().mockResolvedValue(true);
    const sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        displayName: "google-reader@example.com",
        email: "google-reader@example.com",
        origin: "https://app.increader.com",
      },
    });
    const runtime = {
      getURL: () => "chrome-extension://extension-id/",
    } as unknown as typeof chrome.runtime;
    const client = createAuthenticationClient(
      runtime,
      {} as typeof chrome.permissions,
      { sendMessage },
      { request },
    );

    await client.signInWithGoogle();

    expect(request).toHaveBeenCalledWith({
      origins: ["https://app.increader.com/*", "https://clerk.increader.com/*"],
    });
    expect(sendMessage).toHaveBeenCalledWith({
      command: "sign-in-google",
      target: "authentication",
    });
  });

  it("marks speculative token access so it cannot forget the account", async () => {
    const sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      value: "short-lived-token",
    });
    const client = createAuthenticationClient(
      {
        getURL: () => "chrome-extension://extension-id/",
      } as unknown as typeof chrome.runtime,
      {} as typeof chrome.permissions,
      { sendMessage },
    );

    await client.accessToken({ retainAccountOnExpiry: true });

    expect(sendMessage).toHaveBeenCalledWith({
      command: "access-token",
      retainAccountOnExpiry: true,
      target: "authentication",
    });
  });
});
