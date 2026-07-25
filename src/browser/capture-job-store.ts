import type {
  CaptureJobRecord,
  CaptureJobStore,
} from "../capture-job/capture-job";

const STORE_NAME = "capture-job";
const CURRENT_JOB_KEY = "current";
const DOCUMENT_BYTES_LIMIT = 5 * 1024 * 1024;
const MANIFEST_BYTES_LIMIT = 512 * 1024;
const ASSET_BYTES_LIMIT = 8 * 1024 * 1024;
const AGGREGATE_ASSET_BYTES_LIMIT = 50 * 1024 * 1024;
const ASSET_RECORDS_LIMIT = 1_000;
const CAPTURED_ASSETS_LIMIT = 60;
const URL_BYTES_LIMIT = 8_192;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ASSET_ID_PATTERN = /^asset-[0-9]{4}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ASSET_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
]);
const UNAVAILABLE_REASONS = new Set([
  "acquisition_failed",
  "timeout",
  "unsupported_type",
  "asset_too_large",
  "binary_limit",
  "aggregate_limit",
]);

export function createIndexedDbCaptureJobStore(
  factory: IDBFactory = indexedDB,
  databaseName = "increader-browser-capture",
): CaptureJobStore {
  let database: Promise<IDBDatabase> | null = null;
  const validatedPackages = new WeakSet();

  const open = (): Promise<IDBDatabase> => {
    database ??= new Promise((resolve, reject) => {
      const request = factory.open(databaseName, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(request.error ?? new Error("Capture Job storage is unavailable."));
      };
    });
    return database;
  };

  return {
    async load() {
      const db = await open();
      const transaction = db.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(CURRENT_JOB_KEY);
      const value = await requestResult<unknown>(request);
      if (await isCaptureJobRecord(value, validatedPackages)) {
        return value as CaptureJobRecord;
      }
      if (value !== undefined) {
        const clearTransaction = db.transaction(STORE_NAME, "readwrite");
        clearTransaction.objectStore(STORE_NAME).delete(CURRENT_JOB_KEY);
        await transactionComplete(clearTransaction);
      }
      return null;
    },

    async save(record) {
      if (!(await isCaptureJobRecord(record, validatedPackages))) {
        throw new Error("Capture Job record is invalid.");
      }
      const db = await open();
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(record, CURRENT_JOB_KEY);
      await transactionComplete(transaction);
    },

    async clear() {
      const db = await open();
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(CURRENT_JOB_KEY);
      await transactionComplete(transaction);
    },
  };
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("Capture Job storage is unavailable."));
    };
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => {
      resolve();
    };
    transaction.onabort = transaction.onerror = () => {
      reject(
        transaction.error ?? new Error("Capture Job storage is unavailable."),
      );
    };
  });
}

async function isCaptureJobRecord(
  value: unknown,
  validatedPackages: WeakSet<object>,
): Promise<boolean> {
  if (!isRecord(value) || typeof value.phase !== "string") return false;
  if (value.phase === "capturing") {
    return (
      isUuid(value.attemptId) &&
      isOrigin(value.origin) &&
      isRecord(value.page) &&
      value.page.kind === "supported" &&
      Number.isSafeInteger(value.page.tabId) &&
      (value.page.tabId as number) >= 0 &&
      isSafeUrl(value.page.sourceUrl) &&
      isBoundedString(value.page.title, 4_096)
    );
  }
  if (value.phase === "capture-failed") {
    return isUuid(value.attemptId) && isBoundedString(value.message, 2_048);
  }
  if (value.phase === "completed") {
    return (
      isUuid(value.captureId) &&
      (value.outcome === "created" || value.outcome === "existing") &&
      Number.isSafeInteger(value.bookmarkId) &&
      (value.bookmarkId as number) > 0 &&
      isBoundedString(value.title, 4_096) &&
      isOrigin(value.origin)
    );
  }
  if (
    value.phase !== "staged" &&
    value.phase !== "sending" &&
    value.phase !== "failed"
  ) {
    return false;
  }
  if (
    !isOrigin(value.origin) ||
    !(await isStagedPackage(value.package, validatedPackages))
  ) {
    return false;
  }
  if (value.phase !== "failed") return true;
  const retryAfterSeconds = value.retryAfterSeconds;
  const retryNotBeforeEpochMs = value.retryNotBeforeEpochMs;
  const futureRetryDelay =
    typeof retryNotBeforeEpochMs === "number"
      ? retryNotBeforeEpochMs - Date.now()
      : null;
  return (
    isBoundedString(value.message, 2_048) &&
    typeof value.retryable === "boolean" &&
    (retryAfterSeconds === undefined ||
      (value.retryable &&
        Number.isSafeInteger(retryAfterSeconds) &&
        (retryAfterSeconds as number) > 0 &&
        (retryAfterSeconds as number) <= 3_600)) &&
    ((retryAfterSeconds === undefined &&
      retryNotBeforeEpochMs === undefined) ||
      (value.retryable &&
        retryAfterSeconds !== undefined &&
        Number.isSafeInteger(retryNotBeforeEpochMs) &&
        (retryNotBeforeEpochMs as number) > 0 &&
        futureRetryDelay !== null &&
        futureRetryDelay <= (retryAfterSeconds as number) * 1_000))
  );
}

