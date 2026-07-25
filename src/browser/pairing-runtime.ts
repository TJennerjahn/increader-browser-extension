import type {
  DiscoveredDestination,
  PairedDestination,
  Pairing,
} from "../pairing/pairing";
import { normalizeInstanceOrigin } from "../pairing/instance-origin";
import { runtimeOriginPermissionPattern } from "./runtime-origin-permission";

export type PairingOperationState =
  | { phase: "idle" }
  | { phase: "waiting-permission"; origin: string }
  | { phase: "connecting"; origin: string }
  | { phase: "failed"; origin: string; message: string };

export interface PairingOperationStore {
  load(): Promise<PairingOperationState>;
  save(state: PairingOperationState): Promise<void>;
}

export interface PairingClient extends Pairing {
  operation(): Promise<PairingOperationState>;
  observe(listener: (state: PairingOperationState) => void): () => void;
}

interface PairingRuntimeCommand {
  target: "pairing";
  command:
    | "prepare"
    | "resume"
    | "decline"
    | "current"
    | "current-origin"
    | "discover"
    | "access-token"
    | "disconnect"
    | "operation";
  origin?: string;
}

interface PairingRuntimeResponse {
  ok: boolean;
  value?: unknown;
  message?: string;
}

interface PairingStateMessage {
  target: "pairing-state";
  state: PairingOperationState;
}

interface PairingClientDependencies {
  runtime?: typeof chrome.runtime;
  permissions?: typeof chrome.permissions;
  promisePermissions?: PromisePermissionsApi;
  promiseRuntime?: PromiseRuntimeApi;
}

interface PairingRuntimeDependencies {
  operationStore: PairingOperationStore;
  runtime?: typeof chrome.runtime;
  permissions?: typeof chrome.permissions;
  promiseRuntime?: PromiseRuntimeApi;
}

export function createPairingClient({
  runtime = chrome.runtime,
  permissions = chrome.permissions,
  promisePermissions = firefoxPermissionsApi(runtime),
  promiseRuntime = firefoxRuntimeApi(runtime),
}: PairingClientDependencies = {}): PairingClient {
  return {
    current: () =>
      command<PairedDestination | null>(runtime, promiseRuntime, {
        command: "current",
      }),
    currentOrigin: () =>
      command<string | null>(runtime, promiseRuntime, {
        command: "current-origin",
      }),
    discover: (origin) =>
      command<DiscoveredDestination>(runtime, promiseRuntime, {
        command: "discover",
        origin,
      }),
    connect(candidate) {
      const origin = normalizeInstanceOrigin(candidate);
      runtime.sendMessage(
        {
          target: "pairing",
          command: "prepare",
          origin,
        } satisfies PairingRuntimeCommand,
        () => {
          void runtime.lastError;
        },
      );
      return new Promise<PairedDestination>((resolve, reject) => {
        const permissionPattern = runtimeOriginPermissionPattern(
          origin,
          runtime,
        );
        requestOriginPermission(
          permissions,
          promisePermissions,
          permissionPattern,
          runtime,
        ).then((granted) => {
          if (!granted) {
            void command(runtime, promiseRuntime, {
              command: "decline",
              origin,
            }).catch(() => undefined);
            reject(
              new Error(
                "Permission to reach this Increader instance was not granted.",
              ),
            );
            return;
          }
          void command<PairedDestination>(runtime, promiseRuntime, {
            command: "resume",
            origin,
          }).then(resolve, reject);
        }, reject);
      });
    },
    accessToken: () =>
      command<string>(runtime, promiseRuntime, { command: "access-token" }),
    disconnect: () =>
      command<undefined>(runtime, promiseRuntime, { command: "disconnect" }),
    operation: () =>
      command<PairingOperationState>(runtime, promiseRuntime, {
        command: "operation",
      }),
    observe(listener) {
      const onMessage = (message: unknown): boolean => {
        if (isPairingStateMessage(message)) listener(message.state);
        return false;
      };
      runtime.onMessage.addListener(onMessage);
      return () => {
        runtime.onMessage.removeListener(onMessage);
      };
    },
  };
}

interface PromisePermissionsApi {
  contains(permissions: chrome.permissions.Permissions): Promise<boolean>;
  request(permissions: chrome.permissions.Permissions): Promise<boolean>;
}

interface PromiseRuntimeApi {
  sendMessage(message: unknown): Promise<PairingRuntimeResponse | undefined>;
}

function firefoxRuntimeApi(
  runtime: typeof chrome.runtime,
): PromiseRuntimeApi | undefined {
  const runtimeWithOptionalUrl = runtime as {
    getURL?: (path: string) => string;
  };
  if (
    runtimeWithOptionalUrl.getURL?.("").startsWith("moz-extension://") !== true
  ) {
    return undefined;
  }
  return (
    globalThis as typeof globalThis & {
      browser?: { runtime?: PromiseRuntimeApi };
    }
  ).browser?.runtime;
}

