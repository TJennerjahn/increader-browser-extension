import {
  AuthenticationExpiredError,
  CLOUD_INSTANCE_ORIGIN,
  type AccountClient,
  type AccountClientFactory,
  type AuthenticatedDestination,
  type AuthenticationStore,
} from "../auth/authentication";
import { createClerkNativeTransport } from "./clerk-native-transport";
import {
  createOAuthWebAuthFlow,
  type OAuthWebAuthFlow,
} from "./oauth-web-auth-flow";

const AUTHENTICATION_STORAGE_KEY = "browserCaptureAuthentication";
const CLOUD_SESSION_STORAGE_KEY = "browserCaptureCloudSession";
const SELF_HOSTED_COOKIE = "increader_auth";
const CLERK_ORIGIN = "https://clerk.increader.com";
const ACCESS_TOKEN_EXPIRY_SKEW_MS = 5_000;
const NATIVE_OAUTH_TRANSFER_CODES = new Set([
  "external_account_exists",
  "external_account_not_found",
]);

export function createAuthenticationStore(
  storage: chrome.storage.StorageArea = chrome.storage.local,
): AuthenticationStore {
  return {
    async load() {
      const values = await storageGet(storage, AUTHENTICATION_STORAGE_KEY);
      const value = values[AUTHENTICATION_STORAGE_KEY];
      if (
        value === null ||
        typeof value !== "object" ||
        !hasStrings(value, ["displayName", "email", "origin"])
      ) {
        return null;
      }
      const destination = value as Record<string, unknown>;
      return {
        displayName: destination.displayName as string,
        email: destination.email as string,
        origin: destination.origin as string,
      } satisfies AuthenticatedDestination;
    },
    save(destination) {
      return storageSet(storage, {
        [AUTHENTICATION_STORAGE_KEY]: destination,
      });
    },
    clear() {
      return storageRemove(storage, AUTHENTICATION_STORAGE_KEY);
    },
  };
}

export function createAccountClientFactory(
  fetcher: typeof fetch = globalThis.fetch,
  cookies: typeof chrome.cookies = chrome.cookies,
  storage: chrome.storage.StorageArea = chrome.storage.local,
  webAuthFlow: OAuthWebAuthFlow = createOAuthWebAuthFlow(),
  declarativeNetRequest: typeof chrome.declarativeNetRequest = chrome.declarativeNetRequest,
): AccountClientFactory {
  const cloud = createCloudAccountClient(
    fetcher,
    storage,
    webAuthFlow,
    createClerkNativeTransport(declarativeNetRequest),
  );
  return (origin) =>
    origin === CLOUD_INSTANCE_ORIGIN
      ? cloud
      : createSelfHostedAccountClient(origin, fetcher, cookies);
}

