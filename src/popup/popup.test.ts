// @vitest-environment jsdom

import {
  fireEvent,
  getByLabelText,
  getByRole,
  getByText,
} from "@testing-library/dom";
import { describe, expect, it, vi } from "vitest";

import {
  CLOUD_INSTANCE_ORIGIN,
  type Authentication,
} from "../auth/authentication";
import type {
  ActivePageInspection,
  ActivePageInspector,
} from "../browser/active-page";
import type { BookmarkLookupClient } from "../protocol/bookmark-lookup-http";
import type { CaptureJobClient } from "../browser/capture-job-runtime";
import { mountPopup } from "./popup";

describe("compact Browser Capture popup", () => {
  it("starts signed out and signs in with the normal account form", async () => {
    const signIn = vi.fn().mockResolvedValue({
      displayName: "reader@example.com",
      email: "reader@example.com",
      origin: CLOUD_INSTANCE_ORIGIN,
    });
    const authentication: Authentication = {
      accessToken: () => Promise.reject(new Error("not signed in")),
      current: () => Promise.resolve(null),
      currentOrigin: () => Promise.resolve(null),
      signIn,
      signOut: () => Promise.resolve(),
    };
    const root = document.createElement("main");

    mountPopup(root, authentication);

    expect(getByText(root, "Browser Capture")).toBeTruthy();
    expect(getByText(root, "Signed out")).toBeTruthy();
    expect(getByText(root, "Connection settings")).toBeTruthy();
    expect(
      getByRole<HTMLInputElement>(root, "textbox", {
        name: "Increader instance origin",
      }).value,
    ).toBe(CLOUD_INSTANCE_ORIGIN);
    expect(
      root.querySelector<HTMLElement>("[data-settings-view]")?.hidden,
    ).toBe(false);
    expect(root.querySelector<HTMLElement>("[data-main-view]")?.hidden).toBe(
      true,
    );
    expect(root.querySelector<HTMLButtonElement>("[data-view-toggle]")?.hidden).toBe(
      true,
    );

    fireEvent.input(
      getByRole<HTMLInputElement>(root, "textbox", { name: "Email" }),
      { target: { value: "reader@example.com" } },
    );
    fireEvent.input(getByLabelText<HTMLInputElement>(root, "Password"), {
      target: { value: "secret" },
    });
    const form = getByRole(root, "button", { name: "Sign in" }).closest("form");
    expect(form).not.toBeNull();
    if (form === null) return;
    fireEvent.submit(form);
    await vi.waitFor(() => {
      expect(signIn).toHaveBeenCalledWith(
        CLOUD_INSTANCE_ORIGIN,
        "reader@example.com",
        "secret",
      );
      expect(getByText(root, "Signed in")).toBeTruthy();
      expect(root.querySelector<HTMLElement>("[data-main-view]")?.hidden).toBe(
        false,
      );
    });
  });

  it("signs in to a normalized self-hosted origin and remembers it", async () => {
    const authentication = signedOut();
    const signIn = vi
      .spyOn(authentication, "signIn")
      .mockResolvedValue({
        displayName: "reader@example.com",
        email: "reader@example.com",
        origin: "https://reader.example",
      });
    const save = vi.fn().mockResolvedValue(undefined);
    const root = document.createElement("main");
    mountPopup(root, authentication, undefined, {
      load: () => Promise.resolve(null),
      save,
    });
    fireEvent.input(getByRole<HTMLInputElement>(root, "textbox", {
      name: "Increader instance origin",
    }), { target: { value: "https://reader.example/" } });
    fireEvent.input(
      getByRole<HTMLInputElement>(root, "textbox", { name: "Email" }),
      { target: { value: "reader@example.com" } },
    );
    fireEvent.input(getByLabelText<HTMLInputElement>(root, "Password"), {
      target: { value: "secret" },
    });
    const form = getByRole(root, "button", { name: "Sign in" }).closest("form");
    expect(form).not.toBeNull();
    if (form === null) return;
    fireEvent.submit(form);

    await vi.waitFor(() => {
      expect(signIn).toHaveBeenCalledWith(
        "https://reader.example",
        "reader@example.com",
        "secret",
      );
      expect(save).toHaveBeenCalledWith("https://reader.example");
    });
  });

  it("shows an authenticated supported page as Ready without authorizing Import", async () => {
    const page: ActivePageInspection = {
      faviconUrl: "https://example.com/favicon.ico",
      kind: "supported",
      sourceUrl: "https://example.com/article?view=full",
      tabId: 19,
      title: "Observed Article",
    };
    const activePage = inspector(page);
    const lookupCall = vi.fn().mockResolvedValue({ exists: false });
    const lookup: BookmarkLookupClient = { lookup: lookupCall };
    const root = document.createElement("main");
    const importAuthorized = vi.fn();
    root.addEventListener("browser-capture-import", importAuthorized);

    mountPopup(root, authenticated(), {
      activePage,
      lookup,
      openReader: vi.fn(),
    });

    await vi.waitFor(() => {
      expect(getByText(root, "Observed Article")).toBeTruthy();
      expect(
        getByText(root, "https://example.com/article?view=full"),
      ).toBeTruthy();
      expect(getByText(root, "Ready")).toBeTruthy();
    });
    expect(lookupCall).toHaveBeenCalledWith(
      "https://reader.example",
      "session_memory",
      "https://example.com/article?view=full",
    );
    expect(importAuthorized).not.toHaveBeenCalled();
    expect(
      getByRole<HTMLButtonElement>(root, "button", { name: "Import" }).disabled,
    ).toBe(false);
    const favicon =
      root.querySelector<HTMLImageElement>("[data-page-favicon]");
    expect(favicon?.src).toBe("https://example.com/favicon.ico");
    expect(favicon?.hidden).toBe(false);
    const pageCard = root.querySelector("[data-page-card]");
    const pageActions = root.querySelector(".page-actions");
    expect(pageCard?.contains(pageActions)).toBe(false);
    expect(pageActions?.parentElement).toBe(
      root.querySelector("[data-main-view]"),
    );
    if (favicon === null) return;
    fireEvent.error(favicon);
    expect(favicon.hidden).toBe(true);
    expect(
      root
        .querySelector("[data-page-favicon-fallback]")
        ?.hasAttribute("hidden"),
    ).toBe(false);
  });

  it("offers an existing owned Bookmark without opening Reader automatically", async () => {
    const openReader = vi.fn().mockResolvedValue(undefined);
    const root = document.createElement("main");

    mountPopup(root, authenticated(), {
      activePage: inspector({
        kind: "supported",
        sourceUrl: "https://example.com/saved",
        tabId: 20,
        title: "Saved Article",
      }),
      lookup: {
        lookup: vi.fn().mockResolvedValue({
          bookmarkId: 42,
          exists: true,
          title: "My Saved Title",
        }),
      },
      openReader,
    });

    await vi.waitFor(() => {
      expect(getByText(root, "Already in Increader")).toBeTruthy();
      expect(getByText(root, "My Saved Title")).toBeTruthy();
    });
    expect(openReader).not.toHaveBeenCalled();

    fireEvent.click(getByRole(root, "button", { name: "Open Reader" }));

    expect(openReader).toHaveBeenCalledWith(
      "https://reader.example/bookmarks/42",
    );
  });

  it("surfaces an explicit Open Reader failure", async () => {
    const root = document.createElement("main");
    mountPopup(root, authenticated(), {
      activePage: inspector({
        kind: "supported",
        sourceUrl: "https://example.com/saved",
        tabId: 20,
        title: "Saved Article",
      }),
      lookup: {
        lookup: vi.fn().mockResolvedValue({
          bookmarkId: 42,
          exists: true,
          title: "My Saved Title",
        }),
      },
      openReader: vi.fn().mockRejectedValue(new Error("tabs.create failed")),
    });
    await vi.waitFor(() => {
      expect(getByText(root, "Already in Increader")).toBeTruthy();
    });

    fireEvent.click(getByRole(root, "button", { name: "Open Reader" }));

    await vi.waitFor(() => {
      expect(getByText(root, "Could not open Reader")).toBeTruthy();
    });
  });

  it("keeps unsupported pages out of lookup and unable to Import", async () => {
    const lookup = vi.fn();
    const root = document.createElement("main");

    mountPopup(root, authenticated(), {
      activePage: inspector({
        kind: "unsupported",
        reason: "PDF pages cannot be imported.",
      }),
      lookup: { lookup },
      openReader: vi.fn(),
    });

    await vi.waitFor(() => {
      expect(getByText(root, "Unsupported")).toBeTruthy();
      expect(getByText(root, "PDF pages cannot be imported.")).toBeTruthy();
    });
    expect(lookup).not.toHaveBeenCalled();
    expect(
      getByRole<HTMLButtonElement>(root, "button", { name: "Import" }).disabled,
    ).toBe(true);
  });

  it("requires another Import click when the active source changes", async () => {
    const first: ActivePageInspection = {
      kind: "supported",
      sourceUrl: "https://one.example/article",
      tabId: 21,
      title: "First Article",
    };
    const second: ActivePageInspection = {
      kind: "supported",
      sourceUrl: "https://two.example/article",
      tabId: 22,
      title: "Second Article",
    };
    let refresh: (() => void) | undefined;
    const inspect = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)
      .mockResolvedValue(second);
    const activePage: ActivePageInspector = {
      inspect,
      observe(listener) {
        refresh = listener;
        return () => {
          refresh = undefined;
        };
      },
    };
    const root = document.createElement("main");
    const authorized: ActivePageInspection[] = [];
    root.addEventListener("browser-capture-import", (event) => {
      authorized.push((event as CustomEvent<ActivePageInspection>).detail);
    });
    mountPopup(root, authenticated(), {
      activePage,
      lookup: { lookup: vi.fn().mockResolvedValue({ exists: false }) },
      openReader: vi.fn(),
    });

    await vi.waitFor(() => {
      expect(getByText(root, "First Article")).toBeTruthy();
    });
    refresh?.();
    await vi.waitFor(() => {
      expect(getByText(root, "Second Article")).toBeTruthy();
    });
    expect(authorized).toEqual([]);

    fireEvent.click(getByRole(root, "button", { name: "Import" }));

    await vi.waitFor(() => {
      expect(authorized).toEqual([second]);
    });
  });

  it("commands the background job and renders capture progress, Sending, and Imported", async () => {
    const page: ActivePageInspection = {
      kind: "supported",
      sourceUrl: "https://example.com/live",
      tabId: 24,
      title: "Live article",
    };
    const startImport = vi.fn().mockResolvedValue({ status: "started" });
    let observe:
      | ((state: Awaited<ReturnType<CaptureJobClient["current"]>>) => void)
      | undefined;
    const captureJob: CaptureJobClient = {
      current: () => Promise.resolve({ phase: "ready" }),
      startImport,
      retry: vi.fn(),
      cancel: vi.fn(),
      discard: vi.fn(),
      observe(listener) {
        observe = listener;
        return () => {
          observe = undefined;
        };
      },
    };
    const root = document.createElement("main");

    mountPopup(root, authenticated(), {
      activePage: inspector(page),
      captureJob,
      lookup: { lookup: vi.fn().mockResolvedValue({ exists: false }) },
      openReader: vi.fn(),
    });
    await vi.waitFor(() => {
      expect(getByText(root, "Ready")).toBeTruthy();
    });

    fireEvent.click(getByRole(root, "button", { name: "Import" }));

    await vi.waitFor(() => {
      expect(startImport).toHaveBeenCalledWith(
        page,
        "https://reader.example",
        false,
      );
    });
    observe?.({
      phase: "capturing",
      page,
      completedAssets: 2,
      totalAssets: 5,
    });
    expect(getByText(root, "Capturing page")).toBeTruthy();
    expect(getByText(root, "Capturing images 2 of 5…")).toBeTruthy();
    expect(getByRole(root, "button", { name: "Cancel" })).toBeTruthy();

    observe?.({
      phase: "sending",
      captureId: "019bf66c-42ac-7c33-b57d-e2131af04fe9",
    });
    expect(getByText(root, "Sending to Increader")).toBeTruthy();
    expect(
      getByText(root, "Waiting for Increader to finish importing…"),
    ).toBeTruthy();
    expect(root.querySelector<HTMLButtonElement>("[data-cancel]")?.hidden).toBe(
      true,
    );

    observe?.({
      phase: "completed",
      captureId: "019bf66c-42ac-7c33-b57d-e2131af04fe9",
      outcome: "created",
      bookmarkId: 84,
      title: "Extracted article",
      origin: "https://reader.example",
    });
    await vi.waitFor(() => {
      expect(getByText(root, "Imported")).toBeTruthy();
      expect(getByText(root, "Extracted article")).toBeTruthy();
      expect(getByRole(root, "button", { name: "Open Reader" })).toBeTruthy();
    });
  });

  it("does not restore the last completed Bookmark after the popup reopens", async () => {
    const captureJob: CaptureJobClient = {
      current: () =>
        Promise.resolve({
          phase: "completed",
          captureId: "019bf66c-42ac-7c33-b57d-e2131af04fe9",
          outcome: "existing",
          bookmarkId: 84,
          title: "Extracted article",
          origin: "https://original-reader.example",
        }),
      startImport: vi.fn(),
      retry: vi.fn(),
      cancel: vi.fn(),
      discard: vi.fn(),
      observe: () => () => undefined,
    };
    const root = document.createElement("main");
    mountPopup(root, authenticatedAt("https://replacement-reader.example"), {
      activePage: inspector({
        kind: "supported",
        sourceUrl: "https://publisher.example/article",
        tabId: 24,
        title: "Live article",
      }),
      captureJob,
      lookup: { lookup: vi.fn().mockResolvedValue({ exists: false }) },
      openReader: vi.fn(),
    });

    await vi.waitFor(() => {
      expect(getByText(root, "Ready")).toBeTruthy();
    });
    expect(root.textContent).not.toContain("Extracted article");
    expect(
      root.querySelector<HTMLButtonElement>("[data-open-reader]")?.hidden,
    ).toBe(true);
  });

  it("shows the active unsupported page instead of a previous completion", async () => {
    const inspected = deferred<ActivePageInspection>();
    const captureJob: CaptureJobClient = {
      current: () =>
        Promise.resolve({
          phase: "completed",
          captureId: "019bf66c-42ac-7c33-b57d-e2131af04fe9",
          outcome: "created",
          bookmarkId: 84,
          title: "Extracted article",
          origin: "https://reader.example",
        }),
      startImport: vi.fn(),
      retry: vi.fn(),
      cancel: vi.fn(),
      discard: vi.fn(),
      observe: () => () => undefined,
    };
    const root = document.createElement("main");
    mountPopup(root, authenticated(), {
      activePage: {
        inspect: () => inspected.promise,
        observe: () => () => undefined,
      },
      captureJob,
      lookup: { lookup: vi.fn() },
      openReader: vi.fn(),
    });
    inspected.resolve({
      kind: "unsupported",
      reason: "Browser-protected pages cannot be imported.",
    });

    await vi.waitFor(() => {
      expect(getByText(root, "Unsupported")).toBeTruthy();
      expect(
        getByText(root, "Browser-protected pages cannot be imported."),
      ).toBeTruthy();
    });
    expect(root.textContent).not.toContain("Extracted article");
  });

  it("offers explicit Retry and Discard and confirms replacement before a new Import", async () => {
    const page: ActivePageInspection = {
      kind: "supported",
      sourceUrl: "https://publisher.example/replacement",
      tabId: 25,
      title: "Replacement article",
    };
    const retry = vi.fn();
    const discard = vi.fn();
    const startImport = vi
      .fn()
      .mockResolvedValueOnce({ status: "replacement-required" })
      .mockResolvedValueOnce({ status: "started" });
    const confirmReplacement = vi.fn(() => true);
    const captureJob: CaptureJobClient = {
      current: () =>
        Promise.resolve({
          phase: "failed",
          captureId: "019bf66c-42ac-7c33-b57d-e2131af04fe9",
          message: "network unavailable",
          retryable: true,
        }),
      startImport,
      retry,
      cancel: vi.fn(),
      discard,
      observe: () => () => undefined,
    };
    const root = document.createElement("main");
    mountPopup(root, authenticated(), {
      activePage: inspector(page),
      captureJob,
      confirmReplacement,
      lookup: { lookup: vi.fn().mockResolvedValue({ exists: false }) },
      openReader: vi.fn(),
    });

    await vi.waitFor(() => {
      expect(getByText(root, "Needs attention")).toBeTruthy();
      expect(getByText(root, "network unavailable")).toBeTruthy();
    });
    fireEvent.click(getByRole(root, "button", { name: "Retry" }));
    fireEvent.click(getByRole(root, "button", { name: "Discard" }));
    expect(retry).toHaveBeenCalledOnce();
    expect(discard).toHaveBeenCalledOnce();

    fireEvent.click(getByRole(root, "button", { name: "Import" }));
    await vi.waitFor(() => {
      expect(confirmReplacement).toHaveBeenCalledOnce();
      expect(startImport).toHaveBeenNthCalledWith(
        1,
        page,
        "https://reader.example",
        false,
      );
      expect(startImport).toHaveBeenNthCalledWith(
        2,
        page,
        "https://reader.example",
        true,
      );
    });
  });

  it("offers Discard without Retry for a deterministic package rejection", async () => {
    const captureJob: CaptureJobClient = {
      current: () =>
        Promise.resolve({
          phase: "failed",
          captureId: "019bf66c-42ac-7c33-b57d-e2131af04fe9",
          message: "Capture Package is invalid.",
          retryable: false,
        }),
      startImport: vi.fn(),
      retry: vi.fn(),
      cancel: vi.fn(),
      discard: vi.fn(),
      observe: () => () => undefined,
    };
    const root = document.createElement("main");

    mountPopup(root, authenticated(), {
      activePage: inspector({
        kind: "supported",
        sourceUrl: "https://publisher.example/rejected",
        tabId: 25,
        title: "Rejected article",
      }),
      captureJob,
      confirmReplacement: vi.fn(),
      lookup: { lookup: vi.fn().mockResolvedValue({ exists: false }) },
      openReader: vi.fn(),
    });

    await vi.waitFor(() => {
      expect(getByText(root, "Capture Package is invalid.")).toBeTruthy();
    });
    expect(root.querySelector<HTMLButtonElement>("[data-retry]")?.hidden).toBe(
      true,
    );
    expect(
      root.querySelector<HTMLButtonElement>("[data-discard]")?.hidden,
    ).toBe(false);
  });

  it("reveals Retry only when the persisted 429 delay has elapsed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-25T12:00:00.000Z"));
    try {
      const retryNotBeforeEpochMs = Date.now() + 2_000;
      const captureJob: CaptureJobClient = {
        current: () =>
          Promise.resolve({
            phase: "failed",
            captureId: "019bf66c-42ac-7c33-b57d-e2131af04fe9",
            message: "Browser Capture is temporarily limited.",
            retryable: true,
            retryAfterSeconds: 2,
            retryNotBeforeEpochMs,
          }),
        startImport: vi.fn(),
        retry: vi.fn(),
        cancel: vi.fn(),
        discard: vi.fn(),
        observe: () => () => undefined,
      };
      const root = document.createElement("main");
      mountPopup(root, authenticated(), {
        activePage: inspector({
          kind: "supported",
          sourceUrl: "https://publisher.example/limited",
          tabId: 25,
          title: "Limited article",
        }),
        captureJob,
        confirmReplacement: vi.fn(),
        lookup: { lookup: vi.fn().mockResolvedValue({ exists: false }) },
        openReader: vi.fn(),
      });
      await Promise.resolve();
      await Promise.resolve();
      const retryButton = root.querySelector<HTMLButtonElement>("[data-retry]");

      expect(retryButton?.hidden).toBe(true);
      await vi.advanceTimersByTimeAsync(1_999);
      expect(retryButton?.hidden).toBe(true);
      await vi.advanceTimersByTimeAsync(1);
      expect(retryButton?.hidden).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

function signedOut(): Authentication {
  return {
    accessToken: () => Promise.reject(new Error("not signed in")),
    current: () => Promise.resolve(null),
    currentOrigin: () => Promise.resolve(null),
    signIn: () => Promise.reject(new Error("not used")),
    signOut: () => Promise.resolve(),
  };
}

function authenticated(): Authentication {
  return authenticatedAt("https://reader.example");
}

function authenticatedAt(origin: string): Authentication {
  return {
    accessToken: () => Promise.resolve("session_memory"),
    current: () =>
      Promise.resolve({
        displayName: "Home Reader",
        email: "reader@example.com",
        origin,
      }),
    currentOrigin: () => Promise.resolve(origin),
    signIn: () => Promise.reject(new Error("not used")),
    signOut: () => Promise.resolve(),
  };
}

function inspector(page: ActivePageInspection): ActivePageInspector {
  return {
    inspect: () => Promise.resolve(page),
    observe: () => () => undefined,
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
