import type { components } from "./generated/browser-capture";

export type BrowserCaptureDiscovery =
  components["schemas"]["BrowserCaptureDiscovery"];

const INCOMPATIBLE_DESTINATION =
  "This destination does not support Increader Browser Capture.";

const REQUIRED_CAPABILITIES = [
  "pairing",
  "bookmark-lookup",
  "capture-package"
] as const;

const REQUIRED_LIMITS = [
  "multipartRequestBytes",
  "manifestBytes",
  "documentHtmlBytes",
  "domElements",
  "assetRecords",
  "binaryAssets",
  "assetBytes",
  "aggregateAssetBytes",
  "urlBytes",
  "titleCodePoints",
  "languageTagCharacters",
  "producerFieldCodePoints",
  "contentScriptChunkBytes",
  "assetReadConcurrency",
  "assetTimeoutMilliseconds",
  "captureDeadlineMilliseconds",
  "transferDeadlineMilliseconds",
  "inFlightTransfersPerPairing",
  "inFlightTransfersPerUser",
  "transferAttemptsPerUserHour",
  "idempotencyRetentionDays"
] as const;

export function parseDiscovery(value: unknown): BrowserCaptureDiscovery {
  if (!isRecord(value)) {
    throw incompatible();
  }
  const capabilities = value.capabilities;
  const limits = value.limits;
  const displayName = value.displayName;

  if (
    value.protocol !== "increader-browser-capture" ||
    typeof displayName !== "string" ||
    displayName.length === 0 ||
    Array.from(displayName).length > 80 ||
    typeof value.pairingAvailable !== "boolean" ||
    !Array.isArray(capabilities) ||
    !capabilities.every((capability) => typeof capability === "string") ||
    !REQUIRED_CAPABILITIES.every((required) => capabilities.includes(required)) ||
    !isRecord(limits) ||
    !REQUIRED_LIMITS.every((name) => isNonNegativeInteger(limits[name]))
  ) {
    throw incompatible();
  }

  return value as BrowserCaptureDiscovery;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): boolean {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function incompatible(): Error {
  return new Error(INCOMPATIBLE_DESTINATION);
}
