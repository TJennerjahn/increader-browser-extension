import { createTabOpener } from "../browser/chrome-adapters";
import { createActivePageInspector } from "../browser/active-page";
import { createBookmarkLookupHttpClient } from "../protocol/bookmark-lookup-http";
import { createCaptureJobClient } from "../browser/capture-job-runtime";
import { createPairingClient } from "../browser/pairing-runtime";
import { holdBackgroundForPopup } from "../browser/popup-lifetime";
import { mountPopup } from "./popup";

const root = document.querySelector<HTMLElement>("#app");
if (root === null) {
  throw new Error("Popup root is missing");
}

const pairing = createPairingClient();
const releaseBackground = holdBackgroundForPopup();

const unmount = mountPopup(root, pairing, {
  activePage: createActivePageInspector(),
  captureJob: createCaptureJobClient(),
  lookup: createBookmarkLookupHttpClient(),
  openReader: createTabOpener(),
});

globalThis.addEventListener(
  "unload",
  () => {
    unmount();
    releaseBackground();
  },
  { once: true },
);
