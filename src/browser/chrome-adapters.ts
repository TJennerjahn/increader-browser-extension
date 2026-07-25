import type {
  BrowserIdentityFlow,
  CredentialStore,
  DestinationStore,
  InstallationIdentity,
  RuntimeOriginPermissions,
} from "../pairing/pairing";
import type {
  PairingOperationState,
  PairingOperationStore,
} from "./pairing-runtime";
import { runtimeOriginPermissionPattern } from "./runtime-origin-permission";

const DESTINATION_STORAGE_KEY = "browserCaptureDestinationOrigin";
const CREDENTIAL_STORAGE_KEY = "browserCapturePairingCredential";
const INSTALLATION_STORAGE_KEY = "browserCaptureInstallationId";
const PAIRING_OPERATION_STORAGE_KEY = "browserCapturePairingOperation";

export function createRuntimeOriginPermissions(
  api: typeof chrome.permissions = chrome.permissions,
  runtime: typeof chrome.runtime = chrome.runtime,
  promiseApi: PromisePermissionsApi | undefined = firefoxPermissionsApi(
    runtime,
  ),
): RuntimeOriginPermissions {
  const adapted = (pattern: string): string =>
    runtimeOriginPermissionPattern(pattern, runtime);
  return {
    contains: (pattern) =>
      promiseApi?.contains({ origins: [adapted(pattern)] }) ??
      callbackResult<boolean>((done) => {
        api.contains({ origins: [adapted(pattern)] }, done);
      }),
    equivalent: (firstPattern, secondPattern) =>
      adapted(firstPattern) === adapted(secondPattern),
    request: (pattern) =>
      promiseApi?.request({ origins: [adapted(pattern)] }) ??
      callbackResult<boolean>((done) => {
        api.request({ origins: [adapted(pattern)] }, done);
      }),
    remove: async (pattern) => {
      if (promiseApi !== undefined) {
        await promiseApi.remove({ origins: [adapted(pattern)] });
      } else {
        await callbackResult<boolean>((done) => {
          api.remove({ origins: [adapted(pattern)] }, done);
        });
      }
    },
  };
}

export function createDestinationStore(
  storage: chrome.storage.StorageArea = chrome.storage.local,
): DestinationStore {
  return {
    async load() {
      const values = await storageGet(storage, DESTINATION_STORAGE_KEY);
      const origin = values[DESTINATION_STORAGE_KEY];
      return typeof origin === "string" ? origin : null;
    },
    async save(origin) {
      await storageSet(storage, { [DESTINATION_STORAGE_KEY]: origin });
    },
    async clear() {
      await storageRemove(storage, DESTINATION_STORAGE_KEY);
    },
  };
}

export function createCredentialStore(
  storage: chrome.storage.StorageArea = chrome.storage.local,
): CredentialStore {
  return {
    async load() {
      const values = await storageGet(storage, CREDENTIAL_STORAGE_KEY);
      const candidate = values[CREDENTIAL_STORAGE_KEY];
      if (
        candidate === null ||
        typeof candidate !== "object" ||
        !hasStrings(candidate, [
          "displayName",
          "installationId",
          "origin",
          "pairingId",
          "renewalCredential",
        ])
      ) {
        return null;
      }
      return {
        displayName: candidate.displayName as string,
        installationId: candidate.installationId as string,
        origin: candidate.origin as string,
        pairingId: candidate.pairingId as string,
        renewalCredential: candidate.renewalCredential as string,
      };
    },
    async save(value) {
      await storageSet(storage, { [CREDENTIAL_STORAGE_KEY]: value });
    },
    async clear() {
      await storageRemove(storage, CREDENTIAL_STORAGE_KEY);
    },
  };
}

export function createInstallationIdentity(
  storage: chrome.storage.StorageArea = chrome.storage.local,
): InstallationIdentity {
  return {
    name: "Increader Browser Capture",
    async id() {
      const values = await storageGet(storage, INSTALLATION_STORAGE_KEY);
      const current = values[INSTALLATION_STORAGE_KEY];
      if (typeof current === "string" && current.length > 0) {
        return current;
      }
      const created = globalThis.crypto.randomUUID();
      await storageSet(storage, { [INSTALLATION_STORAGE_KEY]: created });
      return created;
    },
  };
}

export function createPairingOperationStore(
  storage: chrome.storage.StorageArea = chrome.storage.local,
): PairingOperationStore {
  return {
    async load() {
      const values = await storageGet(storage, PAIRING_OPERATION_STORAGE_KEY);
      return pairingOperationState(values[PAIRING_OPERATION_STORAGE_KEY]);
    },
    async save(state) {
      if (state.phase === "idle") {
        await storageRemove(storage, PAIRING_OPERATION_STORAGE_KEY);
        return;
      }
      await storageSet(storage, { [PAIRING_OPERATION_STORAGE_KEY]: state });
    },
  };
}

