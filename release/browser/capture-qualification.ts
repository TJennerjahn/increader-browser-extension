import { createCaptureJobClient } from "../../src/browser/capture-job-runtime";
import { createCapturePackageAssembler } from "../../src/capture-package/capture-package";
import { createIndexedDbCaptureJobStore } from "../../src/browser/capture-job-store";
import { createCaptureJob } from "../../src/capture-job/capture-job";
import { createCapturePackageHttpClient } from "../../src/protocol/capture-package-http";

const assembler = createCapturePackageAssembler({
  producer: { browser: "Firefox", extensionVersion: "qualification" },
});
const store = createIndexedDbCaptureJobStore();
const protocol = createCapturePackageHttpClient();
Object.assign(globalThis, {
  async startBackgroundCapture(sourceUrl: string, origin: string) {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((candidate) => candidate.url === sourceUrl);
    if (tab?.id === undefined) throw new Error("Fixture tab missing");
    return createCaptureJobClient().startImport({ kind: "supported", tabId: tab.id, sourceUrl, title: tab.title ?? "" }, origin);
  },
  readBackgroundCapture: () => createCaptureJobClient().current(),
  async qualifyCapture(sourceUrl: string, transferOrigin: string, accessToken?: string) {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((candidate) => candidate.url === sourceUrl);
    if (tab?.id === undefined) throw new Error(`Fixture tab missing: ${JSON.stringify(tabs.map((candidate) => candidate.url))}`);
    await store.clear();
    const started = performance.now();
    let tokenRequests = 0;
    const job = createCaptureJob({
      accessToken: () => Promise.resolve(accessToken ?? `synthetic-qualification-token-${String(++tokenRequests)}`),
      capture: (page, progress, signal, options) => assembler.capture(page, progress, signal, options),
      transfer: (origin, token, staged, signal) => protocol.transfer(origin, token, staged, signal),
      store,
      notifyFailure: () => Promise.resolve(),
    });
    const customOptions = sourceUrl.endsWith("/custom-options") || sourceUrl.endsWith("/retry-options") || sourceUrl.endsWith("/reconnect-options");
    await job.startImport({ kind: "supported", tabId: tab.id, sourceUrl, title: tab.title ?? "" }, transferOrigin, false, customOptions ? { titleOverride: "Firefox custom title 🌊", addToQueue: false } : undefined);
    return new Promise((resolve, reject) => {
      let retried = false;
      job.observe((state) => {
        if ((sourceUrl.endsWith("/retry-options") || sourceUrl.endsWith("/reconnect-options")) && state.phase === "failed" && state.retryable && !retried) {
          retried = true;
          void job.retry().catch(reject);
          return;
        }
        if (state.phase === "completed" || state.phase === "failed") {
          resolve({ state, milliseconds: Math.round(performance.now() - started) });
        }
      });
    });
  },
});
