import type {
  BrowserIdentityFlow,
  CredentialStore,
  DestinationStore,
  InstallationIdentity,
  RuntimeOriginPermissions
} from "../pairing/pairing";

const DESTINATION_STORAGE_KEY = "browserCaptureDestinationOrigin";
const CREDENTIAL_STORAGE_KEY = "browserCapturePairingCredential";
const INSTALLATION_STORAGE_KEY = "browserCaptureInstallationId";

export function createRuntimeOriginPermissions(
  api: typeof chrome.permissions = chrome.permissions
): RuntimeOriginPermissions {
  return {
    contains: (pattern) =>
      callbackResult<boolean>((done) => {
        api.contains({ origins: [pattern] }, done);
      }),
    request: (pattern) =>
      callbackResult<boolean>((done) => {
        api.request({ origins: [pattern] }, done);
      }),
    remove: async (pattern) => {
      await callbackResult<boolean>((done) => {
        api.remove({ origins: [pattern] }, done);
      });
    }
  };
}

export function createDestinationStore(
  storage: chrome.storage.StorageArea = chrome.storage.local
): DestinationStore {
  return {
    async load() {
      const values = await callbackResult<Record<string, unknown>>((done) =>
        {
          storage.get(DESTINATION_STORAGE_KEY, done);
        }
      );
      const origin = values[DESTINATION_STORAGE_KEY];
      return typeof origin === "string" ? origin : null;
    },
    async save(origin) {
      await callbackVoid((done) => {
        storage.set({ [DESTINATION_STORAGE_KEY]: origin }, done);
      });
    },
    async clear() {
      await callbackVoid((done) => {
        storage.remove(DESTINATION_STORAGE_KEY, done);
      });
    }
  };
}

export function createCredentialStore(
  storage: chrome.storage.StorageArea = chrome.storage.local
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
          "renewalCredential"
        ])
      ) {
        return null;
      }
      return {
        displayName: candidate.displayName as string,
        installationId: candidate.installationId as string,
        origin: candidate.origin as string,
        pairingId: candidate.pairingId as string,
        renewalCredential: candidate.renewalCredential as string
      };
    },
    async save(value) {
      await storageSet(storage, { [CREDENTIAL_STORAGE_KEY]: value });
    },
    async clear() {
      await storageRemove(storage, CREDENTIAL_STORAGE_KEY);
    }
  };
}

export function createInstallationIdentity(
  storage: chrome.storage.StorageArea = chrome.storage.local
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
    }
  };
}

export function createBrowserIdentityFlow(
  api: typeof chrome.identity = chrome.identity
): BrowserIdentityFlow {
  return {
    callbackUri: () => api.getRedirectURL("browser-capture"),
    launch: (approvalUrl) =>
      callbackResult<string | undefined>((done) => {
        api.launchWebAuthFlow(
          {
            interactive: true,
            url: approvalUrl
          },
          done
        );
      })
  };
}

function storageGet(
  storage: chrome.storage.StorageArea,
  key: string
): Promise<Record<string, unknown>> {
  return callbackResult((done) => {
    storage.get(key, done);
  });
}

function storageSet(
  storage: chrome.storage.StorageArea,
  values: Record<string, unknown>
): Promise<void> {
  return callbackVoid((done) => {
    storage.set(values, done);
  });
}

function storageRemove(
  storage: chrome.storage.StorageArea,
  key: string
): Promise<void> {
  return callbackVoid((done) => {
    storage.remove(key, done);
  });
}

function hasStrings<T extends object>(
  candidate: T,
  keys: string[]
): candidate is T & Record<string, string> {
  const values = candidate as Record<string, unknown>;
  return keys.every((key) => typeof values[key] === "string");
}

function callbackResult<T>(
  invoke: (done: (value: T) => void) => void
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
