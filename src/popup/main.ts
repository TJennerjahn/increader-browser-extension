import {
  createBrowserIdentityFlow,
  createCredentialStore,
  createDestinationStore,
  createInstallationIdentity,
  createRuntimeOriginPermissions
} from "../browser/chrome-adapters";
import { createPairing } from "../pairing/pairing";
import { createDiscoveryHttpClient } from "../protocol/discovery-http";
import { createPairingHttpClient } from "../protocol/pairing-http";
import { mountPopup } from "./popup";

const root = document.querySelector<HTMLElement>("#app");
if (root === null) {
  throw new Error("Popup root is missing");
}

mountPopup(
  root,
  createPairing({
    credentials: createCredentialStore(),
    discovery: createDiscoveryHttpClient(),
    identity: createBrowserIdentityFlow(),
    installation: createInstallationIdentity(),
    permissions: createRuntimeOriginPermissions(),
    protocol: createPairingHttpClient(),
    store: createDestinationStore()
  })
);