export function createCloudAccountClient(
  fetcher: typeof fetch,
  storage: chrome.storage.StorageArea,
  webAuthFlow?: OAuthWebAuthFlow,
  prepareNativeTransport: () => Promise<void> = () => Promise.resolve(),
): AccountClient {
  let tokenGeneration = 0;
  let cachedAccessToken: CachedAccessToken | null = null;
  let pendingAccessToken: PendingAccessToken | null = null;
  const invalidateAccessToken = (): void => {
    tokenGeneration += 1;
    cachedAccessToken = null;
    pendingAccessToken = null;
  };
  const request = async (
    path: string,
    init: RequestInit,
    authorization?: string,
  ): Promise<{ authorization: string; body: unknown }> => {
    await prepareNativeTransport();
    return clerkRequest(fetcher, path, init, authorization);
  };
  const issueAccessToken = async (): Promise<string> => {
    const session = await loadCloudSession(storage);
    if (session === null) {
      throw new AuthenticationExpiredError();
    }
    const token = await request(
      `/v1/client/sessions/${encodeURIComponent(session.sessionId)}/tokens`,
      {
        body: new URLSearchParams(),
        method: "POST",
      },
      session.authorization,
    );
    await saveCloudSession(storage, {
      ...session,
      authorization: token.authorization,
    });
    const value =
      stringProperty(token.body, "jwt") ??
      stringProperty(objectProperty(token.body, "response"), "jwt");
    if (value === null) {
      throw new AuthenticationExpiredError();
    }
    return value;
  };
  const accessToken = (): Promise<string> => {
    if (
      cachedAccessToken !== null &&
      cachedAccessToken.expiresAtEpochMs - ACCESS_TOKEN_EXPIRY_SKEW_MS >
        Date.now()
    ) {
      return Promise.resolve(cachedAccessToken.value);
    }
    const generation = tokenGeneration;
    if (pendingAccessToken?.generation === generation) {
      return pendingAccessToken.promise;
    }
    const promise = issueAccessToken()
      .then((value) => {
        const expiresAtEpochMs = jwtExpiresAtEpochMs(value);
        if (
          generation === tokenGeneration &&
          expiresAtEpochMs !== null &&
          expiresAtEpochMs - ACCESS_TOKEN_EXPIRY_SKEW_MS > Date.now()
        ) {
          cachedAccessToken = { expiresAtEpochMs, value };
        }
        return value;
      })
      .finally(() => {
        if (pendingAccessToken?.promise === promise) {
          pendingAccessToken = null;
        }
      });
    pendingAccessToken = { generation, promise };
    return promise;
  };

  return {
    async signInWithGoogle() {
      invalidateAccessToken();
      if (webAuthFlow === undefined) {
        throw new Error("Google sign-in is unavailable in this browser.");
      }
      const callbackUrl = webAuthFlow.getRedirectUrl();
      const initialized = await request("/v1/client", {
        method: "GET",
      });
      const signedIn = await request(
        "/v1/client/sign_ins",
        {
          body: new URLSearchParams({
            redirect_url: callbackUrl,
            strategy: "oauth_google",
          }),
          method: "POST",
        },
        initialized.authorization,
      );
      const attempt = objectProperty(signedIn.body, "response");
      const verification =
        objectProperty(attempt, "first_factor_verification") ??
        objectProperty(attempt, "verification");
      const redirectUrl = stringProperty(
        verification,
        "external_verification_redirect_url",
      );
      if (redirectUrl === null) {
        throw new Error("Increader Cloud could not start Google sign-in.");
      }
      const signInId = stringProperty(attempt, "id");
      if (signInId === null) {
        throw new Error("Increader Cloud returned an invalid Google sign-in.");
      }

      const returnedCallbackUrl = await webAuthFlow.launch(redirectUrl);
      const callback = parseOAuthCallback(returnedCallbackUrl);
      const completedSignIn = await request(
        clerkSignInReloadPath(signInId, callback.rotatingTokenNonce),
        { method: "GET" },
        signedIn.authorization,
      );
      const signIn = objectProperty(completedSignIn.body, "response");
      const firstFactor =
        objectProperty(signIn, "first_factor_verification") ??
        objectProperty(signIn, "verification");
      const completion =
        stringProperty(signIn, "status") === "complete"
          ? completedSignIn
          : stringProperty(firstFactor, "status") === "transferable"
            ? await request(
                "/v1/client/sign_ups",
                {
                  body: new URLSearchParams({ transfer: "true" }),
                  method: "POST",
                },
                completedSignIn.authorization,
              )
            : null;
      if (completion === null) {
        throw new Error(
          "Increader Cloud could not complete this Google sign-in.",
        );
      }
      const completedAttempt = objectProperty(completion.body, "response");
      const sessionId = stringProperty(completedAttempt, "created_session_id");
      if (
        stringProperty(completedAttempt, "status") !== "complete" ||
        sessionId === null
      ) {
        throw new Error(
          "Increader Cloud needs more information to finish this Google account.",
        );
      }
      const account = activeCloudAccount(completion.body, sessionId);
      await saveCloudSession(storage, {
        authorization: completion.authorization,
        sessionId,
      });
      return account.email;
    },
    async signIn(email, password) {
      invalidateAccessToken();
      const initialized = await request("/v1/client", {
        method: "GET",
      });
      const signedIn = await request(
        "/v1/client/sign_ins",
        {
          body: new URLSearchParams({ identifier: email, password }),
          method: "POST",
        },
        initialized.authorization,
      );
      const attempt = objectProperty(signedIn.body, "response");
      const status = stringProperty(attempt, "status");
      if (status === "needs_second_factor") {
        throw new Error(
          "This account requires a second verification step, which the extension does not support yet.",
        );
      }
      const sessionId = stringProperty(attempt, "created_session_id");
      if (status !== "complete" || sessionId === null) {
        throw new Error("We could not sign you in with those details.");
      }
      await saveCloudSession(storage, {
        authorization: signedIn.authorization,
        sessionId,
      });
      return email;
    },
    accessToken,
    async signOut() {
      invalidateAccessToken();
      const session = await loadCloudSession(storage);
      if (session !== null) {
        await request(
          `/v1/client/sessions/${encodeURIComponent(session.sessionId)}/remove`,
          {
            body: new URLSearchParams(),
            method: "POST",
          },
          session.authorization,
        ).catch(() => undefined);
      }
      await storageRemove(storage, CLOUD_SESSION_STORAGE_KEY);
    },
  };
}

