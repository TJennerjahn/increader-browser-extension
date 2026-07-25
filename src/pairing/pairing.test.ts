import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { BrowserCaptureDiscovery } from "../protocol/discovery";
import {
  createPairing,
  type BrowserIdentityFlow,
  type CredentialStore,
  type DestinationStore,
  type DiscoveryClient,
  type PairingProtocolClient,
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

describe("Browser Capture Pairing approval", () => {
  it("pairs through a PKCE browser identity redirect and persists only the renewal credential", async () => {
    const store = new MemoryDestinationStore(null);
    const credentials = new MemoryCredentialStore();
    const permissions = new MemoryPermissions(new Set());
    const identity: BrowserIdentityFlow = {
      callbackUri: () =>
        "https://haipjkpamjpojalajcgfeggbjhifjpnn.chromiumapp.org/browser-capture",
      launch: (approvalUrl) => {
        const request = new URL(approvalUrl);
        expect(request.pathname).toBe("/browser-capture/pairing/approve");
        expect(request.searchParams.get("code_challenge_method")).toBe("S256");
        expect(request.searchParams.get("installation_id")).toBe(
          "019bf66c-42ac-7c33-b57d-e2131af04fe9"
        );
        const callback = request.searchParams.get("callback_uri") ?? "";
        const state = request.searchParams.get("state") ?? "";
        return Promise.resolve(`${callback}?code=bcc_approved&state=${state}`);
      }
    };
    const protocol: PairingProtocolClient = {
      exchange: (origin, request) => {
        expect(origin).toBe("https://reader.example");
        expect(request.authorizationCode).toBe("bcc_approved");
        expect(request.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
        return Promise.resolve({
          accessToken: "bca_memory_only",
          expiresInSeconds: 600,
          pairingId: "019bf66d-29df-7a41-950f-c4b36a9d61bd",
          renewalCredential: "bcr_persisted",
          renewalExpiresInSeconds: 7_776_000,
          tokenType: "Bearer"
        });
      },
      renew: () => Promise.reject(new Error("not used")),
      revoke: () => Promise.reject(new Error("not used"))
    };
    const pairing = createPairing({
      credentials,
      discovery: {
        discover: () => Promise.resolve(validDiscovery)
      },
      identity,
      installation: {
        id: () =>
          Promise.resolve("019bf66c-42ac-7c33-b57d-e2131af04fe9"),
        name: "Chrome on Linux"
      },
      permissions,
      protocol,
      store
    });

    const paired = await pairing.connect("https://reader.example");

    expect(paired).toEqual({
      displayName: "Increader",
      installationId: "019bf66c-42ac-7c33-b57d-e2131af04fe9",
      origin: "https://reader.example",
      pairingId: "019bf66d-29df-7a41-950f-c4b36a9d61bd"
    });
    expect(credentials.current).toEqual({
      displayName: "Increader",
      installationId: "019bf66c-42ac-7c33-b57d-e2131af04fe9",
      origin: "https://reader.example",
      pairingId: "019bf66d-29df-7a41-950f-c4b36a9d61bd",
      renewalCredential: "bcr_persisted"
    });
    expect(JSON.stringify(credentials.current)).not.toContain("bca_memory_only");
    await expect(pairing.accessToken()).resolves.toBe("bca_memory_only");
  });

  it("revokes the old server credential before completing a destination replacement", async () => {
    const store = new MemoryDestinationStore("https://old.example");
    const credentials = new MemoryCredentialStore();
    credentials.current = {
      displayName: "Old Reader",
      installationId: "019bf66c-42ac-7c33-b57d-e2131af04fe9",
      origin: "https://old.example",
      pairingId: "019bf66d-29df-7a41-950f-c4b36a9d61bd",
      renewalCredential: "bcr_old"
    };
    const permissions = new MemoryPermissions(
      new Set(["https://old.example/*"])
    );
    const revoked: Array<{ origin: string; renewalCredential: string }> = [];
    const pairing = createPairing({
      credentials,
      discovery: {
        discover: () => Promise.resolve(validDiscovery)
      },
      identity: {
        callbackUri: () =>
          "https://haipjkpamjpojalajcgfeggbjhifjpnn.chromiumapp.org/browser-capture",
        launch: (url) => {
          const request = new URL(url);
          const callback = request.searchParams.get("callback_uri") ?? "";
          const state = request.searchParams.get("state") ?? "";
          return Promise.resolve(`${callback}?code=bcc_new_code&state=${state}`);
        }
      },
      installation: {
        id: () =>
          Promise.resolve("019bf66c-42ac-7c33-b57d-e2131af04fe9"),
        name: "Chrome on Linux"
      },
      permissions,
      protocol: {
        exchange: () =>
          Promise.resolve({
            accessToken: "bca_new",
            expiresInSeconds: 600,
            pairingId: "019bf66e-16b5-722e-be5d-b40495258ae4",
            renewalCredential: "bcr_new",
            renewalExpiresInSeconds: 7_776_000,
            tokenType: "Bearer"
          }),
        renew: () => Promise.reject(new Error("not used")),
        revoke: (origin, request) => {
          revoked.push({
            origin,
            renewalCredential: request.renewalCredential
          });
          return Promise.resolve();
        }
      },
      store
    });

    await pairing.connect("https://new.example");

    expect(revoked).toEqual([
      {
        origin: "https://old.example",
        renewalCredential: "bcr_old"
      }
    ]);
    expect([...permissions.granted]).toEqual(["https://new.example/*"]);
    expect(credentials.current).toMatchObject({
      renewalCredential: "bcr_new"
    });
  });

  it("renews on demand after restart and disconnects with the rotated credential", async () => {
    const store = new MemoryDestinationStore("https://reader.example");
    const credentials = new MemoryCredentialStore();
    credentials.current = {
      displayName: "Home Reader",
      installationId: "019bf66c-42ac-7c33-b57d-e2131af04fe9",
      origin: "https://reader.example",
      pairingId: "019bf66d-29df-7a41-950f-c4b36a9d61bd",
      renewalCredential: "bcr_before_restart"
    };
    const permissions = new MemoryPermissions(
      new Set(["https://reader.example/*"])
    );
    const revoked: string[] = [];
    const pairing = createPairing({
      credentials,
      discovery: {
        discover: () => Promise.reject(new Error("not used"))
      },
      identity: {
        callbackUri: () => "",
        launch: () => Promise.reject(new Error("not used"))
      },
      installation: {
        id: () => Promise.reject(new Error("not used")),
        name: "Firefox on Linux"
      },
      permissions,
      protocol: {
        exchange: () => Promise.reject(new Error("not used")),
        renew: (_origin, request) => {
          expect(request.renewalCredential).toBe("bcr_before_restart");
          return Promise.resolve({
            accessToken: "bca_after_restart",
            expiresInSeconds: 600,
            pairingId: "019bf66d-29df-7a41-950f-c4b36a9d61bd",
            renewalCredential: "bcr_after_restart",
            renewalExpiresInSeconds: 7_776_000,
            tokenType: "Bearer"
          });
        },
        revoke: (_origin, request) => {
          revoked.push(request.renewalCredential);
          return Promise.resolve();
        }
      },
      store
    });

    await expect(pairing.accessToken()).resolves.toBe("bca_after_restart");
    await pairing.disconnect();

    expect(revoked).toEqual(["bcr_after_restart"]);
    expect(credentials.current).toBeNull();
    expect(store.current).toBeNull();
    expect([...permissions.granted]).toEqual([]);
  });
});

class MemoryCredentialStore implements CredentialStore {
  current: Awaited<ReturnType<CredentialStore["load"]>> = null;

  load() {
    return Promise.resolve(this.current);
  }

  save(value: NonNullable<Awaited<ReturnType<CredentialStore["load"]>>>) {
    this.current = value;
    return Promise.resolve();
  }

  clear() {
    this.current = null;
    return Promise.resolve();
  }
}
