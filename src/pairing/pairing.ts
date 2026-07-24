import type { BrowserCaptureDiscovery } from "../protocol/discovery";
import { normalizeInstanceOrigin } from "./instance-origin";

export interface Pairing {
  currentOrigin(): Promise<string | null>;
  discover(candidate: string): Promise<DiscoveredDestination>;
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

export interface RuntimeOriginPermissions {
  contains(pattern: string): Promise<boolean>;
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
}

export function createPairing({
  store,
  permissions,
  discovery
}: PairingDependencies): Pairing {
  return {
    currentOrigin: () => store.load(),

    async discover(candidate) {
      const origin = normalizeInstanceOrigin(candidate);
      const pattern = originPermissionPattern(origin);
      const previous = await store.load();
      const alreadyGranted = await permissions.contains(pattern);
      const granted = alreadyGranted || (await permissions.request(pattern));

      if (!granted) {
        throw new Error(
          "Permission to reach this Increader instance was not granted."
        );
      }

      try {
        const result = await discovery.discover(origin);
        await store.save(origin);
        if (previous !== null && previous !== origin) {
          await permissions.remove(originPermissionPattern(previous));
        }
        return {
          origin,
          displayName: result.displayName,
          pairingAvailable: result.pairingAvailable
        };
      } catch {
        if (!alreadyGranted && previous !== origin) {
          await permissions.remove(pattern);
        }
        throw new Error(
          "Could not connect to a compatible Increader instance."
        );
      }
    },

    async disconnect() {
      const current = await store.load();
      await store.clear();
      if (current !== null) {
        await permissions.remove(originPermissionPattern(current));
      }
    }
  };
}

export function originPermissionPattern(origin: string): string {
  return `${normalizeInstanceOrigin(origin)}/*`;
}
