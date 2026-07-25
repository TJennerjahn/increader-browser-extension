import { describe, expect, it, vi } from "vitest";

import {
  holdBackgroundForPopup,
  registerPopupKeepAlive,
} from "./popup-lifetime";

describe.each(["Chrome", "Firefox"])("%s popup background lifetime", () => {
  it("holds the background while the popup is mounted and releases it on close", () => {
    const connected = new Set<(port: chrome.runtime.Port) => void>();
    const disconnected = new Set<(port: chrome.runtime.Port) => void>();
    const messages = new Set<(message: unknown) => void>();
    const port = {
      disconnect: vi.fn(() => {
        for (const listener of disconnected) listener(port);
      }),
      name: "browser-capture-popup-lifetime",
      onMessage: {
        addListener: (listener: (message: unknown) => void) =>
          messages.add(listener),
        removeListener: (listener: (message: unknown) => void) =>
          messages.delete(listener),
      },
      onDisconnect: {
        addListener: (listener: (value: chrome.runtime.Port) => void) =>
          disconnected.add(listener),
        removeListener: (listener: (value: chrome.runtime.Port) => void) =>
          disconnected.delete(listener),
      },
      postMessage: vi.fn((message: unknown) => {
        for (const listener of messages) listener(message);
      }),
    } as unknown as chrome.runtime.Port;
    const runtime = {
      connect: vi.fn(() => {
        for (const listener of connected) listener(port);
        return port;
      }),
      onConnect: {
        addListener: (listener: (value: chrome.runtime.Port) => void) =>
          connected.add(listener),
        removeListener: (listener: (value: chrome.runtime.Port) => void) =>
          connected.delete(listener),
      },
    } as unknown as typeof chrome.runtime;
    const unregister = registerPopupKeepAlive(runtime);

    const release = holdBackgroundForPopup(runtime);
    release();

    expect(port.disconnect).toHaveBeenCalledOnce();
    expect(port.postMessage).toHaveBeenCalledWith({
      target: "browser-capture-popup-lifetime",
    });
    unregister();
    expect(connected).toHaveLength(0);
    expect(disconnected).toHaveLength(0);
  });

  it("ignores unrelated runtime ports", () => {
    let onConnect: ((port: chrome.runtime.Port) => void) | undefined;
    const runtime = {
      onConnect: {
        addListener: (listener: (port: chrome.runtime.Port) => void) => {
          onConnect = listener;
        },
        removeListener: vi.fn(),
      },
    } as unknown as typeof chrome.runtime;
    const disconnect = vi.fn();
    const port = {
      disconnect,
      name: "some-other-port",
      onMessage: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
      onDisconnect: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    } as unknown as chrome.runtime.Port;
    const unregister = registerPopupKeepAlive(runtime);

    onConnect?.(port);
    unregister();

    expect(disconnect).not.toHaveBeenCalled();
  });
});