interface CloudSession {
  authorization: string;
  sessionId: string;
}

interface CachedAccessToken {
  expiresAtEpochMs: number;
  value: string;
}

interface PendingAccessToken {
  generation: number;
  promise: Promise<string>;
}

function jwtExpiresAtEpochMs(value: string): number | null {
  const payload = value.split(".")[1];
  if (payload === undefined || payload.length === 0) return null;
  try {
    const base64 = payload.replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const parsed: unknown = JSON.parse(globalThis.atob(padded));
    if (parsed === null || typeof parsed !== "object") return null;
    const exp = (parsed as Record<string, unknown>).exp;
    return typeof exp === "number" && Number.isFinite(exp) && exp > 0
      ? exp * 1_000
      : null;
  } catch {
    return null;
  }
}

async function loadCloudSession(
  storage: chrome.storage.StorageArea,
): Promise<CloudSession | null> {
  const values = await storageGet(storage, CLOUD_SESSION_STORAGE_KEY);
  const value = values[CLOUD_SESSION_STORAGE_KEY];
  if (
    value === null ||
    typeof value !== "object" ||
    !hasStrings(value, ["authorization", "sessionId"])
  ) {
    return null;
  }
  const session = value as Record<string, unknown>;
  return {
    authorization: session.authorization as string,
    sessionId: session.sessionId as string,
  };
}

function saveCloudSession(
  storage: chrome.storage.StorageArea,
  session: CloudSession,
): Promise<void> {
  return storageSet(storage, { [CLOUD_SESSION_STORAGE_KEY]: session });
}

async function clerkRequest(
  fetcher: typeof fetch,
  path: string,
  init: RequestInit,
  authorization?: string,
): Promise<{ authorization: string; body: unknown }> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body instanceof URLSearchParams) {
    headers.set("Content-Type", "application/x-www-form-urlencoded");
  }
  if (authorization !== undefined) {
    headers.set("Authorization", `Bearer ${authorization}`);
  }
  const endpoint = new URL(path, CLERK_ORIGIN);
  endpoint.searchParams.set("_is_native", "1");
  const response = await fetcher(endpoint.toString(), {
    ...init,
    credentials: "omit",
    headers,
    redirect: "error",
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw clerkFailure(body, response.status);
  }
  const responseAuthorization = response.headers.get("Authorization");
  const nextAuthorization =
    responseAuthorization === null || responseAuthorization.length === 0
      ? authorization
      : responseAuthorization.startsWith("Bearer ")
        ? responseAuthorization.slice("Bearer ".length)
        : responseAuthorization;
  if (nextAuthorization === undefined || nextAuthorization.length === 0) {
    throw new Error("Increader authentication returned an invalid session.");
  }
  return { authorization: nextAuthorization, body };
}

function clerkFailure(body: unknown, status: number): Error {
  if (status === 401 || status === 404) {
    return new AuthenticationExpiredError();
  }
  const errors =
    body !== null && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).errors
      : null;
  if (Array.isArray(errors)) {
    for (const error of errors) {
      const code = stringProperty(error, "code");
      if (
        code === "form_identifier_not_found" ||
        code === "form_password_incorrect"
      ) {
        return new Error("Invalid email or password.");
      }
    }
  }
  if (status === 429) {
    return new Error("Too many attempts. Try again in a moment.");
  }
  return new Error("Increader Cloud could not sign you in.");
}

function objectProperty(
  value: unknown,
  property: string,
): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const propertyValue = (value as Record<string, unknown>)[property];
  return propertyValue !== null &&
    typeof propertyValue === "object" &&
    !Array.isArray(propertyValue)
    ? (propertyValue as Record<string, unknown>)
    : null;
}

