import type {
  AuthenticatedDestination,
  Authentication,
} from "../auth/authentication";
import { CLOUD_INSTANCE_ORIGIN } from "../auth/authentication";
import { normalizeInstanceOrigin } from "../auth/instance-origin";
import { runtimeOriginPermissionPattern } from "./runtime-origin-permission";

interface AuthenticationCommand {
  target: "authentication";
  command:
    | "current"
    | "current-origin"
    | "sign-in"
    | "sign-in-google"
    | "access-token"
    | "sign-out";
  origin?: string;
  email?: string;
  password?: string;
  retainAccountOnExpiry?: boolean;
}

interface AuthenticationResponse {
  ok: boolean;
  value?: unknown;
  message?: string;
}

interface PopupActionApi {
  openPopup(): Promise<void>;
}

export function createAuthenticationClient(
  runtime: typeof chrome.runtime = chrome.runtime,
  permissions: typeof chrome.permissions = chrome.permissions,
  promiseRuntime: PromiseRuntimeApi | undefined = firefoxRuntimeApi(runtime),
  promisePermissions: PromisePermissionsApi | undefined = firefoxPermissionsApi(
    runtime,
  ),
): Authentication {
  return {
    current: () =>
      command<AuthenticatedDestination | null>(runtime, promiseRuntime, {
        command: "current",
      }),
    currentOrigin: () =>
      command<string | null>(runtime, promiseRuntime, {
        command: "current-origin",
      }),
    async signIn(candidate, email, password) {
      const origin = normalizeInstanceOrigin(candidate);
      const patterns = [runtimeOriginPermissionPattern(origin, runtime)];
      if (origin === CLOUD_INSTANCE_ORIGIN) {
        patterns.push(
          runtimeOriginPermissionPattern(
            "https://clerk.increader.com",
            runtime,
          ),
        );
      }
      const granted =
        promisePermissions !== undefined
          ? await promisePermissions.request({ origins: patterns })
          : await callbackResult<boolean>((done) => {
              permissions.request({ origins: patterns }, done);
            });
      if (!granted) {
        throw new Error(
          "Permission to reach this Increader instance was not granted.",
        );
      }
      return command<AuthenticatedDestination>(runtime, promiseRuntime, {
        command: "sign-in",
        email,
        origin,
        password,
      });
    },
    async signInWithGoogle() {
      await requestOrigins(
        [
          runtimeOriginPermissionPattern(CLOUD_INSTANCE_ORIGIN, runtime),
          runtimeOriginPermissionPattern(
            "https://clerk.increader.com",
            runtime,
          ),
        ],
        permissions,
        promisePermissions,
      );
      return command<AuthenticatedDestination>(runtime, promiseRuntime, {
        command: "sign-in-google",
      });
    },
    accessToken: (options) =>
      command<string>(runtime, promiseRuntime, {
        command: "access-token",
        ...(options?.retainAccountOnExpiry === true
          ? { retainAccountOnExpiry: true }
          : {}),
      }),
    async signOut() {
      await command<unknown>(runtime, promiseRuntime, {
        command: "sign-out",
      });
    },
  };
}

export function registerAuthenticationRuntime(
  authentication: Authentication,
  runtime: typeof chrome.runtime = chrome.runtime,
  action: PopupActionApi = chrome.action,
  promiseAction: PopupActionApi | undefined = firefoxActionApi(runtime),
): () => void {
  const popupAction = promiseAction ?? action;
  const onMessage = (
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: AuthenticationResponse) => void,
  ): boolean => {
    if (!isAuthenticationCommand(message)) return false;
    void runCommand(authentication, message).then(
      (value) => {
        sendResponse({ ok: true, value });
        if (message.command === "sign-in-google") {
          void popupAction.openPopup().catch(() => undefined);
        }
      },
      (error: unknown) => {
        sendResponse({
          message:
            error instanceof Error
              ? error.message
              : "Increader could not complete authentication.",
          ok: false,
        });
      },
    );
    return true;
  };
  runtime.onMessage.addListener(onMessage);
  return () => {
    runtime.onMessage.removeListener(onMessage);
  };
}

