import type { CaptureJob, CaptureJobState } from "../capture-job/capture-job";
import type { ActivePageInspection } from "./active-page";

type SupportedPage = Extract<ActivePageInspection, { kind: "supported" }>;

interface RuntimeCommand {
  target: "capture-job";
  command: "current" | "start" | "retry" | "cancel" | "discard";
  page?: SupportedPage;
  origin?: string;
  replaceExisting?: boolean;
}

interface RuntimeStateMessage {
  target: "capture-job-state";
  state: CaptureJobState;
}

interface RuntimeResponse {
  ok: boolean;
  value?: unknown;
  message?: string;
}

export type CaptureJobClient = Pick<
  CaptureJob,
  "current" | "startImport" | "retry" | "cancel" | "discard" | "observe"
>;

export function createCaptureJobClient(
  runtime: typeof chrome.runtime = chrome.runtime,
  promiseRuntime: PromiseRuntimeApi | undefined = firefoxRuntimeApi(runtime),
): CaptureJobClient {
  return {
    current: () =>
      command<CaptureJobState>(runtime, promiseRuntime, {
        command: "current",
      }),
    startImport: (page, origin, replaceExisting = false) =>
      command(runtime, promiseRuntime, {
        command: "start",
        page,
        origin,
        replaceExisting,
      }),
    retry: () => command(runtime, promiseRuntime, { command: "retry" }),
    cancel: () => command(runtime, promiseRuntime, { command: "cancel" }),
    discard: () => command(runtime, promiseRuntime, { command: "discard" }),
    observe(listener) {
      const onMessage = (message: unknown): boolean => {
        if (isStateMessage(message)) {
          listener(message.state);
        }
        return false;
      };
      runtime.onMessage.addListener(onMessage);
      return () => {
        runtime.onMessage.removeListener(onMessage);
      };
    },
  };
}

export function registerCaptureJobRuntime(
  job: CaptureJob,
  runtime: typeof chrome.runtime = chrome.runtime,
  tabs: typeof chrome.tabs = chrome.tabs,
  action: typeof chrome.action = chrome.action,
  promiseRuntime: PromiseRuntimeApi | undefined = firefoxRuntimeApi(runtime),
): () => void {
  const broadcast = (state: CaptureJobState): void => {
    updateAction(action, state);
    const message = {
      target: "capture-job-state",
      state,
    } satisfies RuntimeStateMessage;
    if (promiseRuntime !== undefined) {
      void promiseRuntime.sendMessage(message).catch(() => undefined);
      return;
    }
    try {
      runtime.sendMessage(message, () => {
        // A closed popup is the ordinary case. Reading lastError prevents a
        // rejected callback warning without changing the background job.
        void runtime.lastError;
      });
    } catch {
      // A missing popup receiver never changes Capture Job ownership.
    }
  };
  const stopObserving = job.observe(broadcast);
  void job.current().then(broadcast);

  const onMessage = (
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: RuntimeResponse) => void,
  ): boolean => {
    if (!isRuntimeCommand(message)) return false;
    void runCommand(job, message).then(
      (value) => {
        sendResponse({ ok: true, value });
      },
      (error: unknown) => {
        sendResponse({
          ok: false,
          message:
            error instanceof Error
              ? error.message
              : "Browser Capture could not complete that action.",
        });
      },
    );
    return true;
  };
  runtime.onMessage.addListener(onMessage);

  const onRemoved = (tabId: number): void => {
    void job.sourceLost(tabId);
  };
  const onUpdated = (
    tabId: number,
    change: chrome.tabs.OnUpdatedInfo,
  ): void => {
    if (change.url !== undefined) {
      void job.sourceLost(tabId);
    }
  };
  tabs.onRemoved.addListener(onRemoved);
  tabs.onUpdated.addListener(onUpdated);

  return () => {
    stopObserving();
    runtime.onMessage.removeListener(onMessage);
    tabs.onRemoved.removeListener(onRemoved);
    tabs.onUpdated.removeListener(onUpdated);
  };
}

export function createCaptureFailureNotifier(
  notifications: typeof chrome.notifications = chrome.notifications,
): (message: string, notificationId: string) => Promise<void> {
  return (message, notificationId) =>
    new Promise((resolve, reject) => {
      notifications.create(
        `browser-capture-failure-${notificationId}`,
        {
          type: "basic",
          iconUrl: chrome.runtime.getURL("notification.svg"),
          title: "Browser Capture needs attention",
          message,
          requireInteraction: true,
        },
        () => {
          const error = chrome.runtime.lastError;
          if (error === undefined) {
            resolve();
          } else {
            reject(new Error(error.message));
          }
        },
      );
    });
}

