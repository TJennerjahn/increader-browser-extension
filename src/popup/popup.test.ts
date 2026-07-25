// @vitest-environment jsdom

import { fireEvent, getByRole, getByText } from "@testing-library/dom";
import { describe, expect, it, vi } from "vitest";

import type { Pairing } from "../pairing/pairing";
import type {
  ActivePageInspection,
  ActivePageInspector,
} from "../browser/active-page";
import type { BookmarkLookupClient } from "../protocol/bookmark-lookup-http";
import { CLOUD_INSTANCE_ORIGIN, mountPopup } from "./popup";

describe("compact Browser Capture popup", () => {
  it("starts disconnected and discovers Increader Cloud without inspecting a page", async () => {
    const connect = vi.fn().mockResolvedValue({
      origin: CLOUD_INSTANCE_ORIGIN,
      displayName: "Increader Cloud",
      installationId: "019bf66c-42ac-7c33-b57d-e2131af04fe9",
      pairingId: "019bf66d-29df-7a41-950f-c4b36a9d61bd",
    });
    const pairing: Pairing = {
      accessToken: () => Promise.reject(new Error("not paired")),
      connect,
      current: () => Promise.resolve(null),
      currentOrigin: () => Promise.resolve(null),
      disconnect: () => Promise.resolve(),
      discover: () => Promise.reject(new Error("not used")),
    };
    const root = document.createElement("main");

    mountPopup(root, pairing);

    expect(getByText(root, "Browser Capture")).toBeTruthy();
    expect(getByText(root, "Not connected")).toBeTruthy();
    expect(getByText(root, "Increader Cloud")).toBeTruthy();
    expect(getByText(root, "Connection settings")).toBeTruthy();

    fireEvent.click(
      getByRole(root, "button", { name: "Connect to Increader Cloud" }),
    );
    await vi.waitFor(() => {
      expect(connect).toHaveBeenCalledWith(CLOUD_INSTANCE_ORIGIN);
      expect(getByText(root, "Paired")).toBeTruthy();
    });
  });

  it("shows the approved account destination and disconnects explicitly", async () => {
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const pairing: Pairing = {
      accessToken: () => Promise.resolve("bca_memory"),
      connect: vi.fn().mockResolvedValue({
        displayName: "Home Reader",
        installationId: "019bf66c-42ac-7c33-b57d-e2131af04fe9",
        origin: "https://reader.example",
        pairingId: "019bf66d-29df-7a41-950f-c4b36a9d61bd",
      }),
      current: () =>
        Promise.resolve({
          displayName: "Home Reader",
          installationId: "019bf66c-42ac-7c33-b57d-e2131af04fe9",
          origin: "https://reader.example",
          pairingId: "019bf66d-29df-7a41-950f-c4b36a9d61bd",
        }),
      currentOrigin: () => Promise.resolve("https://reader.example"),
      disconnect,
      discover: () => Promise.reject(new Error("not used")),
    };
    const root = document.createElement("main");

    mountPopup(root, pairing);

    await vi.waitFor(() => {
      expect(getByText(root, "Paired")).toBeTruthy();
      expect(getByText(root, "Home Reader")).toBeTruthy();
    });
    fireEvent.click(getByRole(root, "button", { name: "Disconnect" }));
    await vi.waitFor(() => {
      expect(disconnect).toHaveBeenCalledOnce();
      expect(getByText(root, "Not connected")).toBeTruthy();
    });
  });

  it("keeps self-hosted discovery inside connection settings", async () => {
    const connect = vi.fn().mockResolvedValue({
      origin: "https://reader.example",
      displayName: "Home Reader",
      installationId: "019bf66c-42ac-7c33-b57d-e2131af04fe9",
      pairingId: "019bf66d-29df-7a41-950f-c4b36a9d61bd",
    });
    const pairing: Pairing = {
      accessToken: () => Promise.reject(new Error("not paired")),
      connect,
      current: () => Promise.resolve(null),
      currentOrigin: () => Promise.resolve(null),
      disconnect: () => Promise.resolve(),
      discover: () => Promise.reject(new Error("not used")),
    };
    const root = document.createElement("main");
    mountPopup(root, pairing);
    const input = getByRole(root, "textbox", {
      name: "Self-hosted Increader origin",
    });

    fireEvent.input(input, { target: { value: "https://reader.example/" } });
    const form = input.closest("form");
    expect(form).not.toBeNull();
    if (form === null) return;
    fireEvent.submit(form);

    await vi.waitFor(() => {
      expect(connect).toHaveBeenCalledWith("https://reader.example/");
      expect(getByText(root, "Home Reader")).toBeTruthy();
      expect(getByText(root, "Paired")).toBeTruthy();
    });
  });

  it("shows a paired supported page as Ready without authorizing Import", async () => {
    const page: ActivePageInspection = {
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

    mountPopup(root, paired(), {
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
      expect(
        getByText(root, /title, URL, and document type are read/),
      ).toBeTruthy();
    });
    expect(lookupCall).toHaveBeenCalledWith(
      "https://reader.example",
      "bca_memory",
      "https://example.com/article?view=full",
    );
    expect(importAuthorized).not.toHaveBeenCalled();
    expect(
      getByRole<HTMLButtonElement>(root, "button", { name: "Import" }).disabled,
    ).toBe(false);
  });

  it("offers an existing owned Bookmark without opening Reader automatically", async () => {
    const openReader = vi.fn().mockResolvedValue(undefined);
    const root = document.createElement("main");

    mountPopup(root, paired(), {
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
    mountPopup(root, paired(), {
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

    mountPopup(root, paired(), {
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
    mountPopup(root, paired(), {
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
});

function paired(): Pairing {
  return {
    accessToken: () => Promise.resolve("bca_memory"),
    connect: () => Promise.reject(new Error("not used")),
    current: () =>
      Promise.resolve({
        displayName: "Home Reader",
        installationId: "019bf66c-42ac-7c33-b57d-e2131af04fe9",
        origin: "https://reader.example",
        pairingId: "019bf66d-29df-7a41-950f-c4b36a9d61bd",
      }),
    currentOrigin: () => Promise.resolve("https://reader.example"),
    disconnect: () => Promise.resolve(),
    discover: () => Promise.reject(new Error("not used")),
  };
}

function inspector(page: ActivePageInspection): ActivePageInspector {
  return {
    inspect: () => Promise.resolve(page),
    observe: () => () => undefined,
  };
}
