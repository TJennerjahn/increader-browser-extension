import {
  createAccountClientFactory,
  createAuthenticationStore,
} from "./browser/auth-adapters";
import { createAuthentication } from "./auth/authentication";
import { registerAuthenticationRuntime } from "./browser/auth-runtime";
import {
  createCaptureFailureNotifier,
  createOriginBoundAccessToken,
  registerCaptureJobRuntime,
  registerCaptureNotificationOpen,
} from "./browser/capture-job-runtime";
import { createIndexedDbCaptureJobStore } from "./browser/capture-job-store";
import { registerPopupKeepAlive } from "./browser/popup-lifetime";
import { createCaptureJob } from "./capture-job/capture-job";
import { createCapturePackageAssembler } from "./capture-package/capture-package";
import { createCapturePackageHttpClient } from "./protocol/capture-package-http";

const authentication = createAuthentication(
  createAuthenticationStore(),
  createAccountClientFactory(),
);
registerPopupKeepAlive();
registerAuthenticationRuntime(authentication);
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
  accessToken: createOriginBoundAccessToken(authentication),
  capture: (page, progress, signal) =>
    assembler.capture(page, progress, signal),
  notifyFailure: createCaptureFailureNotifier(),
  store: createIndexedDbCaptureJobStore(),
  transfer: (origin, accessToken, staged, signal) =>
    protocol.transfer(origin, accessToken, staged, signal),
});

registerCaptureJobRuntime(job);
registerCaptureNotificationOpen();
