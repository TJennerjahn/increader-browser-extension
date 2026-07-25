import { describe, expect, it, vi } from "vitest";
import {
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
      isSignedIn: vi.fn().mockResolvedValue(true),
      signIn,
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

  it("clears a destination whose normal session expired", async () => {
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
        accessToken: () => Promise.resolve("token"),
        isSignedIn: () => Promise.resolve(false),
        signIn: () => Promise.resolve("reader@example.com"),
        signOut: () => Promise.resolve(),
      }),
    );

    await expect(authentication.current()).resolves.toBeNull();
    expect(stored).toBeNull();
  });
});
