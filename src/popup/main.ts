import {
  createConnectionOriginPreferenceStore,
  createTabOpener,
} from "../browser/chrome-adapters";
import { createActivePageInspector } from "../browser/active-page";
import { createBookmarkLookupHttpClient } from "../protocol/bookmark-lookup-http";
import { createCaptureJobClient } from "../browser/capture-job-runtime";
import { createAuthenticationClient } from "../browser/auth-runtime";
import { holdBackgroundForPopup } from "../browser/popup-lifetime";
import { mountPopup } from "./popup";

const root = document.querySelector<HTMLElement>("#app");
if (root === null) {
  throw new Error("Popup root is missing");
}

const authentication = createAuthenticationClient();
const releaseBackground = holdBackgroundForPopup();

const unmount = mountPopup(
  root,
  authentication,
  {
    activePage: createActivePageInspector(),
    captureJob: createCaptureJobClient(),
    lookup: createBookmarkLookupHttpClient(),
    openReader: createTabOpener(),
  },
  createConnectionOriginPreferenceStore(),
);

globalThis.addEventListener(
  "unload",
  () => {
    unmount();
    releaseBackground();
  },
  { once: true },
);
