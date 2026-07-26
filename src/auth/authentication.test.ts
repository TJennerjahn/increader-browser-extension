import { describe, expect, it, vi } from "vitest";
import {
  AuthenticationExpiredError,
  createAuthentication,
  type AccountClient,
  type AuthenticatedDestination,
  type AuthenticationStore,
} from "./authentication";

describe("normal Increader authentication", () => {
  it("stores the authenticated account and delegates token access", async () => {
    let stored: AuthenticatedDestination | null = null;
    const signIn = vi.fn().mockResolvedValue("reader@example.com");
    const account: AccountClient = {
      accessToken: vi.fn().mockResolvedValue("normal-user-token"),
      signIn,
      signInWithGoogle: vi.fn().mockResolvedValue("reader@example.com"),
      signOut: vi.fn().mockResolvedValue(undefined),
    };
    const authentication = createAuthentication(store(), () => account);

    await expect(
      authentication.signIn(
        "https://reader.example/",
        " reader@example.com ",
        "secret",
      ),
    ).resolves.toEqual({
      displayName: "reader@example.com",
      email: "reader@example.com",
      origin: "https://reader.example",
    });
    await expect(authentication.accessToken()).resolves.toBe(
      "normal-user-token",
    );
    expect(signIn).toHaveBeenCalledWith("reader@example.com", "secret");

    function store(): AuthenticationStore {
      return {
        clear: () => {
          stored = null;
          return Promise.resolve();
        },
        load: () => Promise.resolve(stored),
        save: (value) => {
          stored = value;
          return Promise.resolve();
        },
      };
    }
  });

  it("returns the stored destination without validating its session", async () => {
    let stored: AuthenticatedDestination | null = {
      displayName: "Reader",
      email: "reader@example.com",
      origin: "https://reader.example",
    };
    const accountAt = vi.fn();
    const authentication = createAuthentication(
      {
        clear: () => {
          stored = null;
          return Promise.resolve();
        },
        load: () => Promise.resolve(stored),
        save: (value) => {
          stored = value;
          return Promise.resolve();
        },
      },
      accountAt,
    );

    await expect(authentication.current()).resolves.toEqual(stored);
    expect(accountAt).not.toHaveBeenCalled();
  });

  it("forgets an account when token access proves its session expired", async () => {
    let stored: AuthenticatedDestination | null = {
      displayName: "Reader",
      email: "reader@example.com",
      origin: "https://reader.example",
    };
    const authentication = createAuthentication(
      {
        clear: () => {
          stored = null;
          return Promise.resolve();
        },
        load: () => Promise.resolve(stored),
        save: (value) => {
          stored = value;
          return Promise.resolve();
        },
      },
      () => ({
        accessToken: () => Promise.reject(new AuthenticationExpiredError()),
        signIn: () => Promise.resolve("reader@example.com"),
        signInWithGoogle: () => Promise.resolve("reader@example.com"),
        signOut: () => Promise.resolve(),
      }),
    );

    await expect(authentication.accessToken()).rejects.toThrow(
      "Your Increader session has expired.",
    );
    expect(stored).toBeNull();
  });

  it("retains an account when passive token access finds an expired session", async () => {
    const stored: AuthenticatedDestination = {
      displayName: "Reader",
      email: "reader@example.com",
      origin: "https://reader.example",
    };
    const clear = vi.fn().mockResolvedValue(undefined);
    const authentication = createAuthentication(
      {
        clear,
        load: () => Promise.resolve(stored),
        save: () => Promise.resolve(),
      },
      () => ({
        accessToken: () => Promise.reject(new AuthenticationExpiredError()),
        signIn: () => Promise.resolve("reader@example.com"),
        signInWithGoogle: () => Promise.resolve("reader@example.com"),
        signOut: () => Promise.resolve(),
      }),
    );

    await expect(
      authentication.accessToken({ retainAccountOnExpiry: true }),
    ).rejects.toThrow("Your Increader session has expired.");
    expect(clear).not.toHaveBeenCalled();
  });

  it("stores a normal Cloud account after Google sign-in", async () => {
    let stored: AuthenticatedDestination | null = null;
    const signInWithGoogle = vi
      .fn()
      .mockResolvedValue("google-reader@example.com");
    const authentication = createAuthentication(
      {
        clear: () => Promise.resolve(),
        load: () => Promise.resolve(stored),
        save: (value) => {
          stored = value;
          return Promise.resolve();
        },
      },
      () => ({
        accessToken: () => Promise.resolve("token"),
        signIn: () => Promise.resolve("reader@example.com"),
        signInWithGoogle,
        signOut: () => Promise.resolve(),
      }),
    );

    await expect(authentication.signInWithGoogle()).resolves.toEqual({
      displayName: "google-reader@example.com",
      email: "google-reader@example.com",
      origin: "https://app.increader.com",
    });
    expect(signInWithGoogle).toHaveBeenCalledOnce();
    expect(stored).toEqual({
      displayName: "google-reader@example.com",
      email: "google-reader@example.com",
      origin: "https://app.increader.com",
    });
  });
});
