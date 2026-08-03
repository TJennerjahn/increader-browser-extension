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
      .mockResolvedValueOnce(clerkResponse({ response: {} }, "client-four"));
    const client = createCloudAccountClient(
      fetcher,
      {} as chrome.storage.StorageArea,
    );

    await expect(
      client.signIn("reader@example.com", "correct horse"),
    ).resolves.toBe("reader@example.com");
    await expect(client.accessToken()).resolves.toBe("normal-user-token");
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

  it("completes Google OAuth through the browser-managed extension callback", async () => {
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
    const callbackUrl =
      "https://haipjkpamjpojalajcgfeggbjhifjpnn.chromiumapp.org/clerk";
    const webAuthFlow = {
      getRedirectUrl: vi.fn().mockReturnValue(callbackUrl),
      launch: vi
        .fn()
        .mockResolvedValue(
          `${callbackUrl}?__clerk_status=verified&rotating_token_nonce=nonce-google`,
        ),
    };
    vi.stubGlobal("browser", {
      storage: { local: storage },
    });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(clerkResponse({ response: {} }, "client-one"))
      .mockResolvedValueOnce(
        clerkResponse(
          {
            response: {
              id: "signin-google",
              first_factor_verification: {
                external_verification_redirect_url:
                  "https://accounts.google.com/o/oauth2/auth",
                status: "unverified",
              },
              status: "needs_first_factor",
            },
          },
          "client-two",
        ),
      )
      .mockResolvedValueOnce(
        clerkResponse(
          {
            response: {
              created_session_id: "sess_google",
              first_factor_verification: { status: "verified" },
              id: "signin-google",
              status: "complete",
            },
            client: {
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
      webAuthFlow,
    );

    await expect(client.signInWithGoogle()).resolves.toBe(
      "google-reader@example.com",
    );
    expect(webAuthFlow.getRedirectUrl).toHaveBeenCalledOnce();
    expect(webAuthFlow.launch).toHaveBeenCalledWith(
      "https://accounts.google.com/o/oauth2/auth",
    );
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
          redirect_url: callbackUrl,
          strategy: "oauth_google",
        }),
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      "https://clerk.increader.com/v1/client/sign_ins/signin-google?rotating_token_nonce=nonce-google&_is_native=1",
      expect.objectContaining({
        credentials: "omit",
        method: "GET",
      }),
    );
    const completionRequest = fetcher.mock.calls[2]?.[1] as RequestInit;
    expect(new Headers(completionRequest.headers).get("Authorization")).toBe(
      "Bearer client-two",
    );
    expect(values.browserCaptureCloudSession).toEqual({
      authorization: "client-three",
      sessionId: "sess_google",
    });
  });

  it("transfers a new Google identity into a normal Cloud sign-up", async () => {
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
    const callbackUrl =
      "https://haipjkpamjpojalajcgfeggbjhifjpnn.chromiumapp.org/clerk";
    const webAuthFlow = {
      getRedirectUrl: vi.fn().mockReturnValue(callbackUrl),
      launch: vi
        .fn()
        .mockResolvedValue(
          `${callbackUrl}?__clerk_status=failed&__clerk_error_code=external_account_not_found&rotating_token_nonce=nonce-new`,
        ),
    };
    vi.stubGlobal("browser", { storage: { local: storage } });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(clerkResponse({ response: {} }, "client-one"))
      .mockResolvedValueOnce(
        clerkResponse(
          {
            response: {
              id: "signin-new",
              first_factor_verification: {
                external_verification_redirect_url:
                  "https://accounts.google.com/o/oauth2/auth",
                status: "unverified",
              },
              status: "needs_first_factor",
            },
          },
          "client-two",
        ),
      )
      .mockResolvedValueOnce(
        clerkResponse(
          {
            response: {
              created_session_id: null,
              first_factor_verification: { status: "transferable" },
              id: "signin-new",
              status: "needs_first_factor",
            },
            client: {},
          },
          "client-three",
        ),
      )
      .mockResolvedValueOnce(
        clerkResponse(
          {
            response: {
              created_session_id: "sess_new_google",
              status: "complete",
            },
            client: {
              last_active_session_id: "sess_new_google",
              sessions: [
                {
                  id: "sess_new_google",
                  user: {
                    email_addresses: [
                      {
                        email_address: "new-google-reader@example.com",
                        id: "email_new_google",
                      },
                    ],
                    primary_email_address_id: "email_new_google",
                  },
                },
              ],
            },
          },
          "client-four",
        ),
      );
    const client = createCloudAccountClient(
      fetcher,
      {} as chrome.storage.StorageArea,
      webAuthFlow,
    );

    await expect(client.signInWithGoogle()).resolves.toBe(
      "new-google-reader@example.com",
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      4,
      "https://clerk.increader.com/v1/client/sign_ups?_is_native=1",
      expect.objectContaining({
        body: new URLSearchParams({ transfer: "true" }),
        method: "POST",
      }),
    );
    expect(values.browserCaptureCloudSession).toEqual({
      authorization: "client-four",
      sessionId: "sess_new_google",
    });
  });

  it("stops when the browser-managed Google flow is canceled", async () => {
    const callbackUrl =
      "https://haipjkpamjpojalajcgfeggbjhifjpnn.chromiumapp.org/clerk";
    const webAuthFlow = {
      getRedirectUrl: vi.fn().mockReturnValue(callbackUrl),
      launch: vi
        .fn()
        .mockResolvedValue(
          `${callbackUrl}?__clerk_status=failed&__clerk_error_code=oauth_access_denied`,
        ),
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(clerkResponse({ response: {} }, "client-one"))
      .mockResolvedValueOnce(
        clerkResponse(
          {
            response: {
              id: "signin-canceled",
              first_factor_verification: {
                external_verification_redirect_url:
                  "https://accounts.google.com/o/oauth2/auth",
                status: "unverified",
              },
              status: "needs_first_factor",
            },
          },
          "client-two",
        ),
      );
    const client = createCloudAccountClient(
      fetcher,
      {} as chrome.storage.StorageArea,
      webAuthFlow,
    );

    await expect(client.signInWithGoogle()).rejects.toThrow(
      "Google sign-in was canceled.",
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("reuses a live access token from background memory and refreshes near expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-26T12:00:00.000Z"));
    try {
      const values: Record<string, unknown> = {
        browserCaptureCloudSession: {
          authorization: "client-one",
          sessionId: "sess_normal",
        },
      };
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
      const first = jwtExpiringAt(Date.now() + 60_000);
      const second = jwtExpiringAt(Date.now() + 120_000);
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(clerkResponse({ jwt: first }, "client-two"))
        .mockResolvedValueOnce(clerkResponse({ jwt: second }, "client-three"));
      const client = createCloudAccountClient(
        fetcher,
        {} as chrome.storage.StorageArea,
      );

      await expect(client.accessToken()).resolves.toBe(first);
      await expect(client.accessToken()).resolves.toBe(first);
      expect(fetcher).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(55_001);
      await expect(client.accessToken()).resolves.toBe(second);
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
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

function jwtExpiringAt(epochMs: number): string {
  const payload = globalThis
    .btoa(JSON.stringify({ exp: Math.floor(epochMs / 1_000) }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  return `header.${payload}.signature`;
}
