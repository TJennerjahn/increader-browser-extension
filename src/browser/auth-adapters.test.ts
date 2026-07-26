import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createCloudAccountClient,
  createSelfHostedAccountClient,
} from "./auth-adapters";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("self-hosted account authentication", () => {
  it("uses the normal login endpoint and the normal session cookie", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          expiresAt: "2026-07-26T12:00:00Z",
          user: { email: "reader@example.com", id: "user-1" },
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 200,
        },
      ),
    );
    const getCookie = vi.fn().mockResolvedValue({
      domain: "reader.example",
      expirationDate: 1_800_000_000,
      hostOnly: true,
      httpOnly: true,
      name: "increader_auth",
      path: "/",
      sameSite: "lax",
      secure: true,
      session: false,
      storeId: "0",
      value: "normal-session-token",
    });
    vi.stubGlobal("browser", { cookies: { get: getCookie } });
    const client = createSelfHostedAccountClient(
      "https://reader.example",
      fetcher,
      {} as typeof chrome.cookies,
    );

    await expect(
      client.signIn("reader@example.com", "correct horse"),
    ).resolves.toBe("reader@example.com");
    await expect(client.accessToken()).resolves.toBe("normal-session-token");
    await expect(client.isSignedIn()).resolves.toBe(true);

    expect(fetcher).toHaveBeenCalledWith(
      "https://reader.example/api/auth/login",
      {
        body: JSON.stringify({
          email: "reader@example.com",
          password: "correct horse",
        }),
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        method: "POST",
        redirect: "error",
      },
    );
    expect(getCookie).toHaveBeenCalledWith({
      name: "increader_auth",
      url: "https://reader.example/",
    });
  });

  it("reports the normal invalid-credentials response", async () => {
    const client = createSelfHostedAccountClient(
      "https://reader.example",
      vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
      {} as typeof chrome.cookies,
    );

    await expect(client.signIn("reader@example.com", "wrong")).rejects.toThrow(
      "Invalid email or password.",
    );
  });

  it("uses the normal client message for rate-limited sign-in", async () => {
    const client = createSelfHostedAccountClient(
      "https://reader.example",
      vi.fn().mockResolvedValue(new Response(null, { status: 429 })),
      {} as typeof chrome.cookies,
    );

    await expect(client.signIn("reader@example.com", "secret")).rejects.toThrow(
      "Too many attempts. Please wait a moment and try again.",
    );
  });

  it("preserves structured API error messages like the normal client", async () => {
    const client = createSelfHostedAccountClient(
      "https://reader.example",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: "Password is required." }), {
          headers: { "Content-Type": "application/json" },
          status: 400,
        }),
      ),
      {} as typeof chrome.cookies,
    );

    await expect(client.signIn("reader@example.com", "")).rejects.toThrow(
      "Password is required.",
    );
  });

  it("preserves text API errors like the normal client", async () => {
    const client = createSelfHostedAccountClient(
      "https://reader.example",
      vi
        .fn()
        .mockResolvedValue(
          new Response("Invalid CORS request", { status: 403 }),
        ),
      {} as typeof chrome.cookies,
    );

    await expect(client.signIn("reader@example.com", "secret")).rejects.toThrow(
      "Invalid CORS request",
    );
  });
});

