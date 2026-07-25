import { describe, expect, it, vi } from "vitest";

import type { PairedDestination, Pairing } from "../pairing/pairing";
import {
  createPairingClient,
  registerPairingRuntime,
  type PairingOperationState,
  type PairingOperationStore,
} from "./pairing-runtime";

describe.each(["Chrome", "Firefox"])("%s Pairing runtime", () => {
  it("continues Pairing after the permission prompt detaches the popup", async () => {
    const runtime = new RuntimeBus();
    const permissions = new PermissionPrompt();
    const operationStore = new MemoryPairingOperationStore();
    let current: PairedDestination | null = null;
    const connect = vi.fn((origin: string) => {
      expect(permissions.granted).toContain(`${origin}/*`);
      current = pairedAt(origin);
      return Promise.resolve(current);
    });
    const pairing: Pairing = {
      accessToken: () => Promise.resolve("bca_memory"),
      connect,
      current: () => Promise.resolve(current),
      currentOrigin: () => Promise.resolve(current?.origin ?? null),
      disconnect: () => {
        current = null;
        return Promise.resolve();
      },
      discover: () => Promise.reject(new Error("not used")),
    };
    const unregister = registerPairingRuntime(pairing, {
      operationStore,
      permissions: permissions.backgroundApi(),
      runtime: runtime.api(),
    });
    const popup = createPairingClient({
      permissions: permissions.popupApi(),
      runtime: runtime.api(),
    });

    void popup.connect("https://reader.example/");
    await vi.waitFor(() => {
      expect(connect).toHaveBeenCalledWith("https://reader.example");
    });

    const reopenedPopup = createPairingClient({
      permissions: permissions.popupApi(),
      runtime: runtime.api(),
    });
    await expect(reopenedPopup.current()).resolves.toEqual(
      pairedAt("https://reader.example"),
    );
    await expect(operationStore.load()).resolves.toEqual({ phase: "idle" });

    unregister();
  });

  it("keeps a background Pairing failure observable after the popup closes", async () => {
    const runtime = new RuntimeBus();
    const permissions = new PermissionPrompt();
    const operationStore = new MemoryPairingOperationStore();
    const pairing: Pairing = {
      accessToken: () => Promise.reject(new Error("not paired")),
      connect: () =>
        Promise.reject(
          new Error("Could not connect to a compatible Increader instance."),
        ),
      current: () => Promise.resolve(null),
      currentOrigin: () => Promise.resolve(null),
      disconnect: () => Promise.resolve(),
      discover: () => Promise.reject(new Error("not used")),
    };
    const unregister = registerPairingRuntime(pairing, {
      operationStore,
      permissions: permissions.backgroundApi(),
      runtime: runtime.api(),
    });

    void createPairingClient({
      permissions: permissions.popupApi(),
      runtime: runtime.api(),
    }).connect("https://broken.example");

    const reopenedPopup = createPairingClient({
      permissions: permissions.popupApi(),
      runtime: runtime.api(),
    });
    await vi.waitFor(async () => {
      await expect(reopenedPopup.operation()).resolves.toEqual({
        phase: "failed",
        origin: "https://broken.example",
        message: "Could not connect to a compatible Increader instance.",
      });
    });

    unregister();
  });

  it("resumes when permission is granted before pending state is persisted", async () => {
    const runtime = new RuntimeBus();
    const permissions = new PermissionPrompt(true);
    const operationStore = new DelayedPairingOperationStore();
    const connect = vi.fn((origin: string) =>
      Promise.resolve(pairedAt(origin)),
    );
    const pairing: Pairing = {
      accessToken: () => Promise.resolve("bca_memory"),
      connect,
      current: () => Promise.resolve(null),
      currentOrigin: () => Promise.resolve(null),
      disconnect: () => Promise.resolve(),
      discover: () => Promise.reject(new Error("not used")),
    };
    const unregister = registerPairingRuntime(pairing, {
      operationStore,
      permissions: permissions.backgroundApi(),
      runtime: runtime.api(),
    });

    void createPairingClient({
      permissions: permissions.popupApi(),
      runtime: runtime.api(),
    }).connect("https://reader.example");
    expect(connect).not.toHaveBeenCalled();

    operationStore.release();
    await vi.waitFor(() => {
      expect(connect).toHaveBeenCalledWith("https://reader.example");
    });

    unregister();
  });

  it("clears stale Pairing operation state after Disconnect", async () => {
    const runtime = new RuntimeBus();
    const permissions = new PermissionPrompt();
    const operationStore = new MemoryPairingOperationStore();
    await operationStore.save({
      phase: "failed",
      origin: "https://reader.example",
      message: "Pairing was cancelled.",
    });
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const pairing: Pairing = {
      accessToken: () => Promise.reject(new Error("not paired")),
      connect: () => Promise.reject(new Error("not used")),
      current: () => Promise.resolve(null),
      currentOrigin: () => Promise.resolve(null),
      disconnect,
      discover: () => Promise.reject(new Error("not used")),
    };
    const unregister = registerPairingRuntime(pairing, {
      operationStore,
      permissions: permissions.backgroundApi(),
      runtime: runtime.api(),
    });
    const popup = createPairingClient({
      permissions: permissions.popupApi(),
      runtime: runtime.api(),
    });

    await popup.disconnect();

    expect(disconnect).toHaveBeenCalledOnce();
    await expect(operationStore.load()).resolves.toEqual({ phase: "idle" });
    unregister();
  });
});

