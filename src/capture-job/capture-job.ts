import type { ActivePageInspection } from "../browser/active-page";
import type { StagedCapturePackage } from "../capture-package/capture-package";
import type { CapturePackageOutcome } from "../protocol/capture-package-http";

type SupportedPage = Extract<ActivePageInspection, { kind: "supported" }>;

export type CaptureJobState =
  | { phase: "ready"; notice?: string }
  | {
      phase: "capturing";
      page: SupportedPage;
      completedAssets: number;
      totalAssets?: number;
    }
  | { phase: "sending"; captureId: string }
  | {
      phase: "completed";
      captureId: string;
      outcome: "created" | "existing";
      bookmarkId: number;
      title: string;
      origin: string;
    }
  | {
      phase: "failed";
      captureId: string | null;
      message: string;
      retryable: boolean;
    };

export type CaptureJobRecord =
  | {
      phase: "capturing";
      attemptId: string;
      page: SupportedPage;
      origin: string;
    }
  | {
      phase: "capture-failed";
      attemptId: string;
      message: string;
    }
  | {
      phase: "staged" | "sending";
      origin: string;
      package: StagedCapturePackage;
    }
  | {
      phase: "failed";
      origin: string;
      package: StagedCapturePackage;
      message: string;
    }
  | Extract<CaptureJobState, { phase: "completed" }>;

export interface CaptureJobStore {
  load: () => Promise<CaptureJobRecord | null>;
  save: (record: CaptureJobRecord) => Promise<void>;
  clear: () => Promise<void>;
}

export interface CaptureProgress {
  completedAssets: number;
  totalAssets?: number;
}

export interface CaptureJob {
  current: () => Promise<CaptureJobState>;
  startImport: (
    page: SupportedPage,
    origin: string,
    replaceExisting?: boolean,
  ) => Promise<{ status: "started" | "replacement-required" }>;
  retry: () => Promise<void>;
  cancel: () => Promise<void>;
  discard: () => Promise<void>;
  sourceLost: (tabId: number) => Promise<void>;
  observe: (listener: (state: CaptureJobState) => void) => () => void;
}

interface CaptureJobDependencies {
  accessToken: (origin: string) => Promise<string>;
  capture: (
    page: SupportedPage,
    progress: (value: CaptureProgress) => void,
    signal: AbortSignal,
  ) => Promise<StagedCapturePackage>;
  transfer: (
    origin: string,
    accessToken: string,
    staged: StagedCapturePackage,
    signal: AbortSignal,
  ) => Promise<CapturePackageOutcome>;
  store: CaptureJobStore;
  notifyFailure: (message: string, notificationId: string) => Promise<void>;
  clock?: CaptureJobClock;
  randomUuid?: () => string;
}