describe("Increader Cloud account authentication", () => {
  it("creates a normal Clerk sign-in and refreshes its normal session token", async () => {
    const values: Record<string, unknown> = {};
    const storage = {
      get: (key: string) => Promise.resolve({ [key]: values[key] }),
      remove: (key: string) => {
        Reflect.deleteProperty(values, key);
        return Promise.resolve();
      },
      set: (next: Record<string, unknown>) => {
        Object.assign(values, next);
        return Promise.resolve();
      },
    };
    vi.stubGlobal("browser", { storage: { local: storage } });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(clerkResponse({ response: {} }, "client-one"))
      .mockResolvedValueOnce(
        clerkResponseWithoutAuthorization({
          response: {
            created_session_id: "sess_normal",
            status: "complete",
          },
        }),
      )
      .mockResolvedValueOnce(
        clerkResponse({ jwt: "normal-user-token" }, "client-three"),
      )
      .mockResolvedValueOnce(
        clerkResponse({ jwt: "fresh-user-token" }, "client-four"),
      )
      .mockResolvedValueOnce(clerkResponse({ response: {} }, "client-five"));
    const client = createCloudAccountClient(
      fetcher,
      {} as chrome.storage.StorageArea,
    );

    await expect(
      client.signIn("reader@example.com", "correct horse"),
    ).resolves.toBe("reader@example.com");
    await expect(client.accessToken()).resolves.toBe("normal-user-token");
    await expect(client.isSignedIn()).resolves.toBe(true);
    await client.signOut();

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "https://clerk.increader.com/v1/client?_is_native=1",
      expect.objectContaining({
        credentials: "omit",
        method: "GET",
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "https://clerk.increader.com/v1/client/sign_ins?_is_native=1",
      expect.objectContaining({
        body: new URLSearchParams({
          identifier: "reader@example.com",
          password: "correct horse",
        }),
        credentials: "omit",
        method: "POST",
      }),
    );
    const tokenRequest = fetcher.mock.calls[2]?.[1] as RequestInit;
    expect(new Headers(tokenRequest.headers).get("Authorization")).toBe(
      "Bearer client-one",
    );
    expect(values.browserCaptureCloudSession).toBeUndefined();
  });

  it("hands Google OAuth to the normal Cloud flow and adopts its client session", async () => {
    const values: Record<string, unknown> = {};
    let cookieListener:
      ((change: chrome.cookies.CookieChangeInfo) => void) | undefined;
    const syncedCookie = {
      domain: "clerk.increader.com",
      expirationDate: 1_800_000_000,
      hostOnly: true,
      httpOnly: true,
      name: "__client",
      path: "/",
      sameSite: "lax",
      secure: true,
      session: false,
      storeId: "0",
      value: "synced-client-jwt",
    } satisfies chrome.cookies.Cookie;
    const storage = {
      get: (key: string) => Promise.resolve({ [key]: values[key] }),
      remove: (key: string) => {
        Reflect.deleteProperty(values, key);
        return Promise.resolve();
      },
      set: (next: Record<string, unknown>) => {
        Object.assign(values, next);
        return Promise.resolve();
      },
    };
    const createTab = vi.fn().mockImplementation(() => {
      queueMicrotask(() => {
        cookieListener?.({
          cookie: syncedCookie,
          cause: "explicit",
          removed: false,
        });
      });
      return Promise.resolve({ id: 42 });
    });
    const browserCookies = {
      get: vi.fn().mockResolvedValue(null),
      onChanged: {
        addListener(
          listener: (change: chrome.cookies.CookieChangeInfo) => void,
        ) {
          cookieListener = listener;
        },
        removeListener(
          listener: (change: chrome.cookies.CookieChangeInfo) => void,
        ) {
          if (cookieListener === listener) cookieListener = undefined;
        },
      },
    } as unknown as typeof chrome.cookies;
    vi.stubGlobal("browser", {
      cookies: browserCookies,
      storage: { local: storage },
      tabs: { create: createTab },
    });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(clerkResponse({ response: {} }, "client-one"))
      .mockResolvedValueOnce(
        clerkResponse(
          {
            response: {
              first_factor_verification: {
                external_verification_redirect_url:
                  "https://accounts.google.com/o/oauth2/auth",
              },
            },
          },
          "client-two",
        ),
      )
      .mockResolvedValueOnce(
        clerkResponse(
          {
            response: {
              last_active_session_id: "sess_google",
              sessions: [
                {
                  id: "sess_google",
                  user: {
                    email_addresses: [
                      {
                        email_address: "google-reader@example.com",
                        id: "email_google",
                      },
                    ],
                    primary_email_address_id: "email_google",
                  },
                },
              ],
            },
          },
          "client-three",
        ),
      );
    const client = createCloudAccountClient(
      fetcher,
      {} as chrome.storage.StorageArea,
      browserCookies,
      {} as typeof chrome.tabs,
    );

    await expect(client.signInWithGoogle()).resolves.toBe(
      "google-reader@example.com",
    );
    expect(createTab).toHaveBeenCalledWith({
      active: true,
      url: "https://accounts.google.com/o/oauth2/auth",
    });
    expect(browserCookies.get).toHaveBeenCalledWith({
      name: "__client",
      url: "https://clerk.increader.com/",
    });
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "https://clerk.increader.com/v1/client?_is_native=1",
      expect.objectContaining({
        credentials: "omit",
        method: "GET",
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "https://clerk.increader.com/v1/client/sign_ins?_is_native=1",
      expect.objectContaining({
        body: new URLSearchParams({
          action_complete_redirect_url: "https://app.increader.com/",
          redirect_url: "https://app.increader.com/sign-in",
          strategy: "oauth_google",
        }),
      }),
    );
    expect(values.browserCaptureCloudSession).toEqual({
      authorization: "client-three",
      sessionId: "sess_google",
    });
  });
});

function clerkResponse(body: unknown, authorization: string): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    status: 200,
  });
}

function clerkResponseWithoutAuthorization(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json",
    },
    status: 200,
  });
}