export function createBrowserIdentityFlow(
  api: typeof chrome.identity = chrome.identity,
  runtime: typeof chrome.runtime = chrome.runtime,
  promiseApi: PromiseIdentityApi | undefined = firefoxIdentityApi(),
): BrowserIdentityFlow {
  const runtimeWithOptionalUrl = runtime as {
    getURL?: (path: string) => string;
  };
  const firefox =
    runtimeWithOptionalUrl.getURL?.("").startsWith("moz-extension://") === true;
  return {
    callbackUri: () =>
      firefox && promiseApi !== undefined
        ? promiseApi.getRedirectURL("browser-capture")
        : api.getRedirectURL("browser-capture"),
    launch: (approvalUrl) => {
      const details = {
        interactive: true,
        url: approvalUrl,
      };
      if (firefox && promiseApi !== undefined) {
        return promiseApi.launchWebAuthFlow(details);
      }
      return callbackResult<string | undefined>((done) => {
        api.launchWebAuthFlow(details, done);
      });
    },
  };
}

export function createTabOpener(
  api: typeof chrome.tabs = chrome.tabs,
  promiseApi: PromiseTabsApi | undefined = firefoxTabsApi(),
): (url: string) => Promise<void> {
  return async (url) => {
    if (promiseApi !== undefined) {
      await promiseApi.create({ active: true, url });
      return;
    }
    await callbackResult<chrome.tabs.Tab>((done) => {
      api.create({ active: true, url }, done);
    });
  };
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

interface PromiseStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  remove(key: string): Promise<void>;
  set(values: Record<string, unknown>): Promise<void>;
}

interface PromiseTabsApi {
  create(properties: chrome.tabs.CreateProperties): Promise<chrome.tabs.Tab>;
}

function firefoxTabsApi(): PromiseTabsApi | undefined {
  return (
    globalThis as typeof globalThis & {
      browser?: { tabs?: PromiseTabsApi };
    }
  ).browser?.tabs;
}

function firefoxStorageArea(): PromiseStorageArea | undefined {
  const globals = globalThis as typeof globalThis & {
    browser?: { storage?: { local?: PromiseStorageArea } };
  };
  return globals.browser?.storage?.local;
}

function hasStrings<T extends object>(
  candidate: T,
  keys: string[],
): candidate is T & Record<string, string> {
  const values = candidate as Record<string, unknown>;
  return keys.every((key) => typeof values[key] === "string");
}

interface PromiseIdentityApi {
  getRedirectURL(path?: string): string;
  launchWebAuthFlow(
    details: chrome.identity.WebAuthFlowDetails,
  ): Promise<string | undefined>;
}

interface PromisePermissionsApi {
  contains(permissions: chrome.permissions.Permissions): Promise<boolean>;
  remove(permissions: chrome.permissions.Permissions): Promise<boolean>;
  request(permissions: chrome.permissions.Permissions): Promise<boolean>;
}

function firefoxIdentityApi(): PromiseIdentityApi | undefined {
  return (
    globalThis as typeof globalThis & {
      browser?: { identity?: PromiseIdentityApi };
    }
  ).browser?.identity;
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

function pairingOperationState(value: unknown): PairingOperationState {
  if (value === null || typeof value !== "object") return { phase: "idle" };
  const candidate = value as Record<string, unknown>;
  if (
    (candidate.phase === "waiting-permission" ||
      candidate.phase === "connecting") &&
    typeof candidate.origin === "string"
  ) {
    return { phase: candidate.phase, origin: candidate.origin };
  }
  if (
    candidate.phase === "failed" &&
    typeof candidate.origin === "string" &&
    typeof candidate.message === "string"
  ) {
    return {
      phase: "failed",
      origin: candidate.origin,
      message: candidate.message,
    };
  }
  return { phase: "idle" };
}

function callbackResult<T>(
  invoke: (done: (value: T) => void) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    invoke((value) => {
      const error = chrome.runtime.lastError;
      if (error === undefined) {
        resolve(value);
      } else {
        reject(new Error(error.message));
      }
    });
  });
}

function callbackVoid(invoke: (done: () => void) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    invoke(() => {
      const error = chrome.runtime.lastError;
      if (error === undefined) {
        resolve();
      } else {
        reject(new Error(error.message));
      }
    });
  });
}