function stringProperty(value: unknown, property: string): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const propertyValue = (value as Record<string, unknown>)[property];
  return typeof propertyValue === "string" ? propertyValue : null;
}

export function createSelfHostedAccountClient(
  origin: string,
  fetcher: typeof fetch,
  cookies: typeof chrome.cookies,
): AccountClient {
  return {
    signInWithGoogle() {
      return Promise.reject(
        new Error("Google sign-in is available only for Increader Cloud."),
      );
    },
    async signIn(email, password) {
      const response = await fetcher(
        new URL("/api/auth/login", `${origin}/`).toString(),
        {
          body: JSON.stringify({ email, password }),
          credentials: "include",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          method: "POST",
          redirect: "error",
        },
      );
      if (!response.ok) {
        throw await selfHostedSignInFailure(response);
      }
      const value: unknown = await response.json();
      if (
        value === null ||
        typeof value !== "object" ||
        typeof (value as Record<string, unknown>).user !== "object" ||
        (value as Record<string, unknown>).user === null
      ) {
        throw new Error("The Increader instance returned an invalid session.");
      }
      const user = (value as { user: Record<string, unknown> }).user;
      if (typeof user.email !== "string" || user.email.length === 0) {
        throw new Error("The Increader instance returned an invalid session.");
      }
      await requireSelfHostedToken(origin, cookies);
      return user.email;
    },
    accessToken: () => requireSelfHostedToken(origin, cookies),
    async signOut() {
      await fetcher(new URL("/api/auth/logout", `${origin}/`).toString(), {
        credentials: "include",
        method: "POST",
        redirect: "error",
      });
    },
  };
}

async function selfHostedSignInFailure(response: Response): Promise<Error> {
  if (response.status === 401) {
    return new Error("Invalid email or password.");
  }
  if (response.status === 429) {
    return new Error("Too many attempts. Please wait a moment and try again.");
  }

  let message = `Request failed: ${String(response.status)}`;
  const contentType = response.headers.get("Content-Type") ?? "";
  try {
    if (
      contentType.includes("application/json") ||
      contentType.includes("application/problem+json")
    ) {
      const body: unknown = await response.json();
      message =
        stringProperty(body, "detail") ??
        stringProperty(body, "message") ??
        message;
    } else {
      const body = await response.text();
      if (body.length > 0) message = body;
    }
  } catch {
    // Match the normal client by falling back to the HTTP status.
  }
  return new Error(message);
}

function activeCloudAccount(
  body: unknown,
  preferredSessionId?: string,
): {
  email: string;
  sessionId: string;
} {
  const response = objectProperty(body, "response");
  const client = objectProperty(body, "client") ?? response;
  const sessions = arrayProperty(client, "sessions");
  const activeSessionId = stringProperty(client, "last_active_session_id");
  const session =
    sessions
      .map(recordValue)
      .find(
        (candidate) =>
          stringProperty(candidate, "id") === preferredSessionId,
      ) ??
    sessions
      .map(recordValue)
      .find(
        (candidate) => stringProperty(candidate, "id") === activeSessionId,
      ) ??
    sessions.map(recordValue).find((candidate) => candidate !== null) ??
    null;
  const sessionId = stringProperty(session, "id");
  const user = objectProperty(session, "user");
  const emailAddresses = arrayProperty(user, "email_addresses")
    .map(recordValue)
    .filter((value): value is Record<string, unknown> => value !== null);
  const primaryEmailAddressId = stringProperty(
    user,
    "primary_email_address_id",
  );
  const primaryEmail =
    emailAddresses.find(
      (address) => stringProperty(address, "id") === primaryEmailAddressId,
    ) ?? emailAddresses[0];
  const email = stringProperty(primaryEmail, "email_address");
  if (sessionId === null || email === null) {
    throw new Error(
      "Increader Cloud returned an incomplete Google account session.",
    );
  }
  return { email, sessionId };
}