it("resumes Firefox Pairing through its Promise permission API", async () => {
  const runtime = new RuntimeBus("moz-extension://browser-capture/");
  const permissions = new PermissionPrompt();
  const operationStore = new MemoryPairingOperationStore();
  const connect = vi.fn((origin: string) => Promise.resolve(pairedAt(origin)));
  const pairing: Pairing = {
    accessToken: () => Promise.resolve("bca_memory"),
    connect,
    current: () => Promise.resolve(null),
    currentOrigin: () => Promise.resolve(null),
    disconnect: () => Promise.resolve(),
    discover: () => Promise.reject(new Error("not used")),
  };
  const unregister = registerPairingRuntime(pairing, {
    operationStore,
    permissions: permissions.backgroundApi(),
    runtime: runtime.api(),
  });
  const popup = createPairingClient({
    permissions: permissions.popupApi(),
    promisePermissions: permissions.promiseApi(),
    runtime: runtime.api(),
  });

  await expect(popup.connect("http://127.0.0.1:5289")).resolves.toEqual(
    pairedAt("http://127.0.0.1:5289"),
  );
  expect(connect).toHaveBeenCalledWith("http://127.0.0.1:5289");

  unregister();
});

it("reads Firefox background state through its Promise runtime API", async () => {
  const runtime = new RuntimeBus("moz-extension://browser-capture/");
  const operationStore = new MemoryPairingOperationStore();
  const permissions = new PermissionPrompt();
  const unregister = registerPairingRuntime(
    {
      accessToken: () => Promise.resolve("bca_memory"),
      connect: () => Promise.reject(new Error("not used")),
      current: () => Promise.resolve(pairedAt("https://reader.example")),
      currentOrigin: () => Promise.resolve("https://reader.example"),
      disconnect: () => Promise.resolve(),
      discover: () => Promise.reject(new Error("not used")),
    },
    {
      operationStore,
      permissions: permissions.backgroundApi(),
      runtime: runtime.api(),
    },
  );
  const callbackRuntime = runtime.api();
  const callbackSend = vi.spyOn(callbackRuntime, "sendMessage");
  const popup = createPairingClient({
    permissions: permissions.popupApi(),
    promiseRuntime: runtime.promiseApi(),
    runtime: callbackRuntime,
  });

  await expect(popup.current()).resolves.toEqual(
    pairedAt("https://reader.example"),
  );
  expect(callbackSend).not.toHaveBeenCalled();

  unregister();
});

