import type {
  CaptureJobRecord,
  CaptureJobStore,
} from "../capture-job/capture-job";

const STORE_NAME = "capture-job";
const CURRENT_JOB_KEY = "current";

export function createIndexedDbCaptureJobStore(
  factory: IDBFactory = indexedDB,
  databaseName = "increader-browser-capture",
): CaptureJobStore {
  let database: Promise<IDBDatabase> | null = null;

  const open = (): Promise<IDBDatabase> => {
    database ??= new Promise((resolve, reject) => {
      const request = factory.open(databaseName, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(request.error ?? new Error("Capture Job storage is unavailable."));
      };
    });
    return database;
  };

  return {
    async load() {
      const db = await open();
      const transaction = db.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(CURRENT_JOB_KEY);
      const value = await requestResult<unknown>(request);
      return isCaptureJobRecord(value) ? value : null;
    },

    async save(record) {
      const db = await open();
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(record, CURRENT_JOB_KEY);
      await transactionComplete(transaction);
    },

    async clear() {
      const db = await open();
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(CURRENT_JOB_KEY);
      await transactionComplete(transaction);
    },
  };
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("Capture Job storage is unavailable."));
    };
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => {
      resolve();
    };
    transaction.onabort = transaction.onerror = () => {
      reject(
        transaction.error ?? new Error("Capture Job storage is unavailable."),
      );
    };
  });
}

function isCaptureJobRecord(value: unknown): value is CaptureJobRecord {
  if (value === null || typeof value !== "object") return false;
  const phase = (value as Record<string, unknown>).phase;
  return (
    phase === "capturing" ||
    phase === "capture-failed" ||
    phase === "staged" ||
    phase === "sending" ||
    phase === "failed" ||
    phase === "completed"
  );
}
