import { describe, expect, it, vi } from "vitest";

import type { ActivePageInspection } from "../browser/active-page";
import type { StagedCapturePackage } from "../capture-package/capture-package";
import {
  createCaptureJob,
  type CaptureJobRecord,
  type CaptureJobStore,
} from "./capture-job";

describe.each(["Chrome", "Firefox"])("%s Browser Capture Job", () => {
  it("continues after the popup closes and deletes staged bytes after success", async () => {
    const capture = deferred<StagedCapturePackage>();
    const records: CaptureJobRecord[] = [];
    const store: CaptureJobStore = {
      load: () => Promise.resolve(records.at(-1) ?? null),
      save: vi.fn((record: CaptureJobRecord) => {
        records.push(record);
        return Promise.resolve();
      }),
      clear: vi.fn(),
    };
    const transfer = vi.fn().mockResolvedValue({
      bookmarkId: 84,
      created: true,
      title: "Extracted article",
    });
    const job = createCaptureJob({
      accessToken: () => Promise.resolve("bca_memory"),
      capture: () => capture.promise,
      notifyFailure: vi.fn(),
      store,
      transfer,
    });
    const states: string[] = [];
    const stopObserving = job.observe((state) => states.push(state.phase));

    const started = await job.startImport(
      supportedPage(),
      "https://reader.example",
    );
    expect(started).toEqual({ status: "started" });
    stopObserving();

    capture.resolve(packageFixture());
    await vi.waitFor(() => {
      expect(transfer).toHaveBeenCalledOnce();
    });
    await vi.waitFor(async () => {
      await expect(job.current()).resolves.toMatchObject({
        phase: "completed",
        outcome: "created",
        bookmarkId: 84,
      });
    });

    expect(states).toEqual(["ready", "capturing"]);
    expect(records.map((record) => record.phase)).toEqual([
      "capturing",
      "staged",
      "sending",
      "completed",
    ]);
    expect(records.at(-1)).not.toHaveProperty("package");
  });

  it("restores an interrupted transfer as Needs attention without retrying it", async () => {
    const staged = packageFixture();
    let record: CaptureJobRecord | null = {
      phase: "sending",
      origin: "https://reader.example",
      package: staged,
    };
    const store: CaptureJobStore = {
      load: () => Promise.resolve(record),
      save: vi.fn((next: CaptureJobRecord) => {
        record = next;
        return Promise.resolve();
      }),
      clear: vi.fn(),
    };
    const transfer = vi.fn();
    const notifyFailure = vi.fn().mockResolvedValue(undefined);
    const job = createCaptureJob({
      accessToken: () => Promise.resolve("bca_renewed"),
      capture: vi.fn(),
      notifyFailure,
      store,
      transfer,
    });

    await expect(job.current()).resolves.toEqual({
      phase: "failed",
      captureId: staged.manifest.captureId,
      message:
        "The previous transfer was interrupted. Retry the same Capture Package.",
      retryable: true,
    });
    expect(transfer).not.toHaveBeenCalled();
    expect(notifyFailure).toHaveBeenCalledOnce();
    expect(record).toMatchObject({
      phase: "failed",
      package: staged,
    });
  });

  it("discards a capture interrupted by worker restart and requires fresh Import", async () => {
    let record: CaptureJobRecord | null = {
      phase: "capturing",
      attemptId: "019bf66c-42ac-7c33-b57d-e2131af04fe8",
      page: supportedPage(),
      origin: "https://reader.example",
    };
    const store: CaptureJobStore = {
      load: () => Promise.resolve(record),
      save: vi.fn((next: CaptureJobRecord) => {
        record = next;
        return Promise.resolve();
      }),
      clear: vi.fn(() => {
        record = null;
        return Promise.resolve();
      }),
    };
    const job = createCaptureJob({
      accessToken: () => Promise.resolve("bca_memory"),
      capture: vi.fn(),
      notifyFailure: vi.fn(),
      store,
      transfer: vi.fn(),
    });

    await expect(job.current()).resolves.toEqual({
      phase: "failed",
      captureId: null,
      message:
        "The page changed or closed during capture. Choose Import again.",
      retryable: false,
    });
    expect(record).toEqual({
      phase: "capture-failed",
      attemptId: "019bf66c-42ac-7c33-b57d-e2131af04fe8",
      message:
        "The page changed or closed during capture. Choose Import again.",
    });
  });

  it("retries the byte-identical staged package only after an explicit action", async () => {
    const staged = packageFixture();
    let record: CaptureJobRecord | null = null;
    const store: CaptureJobStore = {
      load: () => Promise.resolve(record),
      save: vi.fn((next: CaptureJobRecord) => {
        record = next;
        return Promise.resolve();
      }),
      clear: vi.fn(),
    };
    const accessToken = vi
      .fn()
      .mockResolvedValueOnce("bca_first")
      .mockResolvedValueOnce("bca_renewed");
    const transfer = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("connection closed"))
      .mockResolvedValueOnce({
        bookmarkId: 84,
        created: false,
        title: "Extracted article",
      });
    const job = createCaptureJob({
      accessToken,
      capture: () => Promise.resolve(staged),
      notifyFailure: vi.fn().mockResolvedValue(undefined),
      store,
      transfer,
    });

    await job.startImport(supportedPage(), "https://reader.example");
    await vi.waitFor(async () => {
      await expect(job.current()).resolves.toMatchObject({
        phase: "failed",
        retryable: true,
      });
    });
    expect(transfer).toHaveBeenCalledTimes(1);

    await job.retry();

    await expect(job.current()).resolves.toMatchObject({
      phase: "completed",
      outcome: "existing",
    });
    expect(accessToken).toHaveBeenNthCalledWith(1, "https://reader.example");
    expect(accessToken).toHaveBeenNthCalledWith(2, "https://reader.example");
    expect(transfer).toHaveBeenNthCalledWith(
      1,
      "https://reader.example",
      "bca_first",
      staged,
      expect.anything(),
    );
    expect(transfer).toHaveBeenNthCalledWith(
      2,
      "https://reader.example",
      "bca_renewed",
      staged,
      expect.anything(),
    );
  });

  it("returns silently to Ready when the User cancels local capture", async () => {
      const capture = deferred<StagedCapturePackage>();
      let aborted = false;
      const store: CaptureJobStore = {
        load: () => Promise.resolve(null),
        save: vi.fn(),
        clear: vi.fn(),
      };
      const transfer = vi.fn();
      const job = createCaptureJob({
        accessToken: () => Promise.resolve("bca_memory"),
        capture: (_page, _progress, signal) => {
          signal.addEventListener("abort", () => {
            aborted = true;
          });
          return capture.promise;
        },
        notifyFailure: vi.fn(),
        store,
        transfer,
      });
      await job.startImport(supportedPage(), "https://reader.example");

      await job.cancel();
      capture.resolve(packageFixture());

      await expect(job.current()).resolves.toEqual({ phase: "ready" });
      expect(aborted).toBe(true);
      expect(store.clear).toHaveBeenCalledOnce();
      expect(transfer).not.toHaveBeenCalled();
  });

  it("records source loss as nonretryable Needs attention without partial bytes", async () => {
    const capture = deferred<StagedCapturePackage>();
    let record: CaptureJobRecord | null = null;
    const notifyFailure = vi.fn().mockResolvedValue(undefined);
    const store: CaptureJobStore = {
      load: () => Promise.resolve(record),
      save: vi.fn((next: CaptureJobRecord) => {
        record = next;
        return Promise.resolve();
      }),
      clear: vi.fn(() => {
        record = null;
        return Promise.resolve();
      }),
    };
    const transfer = vi.fn();
    const job = createCaptureJob({
      accessToken: () => Promise.resolve("bca_memory"),
      capture: () => capture.promise,
      notifyFailure,
      store,
      transfer,
    });
    await job.startImport(supportedPage(), "https://reader.example");

    await job.sourceLost(41);
    capture.resolve(packageFixture());

    await expect(job.current()).resolves.toEqual({
      phase: "failed",
      captureId: null,
      message:
        "The page changed or closed during capture. Choose Import again.",
      retryable: false,
    });
    expect(record).toMatchObject({
      phase: "capture-failed",
      message:
        "The page changed or closed during capture. Choose Import again.",
    });
    expect(record).not.toHaveProperty("page");
    expect(record).not.toHaveProperty("package");
    expect(notifyFailure).toHaveBeenCalledOnce();
    expect(transfer).not.toHaveBeenCalled();
  });

  it("requires replacement confirmation and Discard deletes retryable bytes", async () => {
    const staged = packageFixture();
    let record: CaptureJobRecord | null = {
      phase: "failed",
      origin: "https://reader.example",
      package: staged,
      message: "network unavailable",
    };
    const store: CaptureJobStore = {
      load: () => Promise.resolve(record),
      save: vi.fn((next: CaptureJobRecord) => {
        record = next;
        return Promise.resolve();
      }),
      clear: vi.fn(() => {
        record = null;
        return Promise.resolve();
      }),
    };
    const capture = vi.fn(() => new Promise<StagedCapturePackage>(() => {}));
    const job = createCaptureJob({
      accessToken: () => Promise.resolve("bca_memory"),
      capture,
      notifyFailure: vi.fn(),
      store,
      transfer: vi.fn(),
    });

    await expect(
      job.startImport(supportedPage(), "https://reader.example"),
    ).resolves.toEqual({ status: "replacement-required" });
    expect(capture).not.toHaveBeenCalled();
    expect(record).toMatchObject({ phase: "failed", package: staged });

    await expect(
      job.startImport(supportedPage(), "https://reader.example", true),
    ).resolves.toEqual({ status: "started" });
    expect(capture).toHaveBeenCalledOnce();

    await job.cancel();
    record = {
      phase: "failed",
      origin: "https://reader.example",
      package: staged,
      message: "network unavailable",
    };
    const restored = createCaptureJob({
      accessToken: () => Promise.resolve("bca_memory"),
      capture,
      notifyFailure: vi.fn(),
      store,
      transfer: vi.fn(),
    });
    await restored.current();
    await restored.discard();

    await expect(restored.current()).resolves.toEqual({ phase: "ready" });
    expect(record).toBeNull();
  });

  it("lets source loss win while the durable staged write is still pending", async () => {
    const stagedWrite = deferred<undefined>();
    let record: CaptureJobRecord | null = null;
    const store: CaptureJobStore = {
      load: () => Promise.resolve(null),
      save: vi.fn(async (next: CaptureJobRecord) => {
        if (next.phase === "staged") {
          await stagedWrite.promise;
        }
        record = next;
      }),
      clear: vi.fn(() => {
        record = null;
        return Promise.resolve();
      }),
    };
    const transfer = vi.fn();
    const job = createCaptureJob({
      accessToken: () => Promise.resolve("bca_memory"),
      capture: () => Promise.resolve(packageFixture()),
      notifyFailure: vi.fn(),
      store,
      transfer,
    });
    await job.startImport(supportedPage(), "https://reader.example");
    await vi.waitFor(() => {
      expect(store.save).toHaveBeenCalledWith(
        expect.objectContaining({ phase: "staged" }),
      );
    });

    await job.sourceLost(41);
    stagedWrite.resolve(undefined);

    await vi.waitFor(() => {
      expect(record).toMatchObject({ phase: "capture-failed" });
    });
    await expect(job.current()).resolves.toMatchObject({
      phase: "failed",
      retryable: false,
    });
    expect(record).not.toHaveProperty("package");
    expect(transfer).not.toHaveBeenCalled();
  });

  it("keeps a delayed staged transfer independent from its closed source tab", async () => {
    vi.useFakeTimers();
    try {
      let record: CaptureJobRecord | null = null;
      const store: CaptureJobStore = {
        load: () => Promise.resolve(record),
        save: vi.fn((next: CaptureJobRecord) => {
          record = next;
          return Promise.resolve();
        }),
        clear: vi.fn(),
      };
      const transfer = vi.fn(
        () =>
          new Promise<{
            bookmarkId: number;
            created: boolean;
            title: string;
          }>((resolve) => {
            setTimeout(() => {
              resolve({
                bookmarkId: 84,
                created: true,
                title: "Extracted article",
              });
            }, 5_000);
          }),
      );
      const job = createCaptureJob({
        accessToken: () => Promise.resolve("bca_memory"),
        capture: () => Promise.resolve(packageFixture()),
        notifyFailure: vi.fn(),
        store,
        transfer,
      });

      await job.startImport(supportedPage(), "https://reader.example");
      await vi.waitFor(() => {
        expect(transfer).toHaveBeenCalledOnce();
      });
      await expect(job.current()).resolves.toMatchObject({ phase: "sending" });

      await job.sourceLost(41);
      await vi.advanceTimersByTimeAsync(5_000);

      await expect(job.current()).resolves.toMatchObject({
        phase: "completed",
        outcome: "created",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("retains staged bytes when the fake clock expires a transfer", async () => {
    let timeout: (() => void) | undefined;
    let record: CaptureJobRecord | null = null;
    const notifyFailure = vi.fn().mockResolvedValue(undefined);
    const store: CaptureJobStore = {
      load: () => Promise.resolve(record),
      save: vi.fn((next: CaptureJobRecord) => {
        record = next;
        return Promise.resolve();
      }),
      clear: vi.fn(),
    };
    const transfer = vi.fn(() => new Promise<never>(() => {}));
    const job = createCaptureJob({
      accessToken: () => Promise.resolve("bca_memory"),
      capture: () => Promise.resolve(packageFixture()),
      clock: {
        clearTimeout: vi.fn(),
        setTimeout(task, milliseconds) {
          expect(milliseconds).toBe(120_000);
          timeout = task;
          return 17;
        },
      },
      notifyFailure,
      store,
      transfer,
    });
    await job.startImport(supportedPage(), "https://reader.example");
    await vi.waitFor(() => {
      expect(transfer).toHaveBeenCalledOnce();
    });

    timeout?.();

    await vi.waitFor(async () => {
      await expect(job.current()).resolves.toMatchObject({
        phase: "failed",
        message: "Increader did not respond before the transfer timed out.",
        retryable: true,
      });
    });
    expect(record).toMatchObject({
      phase: "failed",
      package: packageFixture(),
    });
    expect(notifyFailure).toHaveBeenCalledOnce();
  });

  it("serializes rapid duplicate Retry commands into one transfer", async () => {
    const staged = packageFixture();
    const transferResult = deferred<{
      bookmarkId: number;
      created: boolean;
      title: string;
    }>();
    let record: CaptureJobRecord | null = {
      phase: "failed",
      origin: "https://reader.example",
      package: staged,
      message: "network unavailable",
    };
    const store: CaptureJobStore = {
      load: () => Promise.resolve(record),
      save: vi.fn((next: CaptureJobRecord) => {
        record = next;
        return Promise.resolve();
      }),
      clear: vi.fn(),
    };
    const transfer = vi.fn(() => transferResult.promise);
    const accessToken = vi.fn().mockResolvedValue("bca_renewed");
    const job = createCaptureJob({
      accessToken,
      capture: vi.fn(),
      notifyFailure: vi.fn(),
      store,
      transfer,
    });
    await job.current();

    const first = job.retry();
    const duplicate = job.retry();
    await vi.waitFor(() => {
      expect(transfer).toHaveBeenCalledOnce();
    });
    transferResult.resolve({
      bookmarkId: 84,
      created: false,
      title: "Extracted article",
    });
    await Promise.all([first, duplicate]);

    expect(transfer).toHaveBeenCalledOnce();
    expect(accessToken).toHaveBeenCalledOnce();
    await expect(job.current()).resolves.toMatchObject({
      phase: "completed",
      outcome: "existing",
    });
  });

  it("keeps a transfer failure retryable when notification delivery fails", async () => {
    let record: CaptureJobRecord | null = null;
    const store: CaptureJobStore = {
      load: () => Promise.resolve(record),
      save: vi.fn((next: CaptureJobRecord) => {
        record = next;
        return Promise.resolve();
      }),
      clear: vi.fn(() => {
        record = null;
        return Promise.resolve();
      }),
    };
    const job = createCaptureJob({
      accessToken: () => Promise.resolve("bca_memory"),
      capture: () => Promise.resolve(packageFixture()),
      notifyFailure: vi
        .fn()
        .mockRejectedValue(new Error("notifications unavailable")),
      store,
      transfer: vi.fn().mockRejectedValue(new TypeError("network unavailable")),
    });

    await job.startImport(supportedPage(), "https://reader.example");

    await vi.waitFor(async () => {
      await expect(job.current()).resolves.toMatchObject({
        phase: "failed",
        message: "network unavailable",
        retryable: true,
      });
    });
    expect(record).toMatchObject({
      phase: "failed",
      package: packageFixture(),
    });
    expect(store.clear).not.toHaveBeenCalled();
  });

  it("uses one persisted attempt identity for a local capture failure notification", async () => {
    let record: CaptureJobRecord | null = null;
    const notifyFailure = vi.fn().mockResolvedValue(undefined);
    const store: CaptureJobStore = {
      load: () => Promise.resolve(record),
      save: vi.fn((next: CaptureJobRecord) => {
        record = next;
        return Promise.resolve();
      }),
      clear: vi.fn(),
    };
    const attemptId = "019bf66c-42ac-7c33-b57d-e2131af04fe8";
    const job = createCaptureJob({
      accessToken: () => Promise.resolve("bca_memory"),
      capture: () => Promise.reject(new Error("capture context closed")),
      notifyFailure,
      randomUuid: () => attemptId,
      store,
      transfer: vi.fn(),
    });

    await job.startImport(supportedPage(), "https://reader.example");

    await vi.waitFor(() => {
      expect(notifyFailure).toHaveBeenCalledWith(
        "capture context closed",
        attemptId,
      );
    });
    expect(record).toEqual({
      phase: "capture-failed",
      attemptId,
      message: "capture context closed",
    });
  });
});

function supportedPage(): Extract<ActivePageInspection, { kind: "supported" }> {
  return {
    kind: "supported",
    sourceUrl: "https://publisher.example/article",
    tabId: 41,
    title: "Publisher article",
  };
}

function packageFixture(): StagedCapturePackage {
  return {
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
      assets: [],
    },
    documentHtml: "<p>Article</p>",
    assetParts: [],
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
