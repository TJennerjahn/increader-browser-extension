import type { BrowserCaptureDiscovery } from "../protocol/discovery";
import type { components } from "../protocol/generated/browser-capture";
import { normalizeInstanceOrigin } from "./instance-origin";

export interface Pairing {
  current(): Promise<PairedDestination | null>;
  currentOrigin(): Promise<string | null>;
  discover(candidate: string): Promise<DiscoveredDestination>;
  connect(candidate: string): Promise<PairedDestination>;
  accessToken(): Promise<string>;
  disconnect(): Promise<void>;
}

export interface DiscoveredDestination {
  origin: string;
  displayName: string;
  pairingAvailable: boolean;
}

export interface DestinationStore {
  load(): Promise<string | null>;
  save(origin: string): Promise<void>;
  clear(): Promise<void>;
}

export interface StoredPairing extends PairedDestination {
  renewalCredential: string;
}

export interface CredentialStore {
  load(): Promise<StoredPairing | null>;
  save(value: StoredPairing): Promise<void>;
  clear(): Promise<void>;
}

export interface BrowserIdentityFlow {
  callbackUri(): string;
  launch(approvalUrl: string): Promise<string | undefined>;
}

export interface InstallationIdentity {
  id(): Promise<string>;
  name: string;
}

export interface PairingProtocolClient {
  exchange(
    origin: string,
    request: PairingExchangeRequest,
  ): Promise<PairingCredentials>;
  renew(
    origin: string,
    request: PairingRenewalRequest,
  ): Promise<PairingCredentials>;
  revoke(origin: string, request: PairingRenewalRequest): Promise<void>;
}

export type PairingExchangeRequest =
  components["schemas"]["BrowserCapturePairingExchange"];

export type PairingRenewalRequest =
  components["schemas"]["BrowserCapturePairingRenewal"];

export type PairingCredentials =
  components["schemas"]["BrowserCapturePairingCredentials"];

export interface PairedDestination {
  displayName: string;
  installationId: string;
  origin: string;
  pairingId: string;
}

export interface RuntimeOriginPermissions {
  contains(pattern: string): Promise<boolean>;
  equivalent?(firstPattern: string, secondPattern: string): boolean;
  request(pattern: string): Promise<boolean>;
  remove(pattern: string): Promise<void>;
}

export interface DiscoveryClient {
  discover(origin: string): Promise<BrowserCaptureDiscovery>;
}

interface PairingDependencies {
  store: DestinationStore;
  permissions: RuntimeOriginPermissions;
  discovery: DiscoveryClient;
  credentials?: CredentialStore;
  identity?: BrowserIdentityFlow;
  installation?: InstallationIdentity;
  protocol?: PairingProtocolClient;
}