it("broadcasts Firefox Pairing state through its Promise runtime API", async () => {
  const runtime = new RuntimeBus("moz-extension://browser-capture/");
  const operationStore = new MemoryPairingOperationStore();
  const permissions = new PermissionPrompt();
  const promiseSend = vi.fn().mockResolvedValue(undefined);
  const unregister = registerPairingRuntime(
    {
      accessToken: () => Promise.resolve("bca_memory"),
      connect: (origin) => Promise.resolve(pairedAt(origin)),
      current: () => Promise.resolve(null),
      currentOrigin: () => Promise.resolve(null),
      disconnect: () => Promise.resolve(),
      discover: () => Promise.reject(new Error("not used")),
    },
    {
      operationStore,
      permissions: permissions.backgroundApi(),
      promiseRuntime: { sendMessage: promiseSend },
      runtime: runtime.api(),
    },
  );

  await expect(
    createPairingClient({
      permissions: permissions.popupApi(),
      promisePermissions: permissions.promiseApi(),
      runtime: runtime.api(),
    }).connect("http://127.0.0.1:5289"),
  ).resolves.toEqual(pairedAt("http://127.0.0.1:5289"));

  await vi.waitFor(() => {
    expect(promiseSend).toHaveBeenCalledWith({
      target: "pairing-state",
      state: { phase: "idle" },
    });
  });
  unregister();
});

it("resumes Firefox Pairing when the granted native prompt leaves request pending", async () => {
  const runtime = new RuntimeBus("moz-extension://browser-capture/");
  const permissions = new PermissionPrompt();
  const operationStore = new MemoryPairingOperationStore();
  const connect = vi.fn((origin: string) => Promise.resolve(pairedAt(origin)));
  const pairing: Pairing = {
    accessToken: () => Promise.resolve("bca_memory"),
    connect,
    current: () => Promise.resolve(null),
    currentOrigin: () => Promise.resolve(null),
    disconnect: () => Promise.resolve(),
    discover: () => Promise.reject(new Error("not used")),
  };
  const unregister = registerPairingRuntime(pairing, {
    operationStore,
    permissions: permissions.backgroundApi(),
    runtime: runtime.api(),
  });

  await expect(
    createPairingClient({
      permissions: permissions.popupApi(),
      promisePermissions: permissions.promiseApi(true),
      runtime: runtime.api(),
    }).connect("http://127.0.0.1:5289"),
  ).resolves.toEqual(pairedAt("http://127.0.0.1:5289"));
  expect(connect).toHaveBeenCalledOnce();

  unregister();
});

it("resumes from background permission state when Firefox delivers no completion event", async () => {
  const runtime = new RuntimeBus("moz-extension://browser-capture/");
  const permissions = new PermissionPrompt(false, false);
  const operationStore = new MemoryPairingOperationStore();
  const connect = vi.fn((origin: string) => Promise.resolve(pairedAt(origin)));
  const pairing: Pairing = {
    accessToken: () => Promise.resolve("bca_memory"),
    connect,
    current: () => Promise.resolve(null),
    currentOrigin: () => Promise.resolve(null),
    disconnect: () => Promise.resolve(),
    discover: () => Promise.reject(new Error("not used")),
  };
  const unregister = registerPairingRuntime(pairing, {
    operationStore,
    permissions: permissions.backgroundApi(),
    runtime: runtime.api(),
  });

  void createPairingClient({
    permissions: permissions.popupApi(),
    promisePermissions: permissions.promiseApi(true),
    runtime: runtime.api(),
  }).connect("http://127.0.0.1:5289");

  await vi.waitFor(() => {
    expect(connect).toHaveBeenCalledWith("http://127.0.0.1:5289");
  });
  unregister();
});

class RuntimeBus {
  private readonly listeners = new Set<RuntimeMessageListener>();

  constructor(
    private readonly extensionOrigin = "chrome-extension://capture/",
  ) {}

