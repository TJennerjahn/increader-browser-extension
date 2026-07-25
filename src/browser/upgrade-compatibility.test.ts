import { readFile } from "node:fs/promises";
import path from "node:path";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import {
  createCredentialStore,
  createDestinationStore,
  createInstallationIdentity,
} from "./chrome-adapters";
import { createIndexedDbCaptureJobStore } from "./capture-job-store";
import { createPairing } from "../pairing/pairing";

describe.each(["Chrome", "Firefox"])("%s previous-candidate upgrade", () => {
  it("preserves installation, Pairing renewal, Capture ID, staged bytes, and retryability", async () => {
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: { runtime: { lastError: undefined } },
    });
    const fixture = JSON.parse(
      await readFile(
        path.resolve("release/fixtures/previous-candidate-0.0.9.json"),
        "utf8",
      ),
    ) as PreviousCandidateFixture;
    const storage = memoryStorage(fixture.storageLocal);
    const installation = createInstallationIdentity(storage);
    const credentials = createCredentialStore(storage);
    const destination = createDestinationStore(storage);
    const factory = new IDBFactory();
    const databaseName = "previous-candidate-upgrade";
    const jobStore = createIndexedDbCaptureJobStore(factory, databaseName);
    await putRawJob(factory, databaseName, reconstructedJob(fixture.captureJob));

    expect(await installation.id()).toBe(
      fixture.storageLocal.browserCaptureInstallationId,
    );
    expect(await destination.load()).toBe(
      fixture.storageLocal.browserCaptureDestinationOrigin,
    );
    expect((await credentials.load())?.renewalCredential).toBe(
      "previous-candidate-renewal",
    );
    const loaded = await jobStore.load();
    expect(loaded).toMatchObject({
      phase: "failed",
      retryable: true,
      package: {
        manifest: {
          captureId: fixture.captureJob.package.manifest.captureId,
        },
      },
    });
    if (loaded?.phase !== "failed") throw new Error("Fixture did not load");
    expect(loaded.package.documentHtml).toBe(
      decodeBase64(fixture.captureJob.package.documentHtmlBase64),
    );
    expect(await loaded.package.assetParts[0]?.data.arrayBuffer()).toEqual(
      Uint8Array.from(
        atob(fixture.captureJob.package.assetParts[0]?.dataBase64 ?? ""),
        (character) => character.charCodeAt(0),
      ).buffer,
    );

    const pairing = createPairing({
      credentials,
      discovery: {
        discover: () => Promise.reject(new Error("not used")),
      },
      permissions: {
        contains: () => Promise.resolve(true),
        request: () => Promise.resolve(true),
        remove: () => Promise.resolve(),
      },
      protocol: {
        exchange: () => Promise.reject(new Error("not used")),
        renew: (_origin, request) => {
          expect(request.renewalCredential).toBe(
            "previous-candidate-renewal",
          );
          expect(request.installationId).toBe(
            fixture.storageLocal.browserCaptureInstallationId,
          );
          return Promise.resolve({
            tokenType: "Bearer",
            accessToken: "renewed-access",
            expiresInSeconds: 600,
            renewalCredential: "rotated-after-upgrade",
            renewalExpiresInSeconds: 7_776_000,
            pairingId:
              fixture.storageLocal.browserCapturePairingCredential.pairingId,
          });
        },
        revoke: () => Promise.resolve(),
      },
      store: destination,
    });
    expect(await pairing.accessToken()).toBe("renewed-access");
    expect((await credentials.load())?.renewalCredential).toBe(
      "rotated-after-upgrade",
    );
    expect(await installation.id()).toBe(
      fixture.storageLocal.browserCaptureInstallationId,
    );
    expect((await jobStore.load())?.phase).toBe("failed");
  });
});

interface PreviousCandidateFixture {
  storageLocal: {
    browserCaptureInstallationId: string;
    browserCaptureDestinationOrigin: string;
    browserCapturePairingCredential: {
      displayName: string;
      installationId: string;
      origin: string;
      pairingId: string;
      renewalCredential: string;
    };
  };
  captureJob: {
    phase: "failed";
    origin: string;
    message: string;
    retryable: boolean;
    package: {
      manifest: {
        captureId: string;
        capturedAt: string;
        sourceUrl: string;
        baseUrl: string;
        title: string;
        document: { bytes: number; sha256: string };
        producer: { browser: string; extensionVersion: string };
        assets: Array<{
          id: string;
          sourceUrl: string;
          status: "captured";
          mediaType: "image/png";
          bytes: number;
          sha256: string;
        }>;
      };
      documentHtmlBase64: string;
      assetParts: Array<{
        id: string;
        mediaType: "image/png";
        dataBase64: string;
      }>;
    };
  };
}

function reconstructedJob(fixture: PreviousCandidateFixture["captureJob"]) {
  return {
    ...fixture,
    package: {
      manifest: fixture.package.manifest,
      documentHtml: decodeBase64(fixture.package.documentHtmlBase64),
      assetParts: fixture.package.assetParts.map((part) => ({
        id: part.id,
        mediaType: part.mediaType,
        data: new Blob(
          [
            Uint8Array.from(atob(part.dataBase64), (character) =>
              character.charCodeAt(0),
            ),
          ],
          { type: part.mediaType },
        ),
      })),
    },
  };
}

function decodeBase64(value: string): string {
  return new TextDecoder().decode(
    Uint8Array.from(atob(value), (character) => character.charCodeAt(0)),
  );
}

function memoryStorage(initial: Record<string, unknown>) {
  const values = structuredClone(initial);
  return {
    get(
      keys: string | string[] | Record<string, unknown> | null,
      callback: (items: Record<string, unknown>) => void,
    ) {
      const selected =
        typeof keys === "string" ? { [keys]: values[keys] } : values;
      callback(selected);
    },
    set(items: Record<string, unknown>, callback?: () => void) {
      Object.assign(values, items);
      callback?.();
    },
    remove(keys: string | string[], callback?: () => void) {
      for (const key of typeof keys === "string" ? [keys] : keys) {
        Reflect.deleteProperty(values, key);
      }
      callback?.();
    },
  } as unknown as chrome.storage.StorageArea;
}

async function putRawJob(
  factory: IDBFactory,
  databaseName: string,
  value: unknown,
): Promise<void> {
  const request = factory.open(databaseName, 1);
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    request.onupgradeneeded = () => {
      request.result.createObjectStore("capture-job");
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("Fixture database could not open"));
    };
  });
  const transaction = database.transaction("capture-job", "readwrite");
  transaction.objectStore("capture-job").put(value, "current");
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => {
      resolve();
    };
    transaction.onerror = transaction.onabort = () => {
      reject(
        transaction.error ??
          new Error("Fixture transaction could not complete"),
      );
    };
  });
  database.close();
}
