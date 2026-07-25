import { IDBFactory } from "fake-indexeddb";
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
    ).toEqual(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]));
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
});

function failedRecord(): Extract<CaptureJobRecord, { phase: "failed" }> {
  return {
    phase: "failed",
    origin: "https://reader.example",
    message: "network unavailable",
    package: {
      manifest: {
        captureId: "019bf66c-42ac-7c33-b57d-e2131af04fe9",
        capturedAt: "2026-07-25T12:00:00.000Z",
        sourceUrl: "https://publisher.example/article",
        baseUrl: "https://publisher.example/article",
        document: {
          bytes: 18,
          sha256: "a".repeat(64),
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
            bytes: 4,
            sha256: "b".repeat(64),
          },
        ],
      },
      documentHtml:
        '<p><img src="increader:browser-capture-asset/asset-0001"></p>',
      assetParts: [
        {
          id: "asset-0001",
          mediaType: "image/png",
          data: new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])], {
            type: "image/png",
          }),
        },
      ],
    },
  };
}
