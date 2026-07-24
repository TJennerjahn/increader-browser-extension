import {
  createDestinationStore,
  createRuntimeOriginPermissions
} from "../browser/chrome-adapters";
import { createPairing } from "../pairing/pairing";
import { createDiscoveryHttpClient } from "../protocol/discovery-http";
import { mountPopup } from "./popup";

const root = document.querySelector<HTMLElement>("#app");
if (root === null) {
  throw new Error("Popup root is missing");
}

mountPopup(
  root,
  createPairing({
    discovery: createDiscoveryHttpClient(),
    permissions: createRuntimeOriginPermissions(),
    store: createDestinationStore()
  })
);
