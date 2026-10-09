// The production Capture Job wiring with synthetic authentication only. Loading
// this as a Firefox event page lets the harness close every extension document.
import { createCapturePackageAssembler } from "../../src/capture-package/capture-package";
import { createIndexedDbCaptureJobStore } from "../../src/browser/capture-job-store";
import { registerCaptureJobRuntime } from "../../src/browser/capture-job-runtime";
import { createCaptureJob } from "../../src/capture-job/capture-job";
import { createCapturePackageHttpClient } from "../../src/protocol/capture-package-http";

const assembler = createCapturePackageAssembler({ producer: { browser: "Firefox", extensionVersion: "qualification" } });
const protocol = createCapturePackageHttpClient();
const job = createCaptureJob({
  accessToken: () => Promise.resolve("synthetic-qualification-token"),
  capture: (page, progress, signal, options) => assembler.capture(page, progress, signal, options),
  transfer: (origin, token, staged, signal) => protocol.transfer(origin, token, staged, signal),
  store: createIndexedDbCaptureJobStore(),
  notifyFailure: () => Promise.resolve(),
});
registerCaptureJobRuntime(job);
