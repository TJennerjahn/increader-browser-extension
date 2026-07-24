import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { BrowserCaptureDiscovery } from "../protocol/discovery";
import {
  createPairing,
  type DestinationStore,
  type DiscoveryClient,
  type RuntimeOriginPermissions
} from "./pairing";

const validDiscovery = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../../protocol/fixtures/discovery.valid.json", import.meta.url)
    ),
    "utf8"
  )
) as BrowserCaptureDiscovery;

class MemoryDestinationStore implements DestinationStore {
  constructor(public current: string | null) {}

  load(): Promise<string | null> {
    return Promise.resolve(this.current);
  }

  save(origin: string): Promise<void> {
    this.current = origin;
    return Promise.resolve();
  }

  clear(): Promise<void> {
    this.current = null;
    return Promise.resolve();
  }
}

class MemoryPermissions implements RuntimeOriginPermissions {
  constructor(
    public readonly granted: Set<string>,
    private readonly allowRequests = true
  ) {}

  contains(pattern: string): Promise<boolean> {
    return Promise.resolve(this.granted.has(pattern));
  }

  request(pattern: string): Promise<boolean> {
    if (this.allowRequests) {
      this.granted.add(pattern);
    }
    return Promise.resolve(this.allowRequests);
  }

  remove(pattern: string): Promise<void> {
    this.granted.delete(pattern);
    return Promise.resolve();
  }
}

describe("Pairing destination discovery", () => {
  it("replaces the stored origin and leaves only its exact host permission", async () => {
    const store = new MemoryDestinationStore("https://old.example");
    const permissions = new MemoryPermissions(
      new Set(["https://old.example/*"])
    );
    const discovery: DiscoveryClient = {
      discover: () =>
        Promise.resolve({
          ...validDiscovery,
          displayName: "My Increader"
        })
    };
    const pairing = createPairing({ store, permissions, discovery });

    const destination = await pairing.discover("https://NEW.example/");

    expect({
      destination,
      storedOrigin: store.current,
      grantedOrigins: [...permissions.granted]
    }).toEqual({
      destination: {
        origin: "https://new.example",
        displayName: "My Increader",
        pairingAvailable: true
      },
      storedOrigin: "https://new.example",
      grantedOrigins: ["https://new.example/*"]
    });
  });

  it("keeps the current destination when a replacement is incompatible", async () => {
    const store = new MemoryDestinationStore("https://old.example");
    const permissions = new MemoryPermissions(
      new Set(["https://old.example/*"])
    );
    const discovery: DiscoveryClient = {
      discover: () => Promise.reject(new Error("remote body with secrets"))
    };
    const pairing = createPairing({ store, permissions, discovery });

    await expect(pairing.discover("https://broken.example")).rejects.toThrow(
      "Could not connect to a compatible Increader instance."
    );
    expect({
      storedOrigin: store.current,
      grantedOrigins: [...permissions.granted]
    }).toEqual({
      storedOrigin: "https://old.example",
      grantedOrigins: ["https://old.example/*"]
    });
  });

  it("does not contact the destination when runtime permission is declined", async () => {
    let contacted = false;
    const store = new MemoryDestinationStore(null);
    const permissions = new MemoryPermissions(new Set(), false);
    const discovery: DiscoveryClient = {
      discover: () => {
        contacted = true;
        return Promise.resolve(validDiscovery);
      }
    };
    const pairing = createPairing({ store, permissions, discovery });

    await expect(pairing.discover("https://reader.example")).rejects.toThrow(
      "Permission to reach this Increader instance was not granted."
    );
    expect(contacted).toBe(false);
  });
});
