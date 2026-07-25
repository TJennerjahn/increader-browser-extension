// @vitest-environment jsdom

import { fireEvent, getByRole, getByText } from "@testing-library/dom";
import { describe, expect, it, vi } from "vitest";

import type { Pairing } from "../pairing/pairing";
import { CLOUD_INSTANCE_ORIGIN, mountPopup } from "./popup";

describe("compact Browser Capture popup", () => {
  it("starts disconnected and discovers Increader Cloud without inspecting a page", async () => {
    const connect = vi.fn().mockResolvedValue({
      origin: CLOUD_INSTANCE_ORIGIN,
      displayName: "Increader Cloud",
      installationId: "019bf66c-42ac-7c33-b57d-e2131af04fe9",
      pairingId: "019bf66d-29df-7a41-950f-c4b36a9d61bd"
    });
    const pairing: Pairing = {
      accessToken: () => Promise.reject(new Error("not paired")),
      connect,
      current: () => Promise.resolve(null),
      currentOrigin: () => Promise.resolve(null),
      disconnect: () => Promise.resolve(),
      discover: () => Promise.reject(new Error("not used"))
    };
    const root = document.createElement("main");

    mountPopup(root, pairing);

    expect(getByText(root, "Browser Capture")).toBeTruthy();
    expect(getByText(root, "Not connected")).toBeTruthy();
    expect(getByText(root, "Increader Cloud")).toBeTruthy();
    expect(getByText(root, "Connection settings")).toBeTruthy();

    fireEvent.click(
      getByRole(root, "button", { name: "Connect to Increader Cloud" })
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
        pairingId: "019bf66d-29df-7a41-950f-c4b36a9d61bd"
      }),
      current: () =>
        Promise.resolve({
          displayName: "Home Reader",
          installationId: "019bf66c-42ac-7c33-b57d-e2131af04fe9",
          origin: "https://reader.example",
          pairingId: "019bf66d-29df-7a41-950f-c4b36a9d61bd"
        }),
      currentOrigin: () => Promise.resolve("https://reader.example"),
      disconnect,
      discover: () => Promise.reject(new Error("not used"))
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
      pairingId: "019bf66d-29df-7a41-950f-c4b36a9d61bd"
    });
    const pairing: Pairing = {
      accessToken: () => Promise.reject(new Error("not paired")),
      connect,
      current: () => Promise.resolve(null),
      currentOrigin: () => Promise.resolve(null),
      disconnect: () => Promise.resolve(),
      discover: () => Promise.reject(new Error("not used"))
    };
    const root = document.createElement("main");
    mountPopup(root, pairing);
    const input = getByRole(root, "textbox", {
      name: "Self-hosted Increader origin"
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
});