  api(): typeof chrome.runtime {
    return {
      getURL: (path: string) => `${this.extensionOrigin}${path}`,
      lastError: undefined,
      onMessage: {
        addListener: (listener: RuntimeMessageListener) =>
          this.listeners.add(listener),
        removeListener: (listener: RuntimeMessageListener) =>
          this.listeners.delete(listener),
      },
      sendMessage: (
        message: unknown,
        callback?: (response: unknown) => void,
      ) => {
        for (const listener of this.listeners) {
          listener(message, {}, callback ?? (() => undefined));
        }
        return undefined;
      },
    } as unknown as typeof chrome.runtime;
  }

  promiseApi(): {
    sendMessage(
      message: unknown,
    ): Promise<{ ok: boolean; value?: unknown; message?: string } | undefined>;
  } {
    return {
      sendMessage: (message) =>
        new Promise((resolve) => {
          for (const listener of this.listeners) {
            listener(message, {}, (response) => {
              resolve(
                response as
                  | { ok: boolean; value?: unknown; message?: string }
                  | undefined,
              );
            });
          }
        }),
    };
  }
}

class PermissionPrompt {
  readonly granted: string[] = [];
  private readonly added = new Set<
    (permissions: chrome.permissions.Permissions) => void
  >();

  constructor(
    private readonly grantImmediately = false,
    private readonly emitAdded = true,
  ) {}

  popupApi(): typeof chrome.permissions {
    return {
      request: (permissions: chrome.permissions.Permissions) => {
        const origins = permissions.origins ?? [];
        this.granted.push(...origins);
        const emit = (): void => {
          if (!this.emitAdded) return;
          for (const listener of this.added) {
            listener({ origins });
          }
        };
        if (this.grantImmediately) emit();
        else queueMicrotask(emit);
        // Deliberately never invokes the callback: Chrome destroyed the popup.
      },
    } as unknown as typeof chrome.permissions;
  }

  promiseApi(leaveRequestPending = false): {
    contains: (permissions: chrome.permissions.Permissions) => Promise<boolean>;
    request: () => Promise<boolean>;
  } {
    return {
      contains: (permissions) =>
        Promise.resolve(
          (permissions.origins ?? []).every((origin) =>
            this.granted.includes(origin),
          ),
        ),
      request: () => {
        const origins = ["http://127.0.0.1/*"];
        this.granted.push(...origins);
        if (this.emitAdded) {
          for (const listener of this.added) {
            listener({ origins });
          }
        }
        return leaveRequestPending
          ? new Promise<boolean>(() => undefined)
          : Promise.resolve(true);
      },
    };
  }

  backgroundApi(): typeof chrome.permissions {
    return {
      contains: (
        permissions: chrome.permissions.Permissions,
        callback: (result: boolean) => void,
      ) => {
        callback(
          (permissions.origins ?? []).every((origin) =>
            this.granted.includes(origin),
          ),
        );
      },
      onAdded: {
        addListener: (
          listener: (permissions: chrome.permissions.Permissions) => void,
        ) => this.added.add(listener),
        removeListener: (
          listener: (permissions: chrome.permissions.Permissions) => void,
        ) => this.added.delete(listener),
      },
    } as unknown as typeof chrome.permissions;
  }
}

type RuntimeMessageListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) => boolean | undefined;

class MemoryPairingOperationStore implements PairingOperationStore {
  private current: PairingOperationState = { phase: "idle" };

  load(): Promise<PairingOperationState> {
    return Promise.resolve(this.current);
  }

  save(state: PairingOperationState): Promise<void> {
    this.current = state;
    return Promise.resolve();
  }
}

class DelayedPairingOperationStore extends MemoryPairingOperationStore {
  private releaseSave: (() => void) | null = null;
  private readonly waitForRelease = new Promise<void>((resolve) => {
    this.releaseSave = resolve;
  });

  override async save(state: PairingOperationState): Promise<void> {
    if (state.phase === "waiting-permission") {
      await this.waitForRelease;
    }
    await super.save(state);
  }

  release(): void {
    this.releaseSave?.();
  }
}

function pairedAt(origin: string): PairedDestination {
  return {
    displayName: "Increader",
    installationId: "019bf66c-42ac-7c33-b57d-e2131af04fe9",
    origin,
    pairingId: "019bf66d-29df-7a41-950f-c4b36a9d61bd",
  };
}