export interface CaptureJobClock {
  setTimeout: (task: () => void, milliseconds: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export function createCaptureJob({
  accessToken,
  capture,
  clock = {
    setTimeout: (task, milliseconds) =>
      globalThis.setTimeout(task, milliseconds),
    clearTimeout: (handle) => {
      globalThis.clearTimeout(
        handle as ReturnType<typeof globalThis.setTimeout>,
      );
    },
  },
  notifyFailure,
  randomUuid = () => globalThis.crypto.randomUUID(),
  store,
  transfer,
}: CaptureJobDependencies): CaptureJob {
  let state: CaptureJobState = { phase: "ready" };
  let restored = false;
  let restorePromise: Promise<void> | null = null;
  let captureGeneration = 0;
  let captureAbort: AbortController | null = null;
  let activeAttemptId: string | null = null;
  let authoritativeRecord: CaptureJobRecord | null = null;
  let commandTail: Promise<void> = Promise.resolve();
  const listeners = new Set<(value: CaptureJobState) => void>();

  const runExclusive = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = commandTail.then(operation, operation);
    commandTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const publish = (next: CaptureJobState): void => {
    state = next;
    for (const listener of listeners) listener(next);
  };

  const bestEffortNotification = async (
    message: string,
    notificationId: string,
  ): Promise<void> => {
    try {
      await notifyFailure(message, notificationId);
    } catch {
      // Notification delivery never changes a durable Capture Outcome.
    }
  };

  const persist = async (record: CaptureJobRecord | null): Promise<void> => {
    authoritativeRecord = record;
    if (record === null) {
      await store.clear();
    } else {
      await store.save(record);
    }
  };

  const restoreAuthoritativeRecord = async (): Promise<void> => {
    if (authoritativeRecord === null) {
      await store.clear();
    } else {
      await store.save(authoritativeRecord);
    }
  };

  const ensureRestored = async (): Promise<void> => {
    if (restored) return;
    if (restorePromise === null) {
      restorePromise = store.load().then(async (record) => {
        restored = true;
        authoritativeRecord = record;
        if (record === null) return;
        if (record.phase === "completed") {
          state = record;
          return;
        }
        if (record.phase === "capturing") {
          const message =
            "The page changed or closed during capture. Choose Import again.";
          await persist({
            phase: "capture-failed",
            attemptId: record.attemptId,
            message,
          });
          state = captureFailureState(message);
          await bestEffortNotification(message, record.attemptId);
          return;
        }
        if (record.phase === "capture-failed") {
          state = captureFailureState(record.message);
          return;
        }
        if (record.phase === "failed") {
          state = {
            phase: "failed",
            captureId: record.package.manifest.captureId,
            message: record.message,
            retryable: true,
          };
          return;
        }
        const message =
          "The previous transfer was interrupted. Retry the same Capture Package.";
        const failed: CaptureJobRecord = {
          phase: "failed",
          origin: record.origin,
          package: record.package,
          message,
        };
        await persist(failed);
        state = {
          phase: "failed",
          captureId: record.package.manifest.captureId,
          message,
          retryable: true,
        };
        await bestEffortNotification(
          message,
          record.package.manifest.captureId,
        );
      });
    }
    await restorePromise;
  };

  const send = async (
    origin: string,
    staged: StagedCapturePackage,
  ): Promise<void> => {
    await persist({ phase: "sending", origin, package: staged });
    publish({ phase: "sending", captureId: staged.manifest.captureId });
    const transferAbort = new AbortController();
    let timeoutHandle: unknown;
    try {
      const token = await accessToken(origin);
      const timeout = new Promise<never>((_resolve, reject) => {
        timeoutHandle = clock.setTimeout(() => {
          transferAbort.abort();
          reject(
            new Error(
              "Increader did not respond before the transfer timed out.",
            ),
          );
        }, 120_000);
      });
      const result = await Promise.race([
        transfer(origin, token, staged, transferAbort.signal),
        timeout,
      ]);
      const completed: Extract<CaptureJobState, { phase: "completed" }> = {
        phase: "completed",
        captureId: staged.manifest.captureId,
        outcome: result.created ? "created" : "existing",
        bookmarkId: result.bookmarkId,
        title: result.title,
        origin,
      };
      await persist(completed);
      publish(completed);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Increader could not import this Capture Package.";
      await persist({ phase: "failed", origin, package: staged, message });
      publish({
        phase: "failed",
        captureId: staged.manifest.captureId,
        message,
        retryable: true,
      });
      await bestEffortNotification(message, staged.manifest.captureId);
    } finally {
      clock.clearTimeout(timeoutHandle);
    }
  };

  const stopCapture = async (): Promise<void> => {
    captureGeneration += 1;
    captureAbort?.abort();
    captureAbort = null;
    activeAttemptId = null;
    await persist(null);
    publish({ phase: "ready" });
  };

  const failCapture = async (message: string): Promise<void> => {
    const attemptId = activeAttemptId;
    captureGeneration += 1;
    captureAbort?.abort();
    captureAbort = null;
    activeAttemptId = null;
    if (attemptId === null) return;
    await persist({ phase: "capture-failed", attemptId, message });
    publish(captureFailureState(message));
    await bestEffortNotification(message, attemptId);
  };

  return {
    async current() {
      await ensureRestored();
      return state;
    },

    startImport(page, origin, replaceExisting = false) {
      return runExclusive(async () => {
        await ensureRestored();
        if (state.phase === "failed" && state.retryable && !replaceExisting) {
          return { status: "replacement-required" };
        }
        if (state.phase === "failed" && state.retryable) {
          await persist(null);
        }
        const generation = ++captureGeneration;
        const attemptId = randomUuid();
        activeAttemptId = attemptId;
        captureAbort?.abort();
        captureAbort = new AbortController();
        await persist({ phase: "capturing", attemptId, page, origin });
        publish({
          phase: "capturing",
          page,
          completedAssets: 0,
        });
        void capture(
          page,
          (progress) => {
            if (generation !== captureGeneration) return;
            publish({ phase: "capturing", page, ...progress });
          },
          captureAbort.signal,
        )
          .then(async (staged) => {
            if (generation !== captureGeneration) return;
            const stagedRecord: CaptureJobRecord = {
              phase: "staged",
              origin,
              package: staged,
            };
            await store.save(stagedRecord);
            if (generation !== captureGeneration) {
              await restoreAuthoritativeRecord();
              return;
            }
            authoritativeRecord = stagedRecord;
            captureAbort = null;
            activeAttemptId = null;
            publish({ phase: "sending", captureId: staged.manifest.captureId });
            await send(origin, staged);
          })
          .catch(async (error: unknown) => {
            if (generation !== captureGeneration) return;
            const message =
              error instanceof Error
                ? error.message
                : "The active page could not be captured.";
            activeAttemptId = null;
            await persist({ phase: "capture-failed", attemptId, message });
            publish(captureFailureState(message));
            await bestEffortNotification(message, attemptId);
          });
        return { status: "started" };
      });
    },

    retry() {
      return runExclusive(async () => {
        await ensureRestored();
        const record = await store.load();
        if (record?.phase !== "failed") return;
        await send(record.origin, record.package);
      });
    },

    cancel() {
      return runExclusive(async () => {
        await ensureRestored();
        if (state.phase === "capturing") {
          await stopCapture();
        }
      });
    },

    discard() {
      return runExclusive(async () => {
        await ensureRestored();
        if (state.phase === "failed" && state.retryable) {
          await persist(null);
          publish({ phase: "ready" });
        }
      });
    },

    sourceLost(tabId) {
      return runExclusive(async () => {
        await ensureRestored();
        if (state.phase === "capturing" && state.page.tabId === tabId) {
          await failCapture(
            "The page changed or closed during capture. Choose Import again.",
          );
        }
      });
    },

    observe(listener) {
      listeners.add(listener);
      listener(state);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function captureFailureState(
  message: string,
): Extract<CaptureJobState, { phase: "failed" }> {
  return {
    phase: "failed",
    captureId: null,
    message,
    retryable: false,
  };
}
