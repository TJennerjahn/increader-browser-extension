import { describe, expect, it, vi } from "vitest";

import type { CaptureJob, CaptureJobState } from "../capture-job/capture-job";
import {
  createOriginBoundAccessToken,
  createCaptureFailureNotifier,
  createCaptureJobClient,
  registerCaptureJobRuntime,
  registerCaptureNotificationOpen,
} from "./capture-job-runtime";

describe.each(["Chrome", "Firefox"])("%s Capture Job popup runtime", () => {
  it("commands the background-owned job and restores broadcast state after reopening", async () => {
    const listeners = new Set<
      (
        message: unknown,
        sender: chrome.runtime.MessageSender,
        sendResponse: (response?: unknown) => void,
      ) => boolean | undefined
    >();
    const sendMessage = vi.fn(
      (message: unknown, callback?: (response: unknown) => void): undefined => {
        if (
          typeof message === "object" &&
          message !== null &&
          (message as Record<string, unknown>).target === "capture-job"
        ) {
          callback?.({ ok: true, value: { status: "started" } });
        }
        return undefined;
      },
    );
    const runtime = {
      lastError: undefined,
      onMessage: {
        addListener: (
          listener: (
            message: unknown,
            sender: chrome.runtime.MessageSender,
            sendResponse: (response?: unknown) => void,
          ) => boolean | undefined,
        ) => listeners.add(listener),
        removeListener: (
          listener: (
            message: unknown,
            sender: chrome.runtime.MessageSender,
            sendResponse: (response?: unknown) => void,
          ) => boolean | undefined,
        ) => listeners.delete(listener),
      },
      sendMessage,
    } as unknown as typeof chrome.runtime;
    vi.stubGlobal("chrome", { runtime });
    const client = createCaptureJobClient(runtime);
    const observed: CaptureJobState[] = [];
    const closePopup = client.observe((state) => observed.push(state));

    await expect(
      client.startImport(
        {
          kind: "supported",
          sourceUrl: "https://publisher.example/article",
          tabId: 41,
          title: "Publisher article",
        },
        "https://reader.example",
      ),
    ).resolves.toEqual({ status: "started" });

    const completed: CaptureJobState = {
      phase: "completed",
      captureId: "019bf66c-42ac-7c33-b57d-e2131af04fe9",
      outcome: "created",
      bookmarkId: 84,
      title: "Extracted article",
      origin: "https://reader.example",
    };
    emit(listeners, { target: "capture-job-state", state: completed });
    expect(observed).toEqual([completed]);

    closePopup();
    emit(listeners, {
      target: "capture-job-state",
      state: { phase: "failed", message: "ignored after closure" },
    });
    expect(observed).toEqual([completed]);
  });

  it("uses Firefox Promise messaging when callbacks are unavailable", async () => {
    const callbackSend = vi.fn();
    const runtime = {
      getURL: () => "moz-extension://browser-capture/",
      lastError: undefined,
      onMessage: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
      sendMessage: callbackSend,
    } as unknown as typeof chrome.runtime;
    const promiseSend = vi.fn().mockResolvedValue({
      ok: true,
      value: { phase: "ready" },
    });
    const client = createCaptureJobClient(runtime, {
      sendMessage: promiseSend,
    });

    await expect(client.current()).resolves.toEqual({ phase: "ready" });
    expect(promiseSend).toHaveBeenCalledWith({
      target: "capture-job",
      command: "current",
    });
    expect(callbackSend).not.toHaveBeenCalled();
  });

  it("broadcasts background lifecycle changes through Firefox Promise messaging", async () => {
    let publish: ((state: CaptureJobState) => void) | undefined;
    const job: CaptureJob = {
      current: () => Promise.resolve({ phase: "ready" }),
      startImport: vi.fn(),
      retry: vi.fn(),
      cancel: vi.fn(),
      discard: vi.fn(),
      sourceLost: vi.fn(),
      observe(listener) {
        publish = listener;
        return () => {
          publish = undefined;
        };
      },
    };
    const callbackSend = vi.fn();
    const runtime = {
      lastError: undefined,
      onMessage: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
      sendMessage: callbackSend,
    } as unknown as typeof chrome.runtime;
    const event = {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    };
    const tabs = {
      onRemoved: event,
      onUpdated: event,
    } as unknown as typeof chrome.tabs;
    const action = {
      setBadgeText: vi.fn().mockResolvedValue(undefined),
      setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
      setTitle: vi.fn().mockResolvedValue(undefined),
    } as unknown as typeof chrome.action;
    const promiseSend = vi.fn().mockResolvedValue(undefined);
    const unregister = registerCaptureJobRuntime(job, runtime, tabs, action, {
      sendMessage: promiseSend,
    });
    const completed: CaptureJobState = {
      phase: "completed",
      captureId: "019bf66c-42ac-7c33-b57d-e2131af04fe9",
      outcome: "created",
      bookmarkId: 84,
      title: "Extracted article",
      origin: "https://reader.example",
    };

    publish?.(completed);

    await vi.waitFor(() => {
      expect(promiseSend).toHaveBeenCalledWith({
        target: "capture-job-state",
        state: completed,
      });
    });
    expect(callbackSend).not.toHaveBeenCalled();
    unregister();
  });

  it("emits one replaceable action-required notification and opens the utility", async () => {
    const clicked = new Set<(notificationId: string) => void>();
    const create = vi.fn(
      (
        notificationId: string,
        _options: chrome.notifications.NotificationOptions,
        done?: (createdId: string) => void,
      ) => {
        done?.(notificationId);
      },
    );
    const notifications = {
      create,
      onClicked: {
        addListener: (listener: (notificationId: string) => void) =>
          clicked.add(listener),
        removeListener: (listener: (notificationId: string) => void) =>
          clicked.delete(listener),
      },
    } as unknown as typeof chrome.notifications;
    const openPopup = vi.fn().mockResolvedValue(undefined);
    const action = { openPopup } as unknown as typeof chrome.action;
    vi.stubGlobal("chrome", {
      runtime: {
        getURL: (path: string) => `chrome-extension://test/${path}`,
        lastError: undefined,
      },
    });
    const notify = createCaptureFailureNotifier(notifications);
    const unregister = registerCaptureNotificationOpen(notifications, action);

    await notify(
      "The previous transfer was interrupted.",
      "019bf66c-42ac-7c33-b57d-e2131af04fe9",
    );

    expect(create).toHaveBeenCalledWith(
      "browser-capture-failure-019bf66c-42ac-7c33-b57d-e2131af04fe9",
      expect.objectContaining({
        title: "Increader needs attention",
        message: "The previous transfer was interrupted.",
        requireInteraction: true,
      }),
      expect.any(Function),
    );
    for (const listener of clicked) {
      listener("browser-capture-failure-019bf66c-42ac-7c33-b57d-e2131af04fe9");
    }
    expect(openPopup).toHaveBeenCalledOnce();

    unregister();
    expect(clicked).toHaveLength(0);
  });

  it("never sends a token from a replacement authentication to the staged origin", async () => {
    const accessToken = vi.fn().mockResolvedValue("session_wrong_origin");
    const tokenForOrigin = createOriginBoundAccessToken({
      accessToken,
      currentOrigin: () =>
        Promise.resolve("https://replacement-reader.example"),
    });

    await expect(
      tokenForOrigin("https://original-reader.example"),
    ).rejects.toThrow(
      "Sign in to this Capture Package's Increader instance before Retry.",
    );
    expect(accessToken).not.toHaveBeenCalled();
  });

  it("maps tab loss to the job and broadcasts lifecycle icon state", async () => {
    const runtimeListeners = new Set<
      (
        message: unknown,
        sender: chrome.runtime.MessageSender,
        sendResponse: (response?: unknown) => void,
      ) => boolean | undefined
    >();
    const removedListeners = new Set<(tabId: number) => void>();
    const updatedListeners = new Set<
      (tabId: number, change: chrome.tabs.OnUpdatedInfo) => void
    >();
    const sentMessages: unknown[] = [];
    const sendMessage = vi.fn(
      (message: unknown, done?: () => void): undefined => {
        sentMessages.push(message);
        done?.();
        return undefined;
      },
    );
    const runtime = {
      lastError: undefined,
      onMessage: {
        addListener: (
          listener: typeof runtimeListeners extends Set<infer T> ? T : never,
        ) => runtimeListeners.add(listener),
        removeListener: (
          listener: typeof runtimeListeners extends Set<infer T> ? T : never,
        ) => runtimeListeners.delete(listener),
      },
      sendMessage,
    } as unknown as typeof chrome.runtime;
    const tabs = {
      onRemoved: {
        addListener: (listener: (tabId: number) => void) =>
          removedListeners.add(listener),
        removeListener: (listener: (tabId: number) => void) =>
          removedListeners.delete(listener),
      },
      onUpdated: {
        addListener: (
          listener: (tabId: number, change: chrome.tabs.OnUpdatedInfo) => void,
        ) => updatedListeners.add(listener),
        removeListener: (
          listener: (tabId: number, change: chrome.tabs.OnUpdatedInfo) => void,
        ) => updatedListeners.delete(listener),
      },
    } as unknown as typeof chrome.tabs;
    const setBadgeText = vi.fn().mockResolvedValue(undefined);
    const setBadgeBackgroundColor = vi.fn().mockResolvedValue(undefined);
    const setTitle = vi.fn().mockResolvedValue(undefined);
    const action = {
      setBadgeText,
      setBadgeBackgroundColor,
      setTitle,
    } as unknown as typeof chrome.action;
    const sourceLost = vi.fn().mockResolvedValue(undefined);
    let publish: ((state: CaptureJobState) => void) | undefined;
    const job: CaptureJob = {
      current: () =>
        Promise.resolve({
          phase: "sending",
          captureId: "019bf66c-42ac-7c33-b57d-e2131af04fe9",
        }),
      startImport: vi.fn(),
      retry: vi.fn(),
      cancel: vi.fn(),
      discard: vi.fn(),
      sourceLost,
      observe(listener) {
        publish = listener;
        listener({
          phase: "capturing",
          page: {
            kind: "supported",
            sourceUrl: "https://publisher.example/article",
            tabId: 41,
            title: "Publisher article",
          },
          completedAssets: 2,
          totalAssets: 5,
        });
        return () => {
          publish = undefined;
        };
      },
    };

    const unregister = registerCaptureJobRuntime(job, runtime, tabs, action);
    await vi.waitFor(() => {
      expect(setTitle).toHaveBeenCalledWith({ title: "Sending to Increader" });
    });
    publish?.({
      phase: "completed",
      captureId: "019bf66c-42ac-7c33-b57d-e2131af04fe9",
      outcome: "created",
      bookmarkId: 84,
      title: "Extracted article",
      origin: "https://reader.example",
    });
    publish?.({
      phase: "failed",
      captureId: "019bf66c-42ac-7c33-b57d-e2131af04fe9",
      message: "network unavailable",
      retryable: true,
    });
    for (const listener of removedListeners) listener(41);
    for (const listener of updatedListeners) {
      listener(42, { url: "https://publisher.example/next" });
      listener(43, { status: "complete" });
    }

    expect(sourceLost).toHaveBeenCalledTimes(2);
    expect(sourceLost).toHaveBeenNthCalledWith(1, 41);
    expect(sourceLost).toHaveBeenNthCalledWith(2, 42);
    expect(setBadgeText.mock.calls).toEqual(
      expect.arrayContaining([
        [{ text: "2" }],
        [{ text: "↑" }],
        [{ text: "" }],
        [{ text: "!" }],
      ]),
    );
    expect(setBadgeText).not.toHaveBeenCalledWith({ text: "✓" });
    expect(
      sentMessages.some(
        (message) =>
          typeof message === "object" &&
          message !== null &&
          (message as Record<string, unknown>).target === "capture-job-state" &&
          typeof (message as Record<string, unknown>).state === "object" &&
          (
            (message as Record<string, unknown>).state as Record<
              string,
              unknown
            >
          ).phase === "completed",
      ),
    ).toBe(true);

    unregister();
    expect(runtimeListeners).toHaveLength(0);
    expect(removedListeners).toHaveLength(0);
    expect(updatedListeners).toHaveLength(0);
  });
});

function emit(
  listeners: Set<
    (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => boolean | undefined
  >,
  message: unknown,
): void {
  for (const listener of listeners) {
    listener(message, {}, () => undefined);
  }
}