function parseOAuthCallback(value: string): {
  rotatingTokenNonce?: string;
} {
  let callback: URL;
  try {
    callback = new URL(value);
  } catch {
    throw new Error("Increader Cloud returned an invalid Google callback.");
  }
  if (callback.searchParams.get("__clerk_status") === "failed") {
    const code =
      callback.searchParams.get("__clerk_error_code") ??
      "oauth_callback_failed";
    if (!NATIVE_OAUTH_TRANSFER_CODES.has(code)) {
      throw new Error(
        code === "oauth_access_denied"
          ? "Google sign-in was canceled."
          : "Increader Cloud could not complete Google sign-in.",
      );
    }
  }
  const rotatingTokenNonce = callback.searchParams.get("rotating_token_nonce");
  return rotatingTokenNonce === null ? {} : { rotatingTokenNonce };
}

function clerkSignInReloadPath(
  signInId: string,
  rotatingTokenNonce?: string,
): string {
  const endpoint = new URL(
    `/v1/client/sign_ins/${encodeURIComponent(signInId)}`,
    CLERK_ORIGIN,
  );
  if (rotatingTokenNonce !== undefined) {
    endpoint.searchParams.set("rotating_token_nonce", rotatingTokenNonce);
  }
  return `${endpoint.pathname}${endpoint.search}`;
}

function arrayProperty(value: unknown, property: string): unknown[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const propertyValue = (value as Record<string, unknown>)[property];
  return Array.isArray(propertyValue) ? propertyValue : [];
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function requireSelfHostedToken(
  origin: string,
  cookies: typeof chrome.cookies,
): Promise<string> {
  const cookie = await cookieGet(cookies, origin, SELF_HOSTED_COOKIE);
  if (cookie === null || cookie.value.length === 0) {
    throw new AuthenticationExpiredError();
  }
  return cookie.value;
}

function cookieGet(
  cookies: typeof chrome.cookies,
  origin: string,
  name: string,
): Promise<chrome.cookies.Cookie | null> {
  const details = { name, url: `${origin}/` };
  const promiseCookies = firefoxCookiesApi();
  if (promiseCookies !== undefined) return promiseCookies.get(details);
  return callbackResult((done) => {
    cookies.get(details, done);
  });
}

function storageGet(
  storage: chrome.storage.StorageArea,
  key: string,
): Promise<Record<string, unknown>> {
  const promiseStorage = firefoxStorageArea();
  if (promiseStorage !== undefined) return promiseStorage.get(key);
  return callbackResult((done) => {
    storage.get(key, done);
  });
}

function storageSet(
  storage: chrome.storage.StorageArea,
  values: Record<string, unknown>,
): Promise<void> {
  const promiseStorage = firefoxStorageArea();
  if (promiseStorage !== undefined) return promiseStorage.set(values);
  return callbackVoid((done) => {
    storage.set(values, done);
  });
}

function storageRemove(
  storage: chrome.storage.StorageArea,
  key: string,
): Promise<void> {
  const promiseStorage = firefoxStorageArea();
  if (promiseStorage !== undefined) return promiseStorage.remove(key);
  return callbackVoid((done) => {
    storage.remove(key, done);
  });
}

interface PromiseCookiesApi {
  get(
    details: chrome.cookies.CookieDetails,
  ): Promise<chrome.cookies.Cookie | null>;
}

interface PromiseStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  remove(key: string): Promise<void>;
  set(values: Record<string, unknown>): Promise<void>;
}

function firefoxCookiesApi(): PromiseCookiesApi | undefined {
  return (
    globalThis as typeof globalThis & {
      browser?: { cookies?: PromiseCookiesApi };
    }
  ).browser?.cookies;
}

function firefoxStorageArea(): PromiseStorageArea | undefined {
  return (
    globalThis as typeof globalThis & {
      browser?: { storage?: { local?: PromiseStorageArea } };
    }
  ).browser?.storage?.local;
}

function hasStrings<T extends object>(
  candidate: T,
  keys: string[],
): candidate is T & Record<string, string> {
  const values = candidate as Record<string, unknown>;
  return keys.every((key) => typeof values[key] === "string");
}

function callbackResult<T>(
  invoke: (done: (value: T) => void) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    invoke((value) => {
      const error = chrome.runtime.lastError;
      if (error === undefined) resolve(value);
      else reject(new Error(error.message));
    });
  });
}

function callbackVoid(invoke: (done: () => void) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    invoke(() => {
      const error = chrome.runtime.lastError;
      if (error === undefined) resolve();
      else reject(new Error(error.message));
    });
  });
}