async function isStagedPackage(
  value: unknown,
  validatedPackages: WeakSet<object>,
): Promise<boolean> {
  if (
    !isRecord(value) ||
    !isRecord(value.manifest) ||
    typeof value.documentHtml !== "string" ||
    !Array.isArray(value.assetParts)
  ) {
    return false;
  }
  if (validatedPackages.has(value)) return true;
  const manifest = value.manifest;
  const documentBytes = new TextEncoder().encode(value.documentHtml);
  if (
    documentBytes.byteLength === 0 ||
    documentBytes.byteLength > DOCUMENT_BYTES_LIMIT ||
    !isUuid(manifest.captureId) ||
    !isIsoInstant(manifest.capturedAt) ||
    !isSafeUrl(manifest.sourceUrl) ||
    !isSafeUrl(manifest.baseUrl) ||
    (manifest.canonicalUrl !== undefined &&
      !isSafeUrl(manifest.canonicalUrl)) ||
    (manifest.title !== undefined &&
      !isBoundedCodePointString(manifest.title, 1_024)) ||
    (manifest.language !== undefined &&
      (typeof manifest.language !== "string" ||
        !/^[A-Za-z0-9-]{1,35}$/.test(manifest.language))) ||
    !isRecord(manifest.document) ||
    manifest.document.bytes !== documentBytes.byteLength ||
    !isSha256(manifest.document.sha256) ||
    !isRecord(manifest.producer) ||
    !isBoundedString(manifest.producer.browser, 128) ||
    !isBoundedString(manifest.producer.extensionVersion, 128) ||
    !Array.isArray(manifest.assets) ||
    manifest.assets.length > ASSET_RECORDS_LIMIT ||
    value.assetParts.length > CAPTURED_ASSETS_LIMIT
  ) {
    return false;
  }
  let serializedManifest: string;
  try {
    serializedManifest = JSON.stringify(manifest);
  } catch {
    return false;
  }
  if (
    new TextEncoder().encode(serializedManifest).byteLength >
      MANIFEST_BYTES_LIMIT ||
    (await sha256Hex(documentBytes)) !== manifest.document.sha256
  ) {
    return false;
  }

  const parts = new Map<string, Record<string, unknown>>();
  for (const part of value.assetParts) {
    if (
      !isRecord(part) ||
      !ASSET_ID_PATTERN.test(String(part.id)) ||
      typeof part.id !== "string" ||
      typeof part.mediaType !== "string" ||
      !ASSET_MEDIA_TYPES.has(part.mediaType) ||
      !(part.data instanceof Blob) ||
      part.data.type !== part.mediaType ||
      part.data.size > ASSET_BYTES_LIMIT ||
      parts.has(part.id)
    ) {
      return false;
    }
    parts.set(part.id, part);
  }

  const ids = new Set<string>();
  const orderedIds: string[] = [];
  let capturedCount = 0;
  let capturedBytes = 0;
  for (const asset of manifest.assets) {
    if (
      !isRecord(asset) ||
      typeof asset.id !== "string" ||
      !ASSET_ID_PATTERN.test(asset.id) ||
      ids.has(asset.id) ||
      !isAssetSource(asset.sourceUrl)
    ) {
      return false;
    }
    ids.add(asset.id);
    orderedIds.push(asset.id);
    if (asset.status === "unavailable") {
      if (
        typeof asset.reason !== "string" ||
        !UNAVAILABLE_REASONS.has(asset.reason) ||
        parts.has(asset.id) ||
        "mediaType" in asset ||
        "bytes" in asset ||
        "sha256" in asset
      ) {
        return false;
      }
      continue;
    }
    if (
      asset.status !== "captured" ||
      typeof asset.mediaType !== "string" ||
      !ASSET_MEDIA_TYPES.has(asset.mediaType) ||
      !Number.isSafeInteger(asset.bytes) ||
      (asset.bytes as number) <= 0 ||
      (asset.bytes as number) > ASSET_BYTES_LIMIT ||
      !isSha256(asset.sha256) ||
      "reason" in asset
    ) {
      return false;
    }
    const part = parts.get(asset.id);
    const partBytes =
      part?.data instanceof Blob
        ? new Uint8Array(await part.data.arrayBuffer())
        : null;
    if (
      part === undefined ||
      part.mediaType !== asset.mediaType ||
      !(part.data instanceof Blob) ||
      part.data.size !== asset.bytes ||
      partBytes === null ||
      !matchesMediaType(partBytes, asset.mediaType) ||
      (await sha256Hex(partBytes)) !== asset.sha256
    ) {
      return false;
    }
    capturedCount += 1;
    capturedBytes += asset.bytes;
  }
  const markerIds = markerAttributeIds(value.documentHtml);
  if (markerIds === null) return false;
  const firstMarkerIds = markerIds.filter(
    (id, index) => markerIds.indexOf(id) === index,
  );
  const valid =
    parts.size === capturedCount &&
    capturedCount <= CAPTURED_ASSETS_LIMIT &&
    capturedBytes <= AGGREGATE_ASSET_BYTES_LIMIT &&
    firstMarkerIds.length === orderedIds.length &&
    firstMarkerIds.every((id, index) => id === orderedIds[index]);
  if (valid) validatedPackages.add(value);
  return valid;
}

