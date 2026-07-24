import type {
  DestinationStore,
  RuntimeOriginPermissions
} from "../pairing/pairing";

const DESTINATION_STORAGE_KEY = "browserCaptureDestinationOrigin";

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
