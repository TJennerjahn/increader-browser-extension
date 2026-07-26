import { normalizeInstanceOrigin } from "./instance-origin";

export const CLOUD_INSTANCE_ORIGIN = "https://app.increader.com";

export interface AuthenticatedDestination {
  displayName: string;
  email: string;
  origin: string;
}

export class AuthenticationExpiredError extends Error {
  constructor() {
    super("Your Increader session has expired.");
    this.name = AuthenticationExpiredError.name;
  }
}

export interface Authentication {
  current(): Promise<AuthenticatedDestination | null>;
  currentOrigin(): Promise<string | null>;
  signInWithGoogle(): Promise<AuthenticatedDestination>;
  signIn(
    candidate: string,
    email: string,
    password: string,
  ): Promise<AuthenticatedDestination>;
  accessToken(): Promise<string>;
  signOut(): Promise<void>;
}

export interface AuthenticationStore {
  load(): Promise<AuthenticatedDestination | null>;
  save(destination: AuthenticatedDestination): Promise<void>;
  clear(): Promise<void>;
}

export interface AccountClient {
  signInWithGoogle(): Promise<string>;
  signIn(email: string, password: string): Promise<string>;
  accessToken(): Promise<string>;
  signOut(): Promise<void>;
}

export type AccountClientFactory = (origin: string) => AccountClient;

export function createAuthentication(
  store: AuthenticationStore,
  accountAt: AccountClientFactory,
): Authentication {
  return {
    current: () => store.load(),

    async currentOrigin() {
      return (await store.load())?.origin ?? null;
    },

    async signIn(candidate, email, password) {
      const origin = normalizeInstanceOrigin(candidate);
      const normalizedEmail = email.trim();
      if (!normalizedEmail || !password) {
        throw new Error("Enter your email and password.");
      }
      const signedInEmail = await accountAt(origin).signIn(
        normalizedEmail,
        password,
      );
      const destination = {
        displayName: signedInEmail,
        email: signedInEmail,
        origin,
      };
      await store.save(destination);
      return destination;
    },

    async signInWithGoogle() {
      const signedInEmail = await accountAt(
        CLOUD_INSTANCE_ORIGIN,
      ).signInWithGoogle();
      const destination = {
        displayName: signedInEmail,
        email: signedInEmail,
        origin: CLOUD_INSTANCE_ORIGIN,
      };
      await store.save(destination);
      return destination;
    },

    async accessToken() {
      const destination = await store.load();
      if (destination === null) {
        throw new Error("Sign in to Increader first.");
      }
      try {
        return await accountAt(destination.origin).accessToken();
      } catch (error) {
        if (error instanceof AuthenticationExpiredError) {
          await store.clear();
        }
        throw error;
      }
    },

    async signOut() {
      const destination = await store.load();
      if (destination !== null) {
        await accountAt(destination.origin).signOut();
      }
      await store.clear();
    },
  };
}