function firefoxPermissionsApi(
  runtime: typeof chrome.runtime,
): PromisePermissionsApi | undefined {
  const runtimeWithOptionalUrl = runtime as {
    getURL?: (path: string) => string;
  };
  if (
    runtimeWithOptionalUrl.getURL?.("").startsWith("moz-extension://") !== true
  ) {
    return undefined;
  }
  return (
    globalThis as typeof globalThis & {
      browser?: { permissions?: PromisePermissionsApi };
    }
  ).browser?.permissions;
}

function requestOriginPermission(
  permissions: typeof chrome.permissions,
  promisePermissions: PromisePermissionsApi | undefined,
  pattern: string,
  runtime: typeof chrome.runtime,
): Promise<boolean> {
  const requested =
    promisePermissions !== undefined
      ? promisePermissions.request({ origins: [pattern] })
      : new Promise<boolean>((resolve, reject) => {
          permissions.request({ origins: [pattern] }, (granted) => {
            const runtimeError = runtime.lastError;
            if (runtimeError === undefined) {
              resolve(granted);
            } else {
              reject(new Error(runtimeError.message));
            }
          });
        });
  if (promisePermissions === undefined) return requested;

  // Firefox can grant the native host prompt before resolving request() or
  // delivering permissions.onAdded to the background page. Observe the
  // authoritative permission state as a bounded handoff; the request Promise
  // remains responsible for an explicit denial or a slower user decision.
  return Promise.race([
    requested,
    waitForGrantedPermission(promisePermissions, pattern),
  ]);
}

async function waitForGrantedPermission(
  permissions: PromisePermissionsApi,
  pattern: string,
): Promise<true> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await permissions.contains({ origins: [pattern] })) return true;
    await new Promise((resolve) => globalThis.setTimeout(resolve, 100));
  }
  return new Promise<true>(() => undefined);
}

export function registerPairingRuntime(
  pairing: Pairing,
  {
    operationStore,
    runtime = chrome.runtime,
    permissions = chrome.permissions,
    promiseRuntime = firefoxRuntimeApi(runtime),
  }: PairingRuntimeDependencies,
): () => void {
  let inFlight: {
    origin: string;
    promise: Promise<PairedDestination>;
  } | null = null;

  const broadcast = (state: PairingOperationState): void => {
    const message = {
      target: "pairing-state",
      state,
    } satisfies PairingStateMessage;
    if (promiseRuntime !== undefined) {
      void promiseRuntime.sendMessage(message).catch(() => undefined);
      return;
    }
    try {
      runtime.sendMessage(message, () => {
        void runtime.lastError;
      });
    } catch {
      // A closed popup is the ordinary case during a permission prompt.
    }
  };

  const save = async (state: PairingOperationState): Promise<void> => {
    await operationStore.save(state);
    broadcast(state);
  };

  const resume = async (origin: string): Promise<PairedDestination> => {
    if (inFlight?.origin === origin) return inFlight.promise;
    const run = (async () => {
      const granted = await permissionContains(
        permissions,
        runtimeOriginPermissionPattern(origin, runtime),
        runtime,
      );
      if (!granted) {
        throw new Error(
          "Permission to reach this Increader instance was not granted.",
        );
      }
      await save({ phase: "connecting", origin });
      try {
        const paired = await pairing.connect(origin);
        await save({ phase: "idle" });
        return paired;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Could not connect to a compatible Increader instance.";
        await save({ phase: "failed", origin, message });
        if (error instanceof Error) throw error;
        throw new Error(message, { cause: error });
      }
    })();
    inFlight = { origin, promise: run };
    const clearInFlight = (): void => {
      if (inFlight?.promise === run) inFlight = null;
    };
    void run.then(clearInFlight, clearInFlight);
    return run;
  };

  const resumeWhenPermissionGranted = async (origin: string): Promise<void> => {
    const pattern = runtimeOriginPermissionPattern(origin, runtime);
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const state = await operationStore.load();
      if (state.phase !== "waiting-permission" || state.origin !== origin) {
        return;
      }
      if (await permissionContains(permissions, pattern, runtime)) {
        await resume(origin);
        return;
      }
      await new Promise((resolve) => globalThis.setTimeout(resolve, 100));
    }
  };

  const onMessage = (
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: PairingRuntimeResponse) => void,
  ): boolean => {
    if (!isPairingCommand(message)) return false;
    const prepare = async (origin: string): Promise<unknown> => {
      await save({ phase: "waiting-permission", origin });
      void resumeWhenPermissionGranted(origin).catch(() => undefined);
      if (
        await permissionContains(
          permissions,
          runtimeOriginPermissionPattern(origin, runtime),
          runtime,
        )
      ) {
        return resume(origin);
      }
      return undefined;
    };
    void runPairingCommand(
      pairing,
      operationStore,
      message,
      prepare,
      save,
      resume,
    ).then(
      (value) => {
        sendResponse({ ok: true, value });
      },
      (error: unknown) => {
        sendResponse({
          ok: false,
          message:
            error instanceof Error
              ? error.message
              : "Browser Capture could not complete that action.",
        });
      },
    );
    return true;
  };
  runtime.onMessage.addListener(onMessage);

  const onAdded = (added: chrome.permissions.Permissions): void => {
    void operationStore
      .load()
      .then((state) => {
        if (
          state.phase === "waiting-permission" &&
          added.origins?.includes(
            runtimeOriginPermissionPattern(state.origin, runtime),
          ) === true
        ) {
          return resume(state.origin);
        }
        return undefined;
      })
      .catch(() => undefined);
  };
  permissions.onAdded.addListener(onAdded);
  void operationStore
    .load()
    .then((state) => {
      if (state.phase === "waiting-permission") {
        return resumeWhenPermissionGranted(state.origin);
      }
      return undefined;
    })
    .catch(() => undefined);

  return () => {
    runtime.onMessage.removeListener(onMessage);
    permissions.onAdded.removeListener(onAdded);
  };
}