export function createPairing({
  store,
  permissions,
  discovery,
  credentials,
  identity,
  installation,
  protocol,
}: PairingDependencies): Pairing {
  let memoryAccess: { token: string; expiresAt: number } | null = null;

  return {
    async current() {
      const stored = await credentials?.load();
      return stored === null || stored === undefined
        ? null
        : withoutCredential(stored);
    },

    currentOrigin: () => store.load(),

    async discover(candidate) {
      const origin = normalizeInstanceOrigin(candidate);
      const pattern = originPermissionPattern(origin);
      const previous = await store.load();
      const alreadyGranted = await permissions.contains(pattern);
      const granted = alreadyGranted || (await permissions.request(pattern));

      if (!granted) {
        throw new Error(
          "Permission to reach this Increader instance was not granted.",
        );
      }

      try {
        const result = await discovery.discover(origin);
        await store.save(origin);
        if (previous !== null && previous !== origin) {
          const previousPattern = originPermissionPattern(previous);
          if (!samePermission(permissions, previousPattern, pattern)) {
            await permissions.remove(previousPattern);
          }
        }
        return {
          origin,
          displayName: result.displayName,
          pairingAvailable: result.pairingAvailable,
        };
      } catch {
        if (!alreadyGranted && previous !== origin) {
          await permissions.remove(pattern);
        }
        throw new Error(
          "Could not connect to a compatible Increader instance.",
        );
      }
    },

    async connect(candidate) {
      if (
        credentials === undefined ||
        identity === undefined ||
        installation === undefined ||
        protocol === undefined
      ) {
        throw new Error("Browser Capture Pairing is not configured.");
      }

      const origin = normalizeInstanceOrigin(candidate);
      const pattern = originPermissionPattern(origin);
      const previous = await credentials.load();
      const alreadyGranted = await permissions.contains(pattern);
      const granted = alreadyGranted || (await permissions.request(pattern));
      if (!granted) {
        throw new Error(
          "Permission to reach this Increader instance was not granted.",
        );
      }

      try {
        const discovered = await discovery.discover(origin);
        if (!discovered.pairingAvailable) {
          throw new Error("This Increader instance is not accepting pairings.");
        }
        const installationId = await installation.id();
        const callbackUri = identity.callbackUri();
        const verifier = randomValue(48);
        const state = randomValue(32);
        const challenge = await s256(verifier);
        const approval = new URL(
          "/browser-capture/pairing/approve",
          `${origin}/`,
        );
        approval.searchParams.set("instance_origin", origin);
        approval.searchParams.set("installation_id", installationId);
        approval.searchParams.set("installation_name", installation.name);
        approval.searchParams.set("callback_uri", callbackUri);
        // Firefox's identity API inspects the standard OAuth parameter before
        // it opens the interactive authorization window. Increader keeps its
        // callback_uri name for the protocol payload, so send both names with
        // the same bound value.
        approval.searchParams.set("redirect_uri", callbackUri);
        approval.searchParams.set("state", state);
        approval.searchParams.set("code_challenge", challenge);
        approval.searchParams.set("code_challenge_method", "S256");

        const redirect = await identity.launch(approval.toString());
        if (redirect === undefined) {
          throw new Error("Pairing was cancelled.");
        }
        const returned = new URL(redirect);
        if (
          returned.origin + returned.pathname !==
            new URL(callbackUri).origin + new URL(callbackUri).pathname ||
          returned.searchParams.get("state") !== state
        ) {
          throw new Error("Pairing response did not match this browser.");
        }
        if (returned.searchParams.get("error") === "access_denied") {
          throw new Error("Pairing was cancelled.");
        }
        const authorizationCode = returned.searchParams.get("code");
        if (authorizationCode === null || authorizationCode.length < 8) {
          throw new Error("Pairing response was incomplete.");
        }

        const issued = await protocol.exchange(origin, {
          authorizationCode,
          callbackUri,
          codeVerifier: verifier,
          installationId,
          instanceOrigin: origin,
          state,
        });
        const paired: StoredPairing = {
          displayName: discovered.displayName,
          installationId,
          origin,
          pairingId: issued.pairingId,
          renewalCredential: issued.renewalCredential,
        };
        if (previous !== null && previous.origin !== origin) {
          try {
            await protocol.revoke(previous.origin, {
              installationId: previous.installationId,
              instanceOrigin: previous.origin,
              renewalCredential: previous.renewalCredential,
            });
          } catch {
            try {
              await protocol.revoke(origin, {
                installationId,
                instanceOrigin: origin,
                renewalCredential: issued.renewalCredential,
              });
            } catch {
              // The replacement remains uncommitted locally either way.
            }
            throw new Error(
              "Could not revoke the previously paired Increader instance.",
            );
          }
        }
        await credentials.save(paired);
        await store.save(origin);
        if (previous !== null && previous.origin !== origin) {
          const previousPattern = originPermissionPattern(previous.origin);
          if (!samePermission(permissions, previousPattern, pattern)) {
            await permissions.remove(previousPattern);
          }
        }
        memoryAccess = accessInMemory(issued);
        return withoutCredential(paired);
      } catch (error) {
        if (!alreadyGranted && previous?.origin !== origin) {
          await permissions.remove(pattern);
        }
        throw error;
      }
    },

    async accessToken() {
      if (memoryAccess !== null && memoryAccess.expiresAt > Date.now()) {
        return memoryAccess.token;
      }
      if (credentials === undefined || protocol === undefined) {
        throw new Error("Browser Capture Pairing is not configured.");
      }
      const current = await credentials.load();
      if (current === null) {
        throw new Error("Connect this browser to Increader first.");
      }
      const issued = await protocol.renew(current.origin, {
        installationId: current.installationId,
        instanceOrigin: current.origin,
        renewalCredential: current.renewalCredential,
      });
      await credentials.save({
        ...current,
        pairingId: issued.pairingId,
        renewalCredential: issued.renewalCredential,
      });
      memoryAccess = accessInMemory(issued);
      return issued.accessToken;
    },

    async disconnect() {
      const current =
        credentials === undefined ? null : await credentials.load();
      if (current !== null && protocol !== undefined) {
        await protocol.revoke(current.origin, {
          installationId: current.installationId,
          instanceOrigin: current.origin,
          renewalCredential: current.renewalCredential,
        });
      }
      const currentOrigin = current?.origin ?? (await store.load());
      await credentials?.clear();
      await store.clear();
      memoryAccess = null;
      if (currentOrigin !== null) {
        await permissions.remove(originPermissionPattern(currentOrigin));
      }
    },
  };
}

export function originPermissionPattern(origin: string): string {
  return `${normalizeInstanceOrigin(origin)}/*`;
}

function samePermission(
  permissions: RuntimeOriginPermissions,
  firstPattern: string,
  secondPattern: string,
): boolean {
  return (
    permissions.equivalent?.(firstPattern, secondPattern) ??
    firstPattern === secondPattern
  );
}

function randomValue(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function s256(verifier: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64Url(new Uint8Array(digest));
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function accessInMemory(credentials: PairingCredentials): {
  token: string;
  expiresAt: number;
} {
  return {
    token: credentials.accessToken,
    expiresAt:
      Date.now() + Math.max(1, credentials.expiresInSeconds - 30) * 1000,
  };
}

function withoutCredential(pairing: StoredPairing): PairedDestination {
  return {
    displayName: pairing.displayName,
    installationId: pairing.installationId,
    origin: pairing.origin,
    pairingId: pairing.pairingId,
  };
}