function markerAttributeIds(html: string): string[] | null {
  const marker = "increader:browser-capture-asset/";
  const ids: string[] = [];
  const tags = scanHtmlTags(html);
  if (tags === null) return null;
  for (const tag of tags) {
    if (!tag.includes(marker)) continue;
    if (tag.startsWith("<!--")) continue;
    if (!/^<img(?:\s|\/?>)/i.test(tag)) return null;
    const sourceAttributes = [
      ...tag.matchAll(/\ssrc\s*=\s*(["'])(.*?)\1/gi),
    ];
    const markerSources = sourceAttributes.filter((match) =>
      match[2]?.includes(marker),
    );
    if (sourceAttributes.length !== 1 || markerSources.length !== 1) {
      return null;
    }
    const source = markerSources[0]?.[2];
    if (
      source === undefined ||
      !new RegExp(`^${marker}asset-[0-9]{4}$`).test(source)
    ) {
      return null;
    }
    const withoutMarkerSource = tag.replace(markerSources[0]?.[0] ?? "", "");
    if (withoutMarkerSource.includes(marker)) return null;
    ids.push(source.slice(marker.length));
  }
  return ids;
}

function scanHtmlTags(html: string): string[] | null {
  const tags: string[] = [];
  for (let start = html.indexOf("<"); start >= 0; ) {
    let quote: '"' | "'" | null = null;
    let end = start + 1;
    for (; end < html.length; end += 1) {
      const character = html[end];
      if (quote !== null) {
        if (character === quote) quote = null;
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === ">") {
        break;
      }
    }
    if (end >= html.length) return null;
    tags.push(html.slice(start, end + 1));
    start = html.indexOf("<", end + 1);
  }
  return tags;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isBoundedString(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    new TextEncoder().encode(value).byteLength <= maximum
  );
}

function isBoundedCodePointString(
  value: unknown,
  maximum: number,
): value is string {
  return typeof value === "string" && Array.from(value).length <= maximum;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function isIsoInstant(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function isOrigin(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === "" &&
      url.hash === "" &&
      (url.protocol === "https:" || isLoopbackHost(url.hostname)) &&
      url.origin === value
    );
  } catch {
    return false;
  }
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
  );
}

function isSafeUrl(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    new TextEncoder().encode(value).byteLength > URL_BYTES_LIMIT
  ) {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

function isAssetSource(value: unknown): value is string {
  if (value === "data:") return true;
  if (typeof value !== "string") return false;
  if (value.startsWith("blob:")) {
    return isSafeUrl(value.slice("blob:".length));
  }
  return isSafeUrl(value);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buffer = await globalThis.crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(bytes).buffer,
  );
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function matchesMediaType(bytes: Uint8Array, mediaType: unknown): boolean {
  if (mediaType === "image/png") {
    return startsWith(bytes, [
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
  }
  if (mediaType === "image/jpeg") {
    return startsWith(bytes, [0xff, 0xd8, 0xff]);
  }
  if (mediaType === "image/gif") {
    return (
      startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
      startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
    );
  }
  if (mediaType === "image/webp") {
    return (
      startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
      startsWith(bytes.slice(8), [0x57, 0x45, 0x42, 0x50])
    );
  }
  if (mediaType === "image/avif") {
    if (
      bytes.length < 16 ||
      !startsWith(bytes.slice(4), [0x66, 0x74, 0x79, 0x70])
    ) {
      return false;
    }
    const declaredLength =
      (((bytes[0] ?? 0) << 24) |
        ((bytes[1] ?? 0) << 16) |
        ((bytes[2] ?? 0) << 8) |
        (bytes[3] ?? 0)) >>>
      0;
    const end =
      declaredLength > 0
        ? Math.min(bytes.length, declaredLength)
        : bytes.length;
    for (let offset = 8; offset + 4 <= end; offset += 4) {
      const brand = String.fromCharCode(...bytes.slice(offset, offset + 4));
      if (brand === "avif" || brand === "avis") return true;
    }
    return false;
  }
  return false;
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}
