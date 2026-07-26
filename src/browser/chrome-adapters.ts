const CONNECTION_ORIGIN_STORAGE_KEY = "browserCaptureConnectionOrigin";

export function createConnectionOriginPreferenceStore(
  storage: chrome.storage.StorageArea = chrome.storage.local,
): {
  load(): Promise<string | null>;
  save(origin: string): Promise<void>;
} {
  return {
    async load() {
      const values = await storageGet(storage, CONNECTION_ORIGIN_STORAGE_KEY);
      const origin = values[CONNECTION_ORIGIN_STORAGE_KEY];
      return typeof origin === "string" ? origin : null;
    },
    async save(origin) {
      await storageSet(storage, { [CONNECTION_ORIGIN_STORAGE_KEY]: origin });
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

interface PromiseStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
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
  return (
    globalThis as typeof globalThis & {
      browser?: { storage?: { local?: PromiseStorageArea } };
    }
  ).browser?.storage?.local;
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
