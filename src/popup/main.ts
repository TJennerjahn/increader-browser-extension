import {
  createBrowserIdentityFlow,
  createCredentialStore,
  createDestinationStore,
  createInstallationIdentity,
  createRuntimeOriginPermissions,
  createTabOpener,
} from "../browser/chrome-adapters";
import { createActivePageInspector } from "../browser/active-page";
import { createPairing } from "../pairing/pairing";
import { createDiscoveryHttpClient } from "../protocol/discovery-http";
import { createPairingHttpClient } from "../protocol/pairing-http";
import { createBookmarkLookupHttpClient } from "../protocol/bookmark-lookup-http";
import { mountPopup } from "./popup";

const root = document.querySelector<HTMLElement>("#app");
if (root === null) {
  throw new Error("Popup root is missing");
}

const pairing = createPairing({
  credentials: createCredentialStore(),
  discovery: createDiscoveryHttpClient(),
  identity: createBrowserIdentityFlow(),
  installation: createInstallationIdentity(),
  permissions: createRuntimeOriginPermissions(),
  protocol: createPairingHttpClient(),
  store: createDestinationStore(),
});

mountPopup(root, pairing, {
  activePage: createActivePageInspector(),
  lookup: createBookmarkLookupHttpClient(),
  openReader: createTabOpener(),
});