export function createOriginBoundAccessToken(authentication: {
  currentOrigin(): Promise<string | null>;
  accessToken(): Promise<string>;
}): (origin: string) => Promise<string> {
  return async (origin) => {
    if ((await authentication.currentOrigin()) !== origin) {
      throw new Error(
        "Sign in to this Capture Package's Increader instance before Retry.",
      );
    }
    return authentication.accessToken();
  };
}

export function registerCaptureNotificationOpen(
  notifications: typeof chrome.notifications = chrome.notifications,
  action: typeof chrome.action = chrome.action,
): () => void {
  const onClicked = (notificationId: string): void => {
    if (!notificationId.startsWith("browser-capture-failure-")) return;
    void action.openPopup().catch(() => undefined);
  };
  notifications.onClicked.addListener(onClicked);
  return () => {
    notifications.onClicked.removeListener(onClicked);
  };
}

async function runCommand(
  job: CaptureJob,
  message: RuntimeCommand,
): Promise<unknown> {
  switch (message.command) {
    case "current":
      return job.current();
    case "start":
      if (
        message.page === undefined ||
        message.origin === undefined ||
        !isSupportedPage(message.page)
      ) {
        throw new Error("The current page is not ready to import.");
      }
      return job.startImport(
        message.page,
        message.origin,
        message.replaceExisting,
      );
    case "retry":
      return job.retry();
    case "cancel":
      return job.cancel();
    case "discard":
      return job.discard();
  }
}

function command<T>(
  runtime: typeof chrome.runtime,
  promiseRuntime: PromiseRuntimeApi | undefined,
  message: Omit<RuntimeCommand, "target">,
): Promise<T> {
  const request = {
    target: "capture-job",
    ...message,
  } satisfies RuntimeCommand;
  if (promiseRuntime !== undefined) {
    return promiseRuntime
      .sendMessage(request)
      .then((response) => readResponse(response) as T);
  }
  return new Promise((resolve, reject) => {
    runtime.sendMessage(request, (response: RuntimeResponse | undefined) => {
      const runtimeError = runtime.lastError;
      if (runtimeError !== undefined) {
        reject(new Error(runtimeError.message));
        return;
      }
      try {
        resolve(readResponse(response) as T);
      } catch (error) {
        reject(
          error instanceof Error
            ? error
            : new Error(
                "The Browser Capture background response was invalid.",
                {
                  cause: error,
                },
              ),
        );
      }
    });
  });
}

interface PromiseRuntimeApi {
  sendMessage(message: unknown): Promise<RuntimeResponse | undefined>;
}

function firefoxRuntimeApi(
  runtime: typeof chrome.runtime,
): PromiseRuntimeApi | undefined {
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
      browser?: { runtime?: PromiseRuntimeApi };
    }
  ).browser?.runtime;
}

function readResponse(response: RuntimeResponse | undefined): unknown {
  if (response?.ok !== true) {
    throw new Error(
      response?.message ?? "The Browser Capture background is unavailable.",
    );
  }
  return response.value;
}

function isRuntimeCommand(value: unknown): value is RuntimeCommand {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.target === "capture-job" &&
    (candidate.command === "current" ||
      candidate.command === "start" ||
      candidate.command === "retry" ||
      candidate.command === "cancel" ||
      candidate.command === "discard")
  );
}

function isStateMessage(value: unknown): value is RuntimeStateMessage {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.target === "capture-job-state" &&
    candidate.state !== null &&
    typeof candidate.state === "object"
  );
}

function isSupportedPage(value: unknown): value is SupportedPage {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.kind === "supported" &&
    typeof candidate.sourceUrl === "string" &&
    typeof candidate.tabId === "number" &&
    typeof candidate.title === "string"
  );
}

function updateAction(
  action: typeof chrome.action,
  state: CaptureJobState,
): void {
  const presentation =
    state.phase === "capturing"
      ? {
          badge:
            state.totalAssets === undefined
              ? "…"
              : String(state.completedAssets),
          color: "#2563eb",
          title: "Capturing page",
        }
      : state.phase === "sending"
        ? { badge: "↑", color: "#2563eb", title: "Sending to Increader" }
        : state.phase === "completed"
          ? { badge: "✓", color: "#15803d", title: "Imported to Increader" }
          : state.phase === "failed"
            ? { badge: "!", color: "#b91c1c", title: "Needs attention" }
            : { badge: "", color: "#64748b", title: "Browser Capture" };
  void action.setBadgeText({ text: presentation.badge }).catch(() => undefined);
  void action
    .setBadgeBackgroundColor({ color: presentation.color })
    .catch(() => undefined);
  void action.setTitle({ title: presentation.title }).catch(() => undefined);
}
