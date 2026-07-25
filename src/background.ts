import {
  createBrowserIdentityFlow,
  createCredentialStore,
  createDestinationStore,
  createInstallationIdentity,
  createPairingOperationStore,
  createRuntimeOriginPermissions,
} from "./browser/chrome-adapters";
import {
  createCaptureFailureNotifier,
  createOriginBoundAccessToken,
  registerCaptureJobRuntime,
  registerCaptureNotificationOpen,
} from "./browser/capture-job-runtime";
import { createIndexedDbCaptureJobStore } from "./browser/capture-job-store";
import { registerPairingRuntime } from "./browser/pairing-runtime";
import { registerPopupKeepAlive } from "./browser/popup-lifetime";
import { createCaptureJob } from "./capture-job/capture-job";
import { createCapturePackageAssembler } from "./capture-package/capture-package";
import { createPairing } from "./pairing/pairing";
import { createCapturePackageHttpClient } from "./protocol/capture-package-http";
import { createDiscoveryHttpClient } from "./protocol/discovery-http";
import { createPairingHttpClient } from "./protocol/pairing-http";

const pairing = createPairing({
  credentials: createCredentialStore(),
  discovery: createDiscoveryHttpClient(),
  identity: createBrowserIdentityFlow(),
  installation: createInstallationIdentity(),
  permissions: createRuntimeOriginPermissions(),
  protocol: createPairingHttpClient(),
  store: createDestinationStore(),
});
registerPopupKeepAlive();
registerPairingRuntime(pairing, {
  operationStore: createPairingOperationStore(),
});
const manifest = chrome.runtime.getManifest() as chrome.runtime.ManifestV3 & {
  browser_specific_settings?: unknown;
};
const assembler = createCapturePackageAssembler({
  producer: {
    browser:
      manifest.browser_specific_settings === undefined ? "Chrome" : "Firefox",
    extensionVersion: manifest.version,
  },
});
const protocol = createCapturePackageHttpClient();
const job = createCaptureJob({
  accessToken: createOriginBoundAccessToken(pairing),
  capture: (page, progress, signal) =>
    assembler.capture(page, progress, signal),
  notifyFailure: createCaptureFailureNotifier(),
  store: createIndexedDbCaptureJobStore(),
  transfer: (origin, accessToken, staged, signal) =>
    protocol.transfer(origin, accessToken, staged, signal),
});

registerCaptureJobRuntime(job);
registerCaptureNotificationOpen();
