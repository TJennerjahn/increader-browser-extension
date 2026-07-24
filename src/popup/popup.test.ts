// @vitest-environment jsdom

import { fireEvent, getByRole, getByText } from "@testing-library/dom";
import { describe, expect, it, vi } from "vitest";

import type { Pairing } from "../pairing/pairing";
import { CLOUD_INSTANCE_ORIGIN, mountPopup } from "./popup";

describe("compact Browser Capture popup", () => {
  it("starts disconnected and discovers Increader Cloud without inspecting a page", async () => {
    const discover = vi.fn().mockResolvedValue({
      origin: CLOUD_INSTANCE_ORIGIN,
      displayName: "Increader Cloud",
      pairingAvailable: true
    });
    const pairing: Pairing = {
      currentOrigin: () => Promise.resolve(null),
      disconnect: () => Promise.resolve(),
      discover
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
      expect(discover).toHaveBeenCalledWith(CLOUD_INSTANCE_ORIGIN);
      expect(getByText(root, "Ready to pair")).toBeTruthy();
    });
  });

  it("keeps self-hosted discovery inside connection settings", async () => {
    const discover = vi.fn().mockResolvedValue({
      origin: "https://reader.example",
      displayName: "Home Reader",
      pairingAvailable: true
    });
    const pairing: Pairing = {
      currentOrigin: () => Promise.resolve(null),
      disconnect: () => Promise.resolve(),
      discover
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
      expect(discover).toHaveBeenCalledWith("https://reader.example/");
      expect(getByText(root, "Home Reader")).toBeTruthy();
      expect(getByText(root, "Ready to pair")).toBeTruthy();
    });
  });
});