function runCommand(
  authentication: Authentication,
  message: AuthenticationCommand,
): Promise<unknown> {
  switch (message.command) {
    case "current":
      return authentication.current();
    case "current-origin":
      return authentication.currentOrigin();
    case "access-token":
      return authentication.accessToken({
        retainAccountOnExpiry: message.retainAccountOnExpiry === true,
      });
    case "sign-out":
      return authentication.signOut();
    case "sign-in-google":
      return authentication.signInWithGoogle();
    case "sign-in":
      if (
        message.origin === undefined ||
        message.email === undefined ||
        message.password === undefined
      ) {
        return Promise.reject(new Error("Sign-in details are incomplete."));
      }
      return authentication.signIn(
        message.origin,
        message.email,
        message.password,
      );
  }
}

function command<T>(
  runtime: typeof chrome.runtime,
  promiseRuntime: PromiseRuntimeApi | undefined,
  commandValue: Omit<AuthenticationCommand, "target">,
): Promise<T> {
  const message = {
    ...commandValue,
    target: "authentication",
  } satisfies AuthenticationCommand;
  if (promiseRuntime !== undefined) {
    return promiseRuntime.sendMessage(message).then(unwrap) as Promise<T>;
  }
  return callbackResult<AuthenticationResponse | undefined>((done) => {
    runtime.sendMessage(message, done);
  }).then(unwrap) as Promise<T>;
}

function unwrap(response: AuthenticationResponse | undefined): unknown {
  if (response?.ok) return response.value;
  throw new Error(
    response?.message ?? "The Increader background service did not respond.",
  );
}

function isAuthenticationCommand(
  value: unknown,
): value is AuthenticationCommand {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.target === "authentication" &&
    (candidate.command === "current" ||
      candidate.command === "current-origin" ||
      candidate.command === "sign-in" ||
      candidate.command === "sign-in-google" ||
      candidate.command === "access-token" ||
      candidate.command === "sign-out")
  );
}

async function requestOrigins(
  origins: string[],
  permissions: typeof chrome.permissions,
  promisePermissions: PromisePermissionsApi | undefined,
): Promise<void> {
  const granted =
    promisePermissions !== undefined
      ? await promisePermissions.request({ origins })
      : await callbackResult<boolean>((done) => {
          permissions.request({ origins }, done);
        });
  if (!granted) {
    throw new Error("Permission to reach Increader Cloud was not granted.");
  }
}

interface PromisePermissionsApi {
  request(permissions: chrome.permissions.Permissions): Promise<boolean>;
}

interface PromiseRuntimeApi {
  sendMessage(message: unknown): Promise<AuthenticationResponse | undefined>;
}

function firefoxPermissionsApi(
  runtime: typeof chrome.runtime,
): PromisePermissionsApi | undefined {
  if (!runtime.getURL("").startsWith("moz-extension://")) return undefined;
  return (
    globalThis as typeof globalThis & {
      browser?: { permissions?: PromisePermissionsApi };
    }
  ).browser?.permissions;
}

function firefoxActionApi(
  runtime: typeof chrome.runtime,
): PopupActionApi | undefined {
  if (!runtime.getURL("").startsWith("moz-extension://")) return undefined;
  return (
    globalThis as typeof globalThis & {
      browser?: { action?: PopupActionApi };
    }
  ).browser?.action;
}

function firefoxRuntimeApi(
  runtime: typeof chrome.runtime,
): PromiseRuntimeApi | undefined {
  if (!runtime.getURL("").startsWith("moz-extension://")) return undefined;
  return (
    globalThis as typeof globalThis & {
      browser?: { runtime?: PromiseRuntimeApi };
    }
  ).browser?.runtime;
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