async function runPairingCommand(
  pairing: Pairing,
  operationStore: PairingOperationStore,
  message: PairingRuntimeCommand,
  prepare: (origin: string) => Promise<unknown>,
  save: (state: PairingOperationState) => Promise<void>,
  resume: (origin: string) => Promise<PairedDestination>,
): Promise<unknown> {
  switch (message.command) {
    case "prepare":
      return prepare(requiredOrigin(message));
    case "resume":
      return resume(requiredOrigin(message));
    case "decline": {
      const origin = requiredOrigin(message);
      await save({
        phase: "failed",
        origin,
        message: "Permission to reach this Increader instance was not granted.",
      });
      return undefined;
    }
    case "current":
      return pairing.current();
    case "current-origin":
      return pairing.currentOrigin();
    case "discover":
      return pairing.discover(requiredOrigin(message));
    case "access-token":
      return pairing.accessToken();
    case "disconnect":
      await pairing.disconnect();
      await save({ phase: "idle" });
      return undefined;
    case "operation":
      return operationStore.load();
  }
}

function command<T>(
  runtime: typeof chrome.runtime,
  promiseRuntime: PromiseRuntimeApi | undefined,
  message: Omit<PairingRuntimeCommand, "target">,
): Promise<T> {
  const request = {
    target: "pairing",
    ...message,
  } satisfies PairingRuntimeCommand;
  if (promiseRuntime !== undefined) {
    return promiseRuntime
      .sendMessage(request)
      .then((response) => readResponse(response) as T);
  }
  return new Promise((resolve, reject) => {
    runtime.sendMessage(
      request,
      (response: PairingRuntimeResponse | undefined) => {
        const runtimeError = runtime.lastError;
        if (runtimeError !== undefined) {
          reject(new Error(runtimeError.message));
          return;
        }
        try {
          resolve(readResponse(response) as T);
        } catch (error) {
          reject(
            error instanceof Error
              ? error
              : new Error(
                  "The Browser Capture background response was invalid.",
                  { cause: error },
                ),
          );
        }
      },
    );
  });
}

function readResponse(response: PairingRuntimeResponse | undefined): unknown {
  if (response?.ok !== true) {
    throw new Error(
      response?.message ?? "The Browser Capture background is unavailable.",
    );
  }
  return response.value;
}

function permissionContains(
  permissions: typeof chrome.permissions,
  pattern: string,
  runtime: typeof chrome.runtime,
): Promise<boolean> {
  const promisePermissions = firefoxPermissionsApi(runtime);
  if (promisePermissions !== undefined) {
    return promisePermissions.contains({ origins: [pattern] });
  }
  return new Promise((resolve, reject) => {
    permissions.contains({ origins: [pattern] }, (granted) => {
      const error = runtime.lastError;
      if (error === undefined) {
        resolve(granted);
      } else {
        reject(new Error(error.message));
      }
    });
  });
}

function requiredOrigin(message: PairingRuntimeCommand): string {
  if (message.origin === undefined) {
    throw new Error("An Increader instance origin is required.");
  }
  return normalizeInstanceOrigin(message.origin);
}

function isPairingCommand(value: unknown): value is PairingRuntimeCommand {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.target === "pairing" &&
    (candidate.command === "prepare" ||
      candidate.command === "resume" ||
      candidate.command === "decline" ||
      candidate.command === "current" ||
      candidate.command === "current-origin" ||
      candidate.command === "discover" ||
      candidate.command === "access-token" ||
      candidate.command === "disconnect" ||
      candidate.command === "operation")
  );
}

function isPairingStateMessage(value: unknown): value is PairingStateMessage {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.target === "pairing-state" &&
    candidate.state !== null &&
    typeof candidate.state === "object"
  );
}
