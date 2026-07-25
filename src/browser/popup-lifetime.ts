const POPUP_LIFETIME_PORT = "browser-capture-popup-lifetime";

export function holdBackgroundForPopup(
  runtime: typeof chrome.runtime = chrome.runtime,
): () => void {
  const port = runtime.connect({ name: POPUP_LIFETIME_PORT });
  const heartbeat = (): void => {
    try {
      port.postMessage({ target: POPUP_LIFETIME_PORT });
    } catch {
      // A closing popup releases the port below.
    }
  };
  heartbeat();
  const heartbeatInterval = globalThis.setInterval(heartbeat, 10_000);
  return () => {
    globalThis.clearInterval(heartbeatInterval);
    port.disconnect();
  };
}

export function registerPopupKeepAlive(
  runtime: typeof chrome.runtime = chrome.runtime,
): () => void {
  const ports = new Set<chrome.runtime.Port>();
  const onConnect = (port: chrome.runtime.Port): void => {
    if (port.name !== POPUP_LIFETIME_PORT) return;
    ports.add(port);
    const onMessage = (): void => {
      // Receiving a message marks the visible popup's background work active.
    };
    const onDisconnect = (): void => {
      ports.delete(port);
      port.onMessage.removeListener(onMessage);
      port.onDisconnect.removeListener(onDisconnect);
    };
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(onDisconnect);
  };
  runtime.onConnect.addListener(onConnect);
  return () => {
    runtime.onConnect.removeListener(onConnect);
    for (const port of ports) {
      port.disconnect();
    }
    ports.clear();
  };
}
