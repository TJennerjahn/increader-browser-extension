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
import { createCapturePackageAssembler } from "../capture-package/capture-package";
import { createBrowserCaptureImporter } from "../capture-package/importer";
import { createCapturePackageHttpClient } from "../protocol/capture-package-http";
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
const manifest = chrome.runtime.getManifest() as chrome.runtime.ManifestV3 & {
  browser_specific_settings?: unknown;
};

mountPopup(root, pairing, {
  activePage: createActivePageInspector(),
  importer: createBrowserCaptureImporter(
    createCapturePackageAssembler({
      producer: {
        browser:
          manifest.browser_specific_settings === undefined
            ? "Chrome"
            : "Firefox",
        extensionVersion: manifest.version,
      },
    }),
    createCapturePackageHttpClient(),
  ),
  lookup: createBookmarkLookupHttpClient(),
  openReader: createTabOpener(),
});
