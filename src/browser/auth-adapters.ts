import {
  CLOUD_INSTANCE_ORIGIN,
  type AccountClient,
  type AccountClientFactory,
  type AuthenticatedDestination,
  type AuthenticationStore,
} from "../auth/authentication";

const AUTHENTICATION_STORAGE_KEY = "browserCaptureAuthentication";
const CLOUD_SESSION_STORAGE_KEY = "browserCaptureCloudSession";
const SELF_HOSTED_COOKIE = "increader_auth";
const CLERK_ORIGIN = "https://clerk.increader.com";
const CLERK_CLIENT_COOKIE = "__client";

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
  tabs: typeof chrome.tabs = chrome.tabs,
): AccountClientFactory {
  const cloud = createCloudAccountClient(fetcher, storage, cookies, tabs);
  return (origin) =>
    origin === CLOUD_INSTANCE_ORIGIN
      ? cloud
      : createSelfHostedAccountClient(origin, fetcher, cookies);
}

export function createCloudAccountClient(
  fetcher: typeof fetch,
  storage: chrome.storage.StorageArea,
  cookies?: typeof chrome.cookies,
  tabs?: typeof chrome.tabs,
): AccountClient {
  const accessToken = async (): Promise<string> => {
    const session = await loadCloudSession(storage);
    if (session === null) {
      throw new Error("Your Increader session has expired.");
    }
    const token = await clerkRequest(
      fetcher,
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
      throw new Error("Your Increader session has expired.");
    }
    return value;
  };

  return {
    async signInWithGoogle() {
      if (cookies === undefined || tabs === undefined) {
        throw new Error("Google sign-in is unavailable in this browser.");
      }
      const previousClient = await cookieGet(
        cookies,
        CLERK_ORIGIN,
        CLERK_CLIENT_COOKIE,
      );
      const initialized = await clerkRequest(fetcher, "/v1/client", {
        method: "GET",
      });
      const signedIn = await clerkRequest(
        fetcher,
        "/v1/client/sign_ins",
        {
          body: new URLSearchParams({
            action_complete_redirect_url: `${CLOUD_INSTANCE_ORIGIN}/`,
            redirect_url: `${CLOUD_INSTANCE_ORIGIN}/sign-in`,
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

      const nextClient = waitForChangedCookie(
        cookies,
        CLERK_ORIGIN,
        CLERK_CLIENT_COOKIE,
        previousClient?.value,
      );
      await tabCreate(tabs, redirectUrl);
      const clientCookie = await nextClient;
      const adopted = await clerkRequest(
        fetcher,
        "/v1/client",
        { method: "GET" },
        clientCookie.value,
      );
      const account = activeCloudAccount(adopted.body);
      await saveCloudSession(storage, {
        authorization: adopted.authorization,
        sessionId: account.sessionId,
      });
      return account.email;
    },
    async signIn(email, password) {
      const initialized = await clerkRequest(fetcher, "/v1/client", {
        method: "GET",
      });
      const signedIn = await clerkRequest(
        fetcher,
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
    async isSignedIn() {
      try {
        await accessToken();
        return true;
      } catch {
        await storageRemove(storage, CLOUD_SESSION_STORAGE_KEY);
        return false;
      }
    },
    async signOut() {
      const session = await loadCloudSession(storage);
      if (session !== null) {
        await clerkRequest(
          fetcher,
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
  if (authorization !== undefined) {
    endpoint.searchParams.set("_is_native", "1");
  }
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
  const nextAuthorization = responseAuthorization?.startsWith("Bearer ")
    ? responseAuthorization.slice("Bearer ".length)
    : responseAuthorization;
  if (nextAuthorization === null || nextAuthorization.length === 0) {
    throw new Error("Increader authentication returned an invalid session.");
  }
  return { authorization: nextAuthorization, body };
}

function clerkFailure(body: unknown, status: number): Error {
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
        if (response.status === 401) {
          throw new Error("Invalid email or password.");
        }
        if (response.status === 429) {
          throw new Error("Too many attempts. Try again in a moment.");
        }
        throw new Error("The Increader instance could not sign you in.");
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
    async isSignedIn() {
      return (await cookieGet(cookies, origin, SELF_HOSTED_COOKIE)) !== null;
    },
    async signOut() {
      await fetcher(new URL("/api/auth/logout", `${origin}/`).toString(), {
        credentials: "include",
        method: "POST",
        redirect: "error",
      });
    },
  };
}

function activeCloudAccount(body: unknown): {
  email: string;
  sessionId: string;
} {
  const client = objectProperty(body, "response");
  const sessions = arrayProperty(client, "sessions");
  const activeSessionId = stringProperty(client, "last_active_session_id");
  const session =
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
      "Finish Google sign-in in the opened tab, then open Browser Capture again.",
    );
  }
  return { email, sessionId };
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

function waitForChangedCookie(
  cookies: typeof chrome.cookies,
  origin: string,
  name: string,
  previousValue?: string,
): Promise<chrome.cookies.Cookie> {
  const hostname = new URL(origin).hostname;
  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(
      () => {
        cookies.onChanged.removeListener(onChanged);
        reject(
          new Error(
            "Google sign-in timed out. Finish it and open Browser Capture again.",
          ),
        );
      },
      5 * 60 * 1000,
    );
    const onChanged = (change: chrome.cookies.CookieChangeInfo): void => {
      const domain = change.cookie.domain.replace(/^\./, "");
      if (
        change.removed ||
        change.cookie.name !== name ||
        domain !== hostname ||
        change.cookie.value === previousValue
      ) {
        return;
      }
      globalThis.clearTimeout(timeout);
      cookies.onChanged.removeListener(onChanged);
      resolve(change.cookie);
    };
    cookies.onChanged.addListener(onChanged);
  });
}

function tabCreate(tabs: typeof chrome.tabs, url: string): Promise<void> {
  const promiseTabs = firefoxTabsApi();
  if (promiseTabs !== undefined) {
    return promiseTabs.create({ active: true, url }).then(() => undefined);
  }
  return callbackVoid((done) => {
    tabs.create({ active: true, url }, () => {
      done();
    });
  });
}

async function requireSelfHostedToken(
  origin: string,
  cookies: typeof chrome.cookies,
): Promise<string> {
  const cookie = await cookieGet(cookies, origin, SELF_HOSTED_COOKIE);
  if (cookie === null || cookie.value.length === 0) {
    throw new Error("Your Increader session has expired.");
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

interface PromiseTabsApi {
  create(properties: chrome.tabs.CreateProperties): Promise<chrome.tabs.Tab>;
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

function firefoxTabsApi(): PromiseTabsApi | undefined {
  return (
    globalThis as typeof globalThis & {
      browser?: { tabs?: PromiseTabsApi };
    }
  ).browser?.tabs;
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
