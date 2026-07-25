import { IDBFactory } from "fake-indexeddb";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import type { CaptureJobRecord } from "../capture-job/capture-job";
import { createIndexedDbCaptureJobStore } from "./capture-job-store";

describe.each(["Chrome", "Firefox"])("%s Capture Job IndexedDB storage", () => {
  it("round-trips an immutable staged package across a browser restart", async () => {
    const factory = new IDBFactory();
    const first = createIndexedDbCaptureJobStore(factory, "capture-job-test");
    const record = failedRecord();

    await first.save(record);

    const restarted = createIndexedDbCaptureJobStore(
      factory,
      "capture-job-test",
    );
    const restored = await restarted.load();
    expect(restored).toMatchObject({
      phase: "failed",
      origin: "https://reader.example",
      message: "network unavailable",
      package: {
        manifest: record.package.manifest,
        documentHtml: record.package.documentHtml,
      },
    });
    if (restored?.phase !== "failed") {
      throw new Error("Failed staged package was not restored.");
    }
    const restoredPart = restored.package.assetParts[0];
    if (restoredPart === undefined) {
      throw new Error("Captured asset bytes were not restored.");
    }
    expect(
      new Uint8Array(await restoredPart.data.arrayBuffer()),
    ).toEqual(
      Uint8Array.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
      ]),
    );
  });

  it("replaces staged bytes with compact completion metadata", async () => {
    const factory = new IDBFactory();
    const store = createIndexedDbCaptureJobStore(factory, "capture-job-test");
    const record = failedRecord();
    await store.save(record);

    await store.save({
      phase: "completed",
      captureId: record.package.manifest.captureId,
      outcome: "created",
      bookmarkId: 84,
      title: "Extracted article",
      origin: "https://reader.example",
    });

    const restored = await store.load();
    expect(restored).toEqual({
      phase: "completed",
      captureId: record.package.manifest.captureId,
      outcome: "created",
      bookmarkId: 84,
      title: "Extracted article",
      origin: "https://reader.example",
    });
    expect(restored).not.toHaveProperty("package");
  });

  it("rejects invalid staged bytes on save and clears corrupted persisted records on load", async () => {
    const factory = new IDBFactory();
    const databaseName = "capture-job-validation-test";
    const store = createIndexedDbCaptureJobStore(factory, databaseName);
    const invalid = structuredClone(failedRecord());
    invalid.package.manifest.document.bytes += 1;

    await expect(store.save(invalid)).rejects.toThrow(
      "Capture Job record is invalid.",
    );

    await store.save(failedRecord());
    const database = await openDatabase(factory, databaseName);
    const transaction = database.transaction("capture-job", "readwrite");
    transaction.objectStore("capture-job").put(
      {
        phase: "failed",
        origin: "https://reader.example",
        message: "forged",
        retryable: true,
        package: { manifest: { captureId: "not-a-capture-id" } },
      },
      "current",
    );
    await completed(transaction);

    await expect(store.load()).resolves.toBeNull();
    await expect(readRaw(database)).resolves.toBeUndefined();
  });

  it("recognizes only marker-bearing img src attributes", async () => {
    const store = createIndexedDbCaptureJobStore(
      new IDBFactory(),
      "capture-job-marker-validation-test",
    );
    const textMention = failedRecord();
    const textHtml =
      '<p>Documentation says increader:browser-capture-asset/asset-9999.</p>' +
      textMention.package.documentHtml.replace("<img ", '<img alt=">" ');
    setDocumentHtml(textMention, textHtml);

    await expect(store.save(textMention)).resolves.toBeUndefined();

    const duplicateAttribute = failedRecord();
    const duplicateHtml = duplicateAttribute.package.documentHtml.replace(
      "<img ",
      '<img src="increader:browser-capture-asset/asset-0001" ',
    );
    setDocumentHtml(duplicateAttribute, duplicateHtml);
    await expect(store.save(duplicateAttribute)).rejects.toThrow(
      "Capture Job record is invalid.",
    );
  });
});

function failedRecord(): Extract<CaptureJobRecord, { phase: "failed" }> {
  return {
    phase: "failed",
    origin: "https://reader.example",
    message: "network unavailable",
    retryable: true,
    package: {
      manifest: {
        captureId: "019bf66c-42ac-7c33-b57d-e2131af04fe9",
        capturedAt: "2026-07-25T12:00:00.000Z",
        sourceUrl: "https://publisher.example/article",
        baseUrl: "https://publisher.example/article",
        document: {
          bytes: 61,
          sha256:
            "9a815890db74c3f930b6a6727d3e17e300f3dc556df89b62029a3e0638b0b943",
        },
        producer: {
          browser: "Chrome",
          extensionVersion: "0.1.0",
        },
        assets: [
          {
            id: "asset-0001",
            sourceUrl: "https://publisher.example/diagram.png",
            status: "captured",
            mediaType: "image/png",
            bytes: 12,
            sha256:
              "1b56b50ac4e976f488f128cabdcdffb2fc9331d6974bb9968131a415d14ade24",
          },
        ],
      },
      documentHtml:
        '<p><img src="increader:browser-capture-asset/asset-0001"></p>',
      assetParts: [
        {
          id: "asset-0001",
          mediaType: "image/png",
          data: new Blob(
            [
              Uint8Array.from([
                0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
              ]),
            ],
            { type: "image/png" },
          ),
        },
      ],
    },
  };
}

function openDatabase(
  factory: IDBFactory,
  databaseName: string,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(databaseName, 1);
    request.onsuccess = () => { resolve(request.result); };
    request.onerror = () => {
      reject(request.error ?? new Error("IndexedDB open failed."));
    };
  });
}

function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => { resolve(); };
    transaction.onerror = () => {
      reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    };
    transaction.onabort = () => {
      reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    };
  });
}

function readRaw(database: IDBDatabase): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("capture-job", "readonly");
    const request = transaction.objectStore("capture-job").get("current");
    request.onsuccess = () => { resolve(request.result); };
    request.onerror = () => {
      reject(request.error ?? new Error("IndexedDB read failed."));
    };
  });
}

function setDocumentHtml(
  record: Extract<CaptureJobRecord, { phase: "failed" }>,
  html: string,
): void {
  const mutable = record.package as {
    documentHtml: string;
    manifest: { document: { bytes: number; sha256: string } };
  };
  const bytes = new TextEncoder().encode(html);
  mutable.documentHtml = html;
  mutable.manifest.document.bytes = bytes.byteLength;
  mutable.manifest.document.sha256 = sha256Hex(bytes);
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
