import type { ActivePageInspection } from "../browser/active-page";
import type { components } from "../protocol/generated/browser-capture";

const DOCUMENT_HTML_BYTES_LIMIT = 5 * 1024 * 1024;
const MANIFEST_BYTES_LIMIT = 512 * 1024;
const DOM_ELEMENTS_LIMIT = 100_000;
const ASSET_RECORDS_LIMIT = 1_000;
const CAPTURED_ASSETS_LIMIT = 60;
const ASSET_BYTES_LIMIT = 8 * 1024 * 1024;
const CAPTURED_ASSET_BYTES_LIMIT = 50 * 1024 * 1024;
const CONTENT_SCRIPT_CHUNK_BYTES = 192 * 1024;
const LANGUAGE_CHARACTERS_LIMIT = 35;
const TITLE_CODE_POINTS_LIMIT = 1_024;
const URL_BYTES_LIMIT = 8_192;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CapturedImageMediaType =
  "image/jpeg" | "image/png" | "image/gif" | "image/webp" | "image/avif";

export interface CapturedCaptureAsset {
  id: string;
  sourceUrl: string;
  status: "captured";
  mediaType: CapturedImageMediaType;
  bytes: number;
  sha256: string;
}

export interface UnavailableCaptureAsset {
  id: string;
  sourceUrl: string;
  status: "unavailable";
  reason:
    | "acquisition_failed"
    | "timeout"
    | "unsupported_type"
    | "asset_too_large"
    | "binary_limit"
    | "aggregate_limit";
}

export type CaptureAssetRecord = CapturedCaptureAsset | UnavailableCaptureAsset;

export interface CapturePackageManifest {
  captureId: string;
  capturedAt: string;
  sourceUrl: string;
  baseUrl: string;
  canonicalUrl?: string;
  title?: string;
  language?: string;
  document: components["schemas"]["BrowserCaptureDocumentDigest"];
  producer: components["schemas"]["BrowserCaptureProducer"];
  assets: CaptureAssetRecord[];
}

export interface StagedCaptureAssetPart {
  readonly id: string;
  readonly mediaType: CapturedImageMediaType;
  readonly data: Blob;
}

export interface StagedCapturePackage {
  readonly manifest: Readonly<CapturePackageManifest>;
  readonly documentHtml: string;
  readonly assetParts: readonly Readonly<StagedCaptureAssetPart>[];
}

export interface CapturePackageAssembler {
  capture(
    page: Extract<ActivePageInspection, { kind: "supported" }>,
    onProgress?: (progress: CapturePackageProgress) => void,
    signal?: AbortSignal,
  ): Promise<StagedCapturePackage>;
}

export interface CapturePackageProgress {
  completedAssets: number;
  totalAssets: number;
}

export class CapturePackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = CapturePackageError.name;
  }
}

interface CapturePackageAssemblerDependencies {
  scripting?: typeof chrome.scripting;
  promiseScripting?: PromiseScriptingApi;
  randomUuid?: () => string;
  now?: () => Date;
  producer: {
    extensionVersion: string;
    browser: string;
  };
}

interface CapturedTopLevelDocument {
  contentType: string;
  sourceUrl: string;
  baseUrl: string;
  canonicalUrl?: string;
  title?: string;
  language?: string;
  documentHtml: string;
  domElements: number;
  assets: CapturedPageAsset[];
}

interface CapturedPageAsset {
  id: string;
  sourceUrl: string;
  outcome:
    | {
        status: "captured";
        mediaType: CapturedImageMediaType;
        chunks: string[];
      }
    | {
        status: "unavailable";
        reason: UnavailableCaptureAsset["reason"];
      };
}

export function createCapturePackageAssembler({
  scripting = chrome.scripting,
  promiseScripting = firefoxScriptingApi(),
  randomUuid = () => globalThis.crypto.randomUUID(),
  now = () => new Date(),
  producer,
}: CapturePackageAssemblerDependencies): CapturePackageAssembler {
  return {
    async capture(page, onProgress, signal) {
      const injection = {
        func: captureTopLevelDocument,
        target: { tabId: page.tabId },
        world: "MAIN",
      } satisfies chrome.scripting.ScriptInjection<[], unknown>;
      const results =
        promiseScripting === undefined
          ? await callbackResult<chrome.scripting.InjectionResult<unknown>[]>(
              (done) => {
                scripting.executeScript(injection, done);
              },
            )
          : await promiseScripting.executeScript(injection);
      const captured = results.find((result) => result.frameId === 0)?.result;
      throwIfCaptureCancelled(signal);
      if (!isCapturedTopLevelDocument(captured)) {
        throw captureFailure("The active page could not be captured.");
      }
      if (captured.sourceUrl !== page.sourceUrl) {
        throw captureFailure("The active page changed before capture started.");
      }
      if (captured.contentType !== "text/html") {
        throw captureFailure("Only HTML pages can be imported.");
      }
      validateCapturedDocument(captured);

      const captureId = randomUuid();
      if (!UUID_PATTERN.test(captureId)) {
        throw captureFailure("A Capture ID could not be created.");
      }
      const documentBytes = new TextEncoder().encode(captured.documentHtml);
      const assets: CaptureAssetRecord[] = [];
      const assetParts: StagedCaptureAssetPart[] = [];
      let capturedAssetCount = 0;
      let capturedAssetBytes = 0;
      let aggregateLimitReached = false;
      onProgress?.({ completedAssets: 0, totalAssets: captured.assets.length });
      for (const [index, asset] of captured.assets.entries()) {
        throwIfCaptureCancelled(signal);
        if (asset.outcome.status === "unavailable") {
          assets.push({
            id: asset.id,
            sourceUrl: asset.sourceUrl,
            status: "unavailable",
            reason: asset.outcome.reason,
          });
          onProgress?.({
            completedAssets: index + 1,
            totalAssets: captured.assets.length,
          });
          continue;
        }
        const bytes = decodeChunks(asset.outcome.chunks);
        if (bytes.byteLength > ASSET_BYTES_LIMIT) {
          assets.push({
            id: asset.id,
            sourceUrl: asset.sourceUrl,
            status: "unavailable",
            reason: "asset_too_large",
          });
          onProgress?.({
            completedAssets: index + 1,
            totalAssets: captured.assets.length,
          });
          continue;
        }
        if (capturedAssetCount >= CAPTURED_ASSETS_LIMIT) {
          assets.push({
            id: asset.id,
            sourceUrl: asset.sourceUrl,
            status: "unavailable",
            reason: "binary_limit",
          });
          onProgress?.({
            completedAssets: index + 1,
            totalAssets: captured.assets.length,
          });
          continue;
        }
        if (aggregateLimitReached) {
          assets.push({
            id: asset.id,
            sourceUrl: asset.sourceUrl,
            status: "unavailable",
            reason: "aggregate_limit",
          });
          onProgress?.({
            completedAssets: index + 1,
            totalAssets: captured.assets.length,
          });
          continue;
        }
        if (
          capturedAssetBytes + bytes.byteLength >
          CAPTURED_ASSET_BYTES_LIMIT
        ) {
          aggregateLimitReached = true;
          assets.push({
            id: asset.id,
            sourceUrl: asset.sourceUrl,
            status: "unavailable",
            reason: "aggregate_limit",
          });
          onProgress?.({
            completedAssets: index + 1,
            totalAssets: captured.assets.length,
          });
          continue;
        }
        assets.push({
          id: asset.id,
          sourceUrl: asset.sourceUrl,
          status: "captured",
          mediaType: asset.outcome.mediaType,
          bytes: bytes.byteLength,
          sha256: await sha256Hex(bytes),
        });
        assetParts.push(
          Object.freeze({
            id: asset.id,
            mediaType: asset.outcome.mediaType,
            data: new Blob([Uint8Array.from(bytes).buffer], {
              type: asset.outcome.mediaType,
            }),
          }),
        );
        capturedAssetCount += 1;
        capturedAssetBytes += bytes.byteLength;
        onProgress?.({
          completedAssets: index + 1,
          totalAssets: captured.assets.length,
        });
      }
      throwIfCaptureCancelled(signal);
      const manifest: CapturePackageManifest = {
        captureId,
        capturedAt: now().toISOString(),
        sourceUrl: captured.sourceUrl,
        baseUrl: captured.baseUrl,
        ...(captured.canonicalUrl === undefined
          ? {}
          : { canonicalUrl: captured.canonicalUrl }),
        ...(captured.title === undefined ? {} : { title: captured.title }),
        ...(captured.language === undefined
          ? {}
          : { language: captured.language }),
        document: {
          bytes: documentBytes.byteLength,
          sha256: await sha256Hex(documentBytes),
        },
        producer: {
          extensionVersion: boundedProducerField(producer.extensionVersion),
          browser: boundedProducerField(producer.browser),
        },
        assets,
      };
      if (
        new TextEncoder().encode(JSON.stringify(manifest)).byteLength >
        MANIFEST_BYTES_LIMIT
      ) {
        throw captureFailure("Capture Package manifest is too large.");
      }
      Object.freeze(assetParts);
      return Object.freeze({
        manifest: freezeManifest(manifest),
        documentHtml: captured.documentHtml,
        assetParts,
      });
    },
  };
}

interface PromiseScriptingApi {
  executeScript(
    injection: chrome.scripting.ScriptInjection<[], unknown>,
  ): Promise<chrome.scripting.InjectionResult<unknown>[]>;
}

function firefoxScriptingApi(): PromiseScriptingApi | undefined {
  return (
    globalThis as typeof globalThis & {
      browser?: { scripting?: PromiseScriptingApi };
    }
  ).browser?.scripting;
}

function throwIfCaptureCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw captureFailure("Capture cancelled.");
  }
}

/**
 * This function is serialized by chrome.scripting, so every dependency used in
 * page context intentionally lives inside its body.
 */
async function captureTopLevelDocument(): Promise<CapturedTopLevelDocument> {
  const marker = "increader:browser-capture-asset/";
  const assetBytesLimit = 8 * 1024 * 1024;
  const assetRecordsLimit = 1_000;
  const capturedAssetsLimit = 60;
  const aggregateAssetBytesLimit = 50 * 1024 * 1024;
  const assetTimeoutMilliseconds = 15_000;
  const assetReadConcurrency = 4;
  const captureDeadlineAt = Date.now() + 90_000;
  const binaryChunkBytes = 192 * 1024;
  const lazyUrlAttributes = [
    "data-src",
    "data-original",
    "data-lazy-src",
    "data-src-url",
  ];
  const lazySrcsetAttributes = ["data-srcset", "data-lazy-srcset"];

  const resolveImageUrl = (value: string | null, base: URL): string | null => {
    if (value === null || value.trim() === "") return null;
    try {
      const resolved = new URL(value, base);
      if (
        (resolved.protocol !== "http:" &&
          resolved.protocol !== "https:" &&
          resolved.protocol !== "data:" &&
          resolved.protocol !== "blob:") ||
        resolved.username !== "" ||
        resolved.password !== "" ||
        resolved.href.startsWith(marker) ||
        new TextEncoder().encode(resolved.toString()).byteLength > 8_192
      ) {
        return null;
      }
      if (resolved.protocol === "blob:") {
        const nested = new URL(resolved.href.slice("blob:".length));
        if (
          (nested.protocol !== "http:" && nested.protocol !== "https:") ||
          nested.username !== "" ||
          nested.password !== "" ||
          nested.hash !== ""
        ) {
          return null;
        }
      }
      return resolved.toString();
    } catch {
      return null;
    }
  };
  const firstSrcsetCandidate = (
    value: string | null,
    base: URL,
  ): string | null => {
    if (value === null) return null;
    for (const candidate of value.split(",")) {
      const url = candidate.trim().split(/\s+/, 1)[0];
      const resolved = resolveImageUrl(url ?? null, base);
      if (resolved !== null) return resolved;
    }
    return null;
  };
  const isObviousLazyPlaceholder = (value: string): boolean => {
    const lower = value.toLowerCase();
    return (
      lower === "about:blank" ||
      lower.includes("transparent.gif") ||
      lower.includes("spacer.gif") ||
      lower.includes("pixel.gif") ||
      lower.startsWith(
        "data:image/gif;base64,r0lgodlhaqabaiaaaaaaap///ywaaaaaaqabaaacauwaow==",
      )
    );
  };
  const selectImageCandidate = (
    image: HTMLImageElement,
    base: URL,
  ): string | null => {
    const current = resolveImageUrl(image.currentSrc, base);
    if (current !== null && !isObviousLazyPlaceholder(current)) {
      return current;
    }
    for (const name of lazyUrlAttributes) {
      const lazy = resolveImageUrl(image.getAttribute(name), base);
      if (lazy !== null && !isObviousLazyPlaceholder(lazy)) {
        return lazy;
      }
    }
    for (const name of lazySrcsetAttributes) {
      const lazy = firstSrcsetCandidate(image.getAttribute(name), base);
      if (lazy !== null && !isObviousLazyPlaceholder(lazy)) {
        return lazy;
      }
    }
    const source = resolveImageUrl(image.getAttribute("src"), base);
    if (source !== null && !isObviousLazyPlaceholder(source)) {
      return source;
    }
    const responsive = firstSrcsetCandidate(image.getAttribute("srcset"), base);
    if (responsive !== null && !isObviousLazyPlaceholder(responsive)) {
      return responsive;
    }
    return current ?? source ?? responsive;
  };
  const removeResponsiveAlternatives = (image: Element): void => {
    for (const name of [
      "srcset",
      "sizes",
      ...lazyUrlAttributes,
      ...lazySrcsetAttributes,
    ]) {
      image.removeAttribute(name);
    }
  };
  const ascii = (bytes: Uint8Array, start: number, length: number): string =>
    String.fromCharCode(...bytes.slice(start, start + length));
  const sniffMediaType = (bytes: Uint8Array): CapturedImageMediaType | null => {
    if (
      bytes.length >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff
    ) {
      return "image/jpeg";
    }
    if (
      bytes.length >= 8 &&
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
        (value, index) => bytes[index] === value,
      )
    ) {
      return "image/png";
    }
    if (
      bytes.length >= 6 &&
      (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a")
    ) {
      return "image/gif";
    }
    if (
      bytes.length >= 12 &&
      ascii(bytes, 0, 4) === "RIFF" &&
      ascii(bytes, 8, 4) === "WEBP"
    ) {
      return "image/webp";
    }
    if (bytes.length >= 16 && ascii(bytes, 4, 4) === "ftyp") {
      const declaredBoxLength =
        ((bytes[0] ?? 0) << 24) |
        ((bytes[1] ?? 0) << 16) |
        ((bytes[2] ?? 0) << 8) |
        (bytes[3] ?? 0);
      const boxLength =
        declaredBoxLength > 0
          ? Math.min(bytes.length, declaredBoxLength)
          : bytes.length;
      for (let offset = 8; offset + 4 <= boxLength; offset += 4) {
        const brand = ascii(bytes, offset, 4);
        if (brand === "avif" || brand === "avis") {
          return "image/avif";
        }
      }
    }
    return null;
  };
  const encodeChunks = (bytes: Uint8Array): string[] => {
    const result: string[] = [];
    for (let start = 0; start < bytes.length; start += binaryChunkBytes) {
      const chunk = bytes.slice(start, start + binaryChunkBytes);
      let binary = "";
      for (const value of chunk) binary += String.fromCharCode(value);
      result.push(btoa(binary));
    }
    return result;
  };
  const acquire = async (
    sourceUrl: string,
  ): Promise<CapturedPageAsset["outcome"]> => {
    const remainingCaptureMilliseconds = captureDeadlineAt - Date.now();
    if (remainingCaptureMilliseconds <= 0) {
      return { status: "unavailable", reason: "timeout" };
    }
    const controller = new AbortController();
    const timeout = setTimeout(
      () => {
        controller.abort();
      },
      Math.min(assetTimeoutMilliseconds, remainingCaptureMilliseconds),
    );
    try {
      const response = await fetch(sourceUrl, {
        credentials: "include",
        signal: controller.signal,
      });
      if (!response.ok) {
        return { status: "unavailable", reason: "acquisition_failed" };
      }
      const declaredLength = Number(response.headers.get("Content-Length"));
      if (Number.isFinite(declaredLength) && declaredLength > assetBytesLimit) {
        await response.body?.cancel();
        return { status: "unavailable", reason: "asset_too_large" };
      }
      if (response.body === null) {
        return { status: "unavailable", reason: "acquisition_failed" };
      }
      const chunks: Uint8Array[] = [];
      let receivedBytes = 0;
      const reader = response.body.getReader();
      for (;;) {
        const result = await reader.read();
        if (result.done) break;
        receivedBytes += result.value.byteLength;
        if (receivedBytes > assetBytesLimit) {
          await reader.cancel();
          return { status: "unavailable", reason: "asset_too_large" };
        }
        chunks.push(result.value);
      }
      const bytes = new Uint8Array(receivedBytes);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const mediaType = sniffMediaType(bytes);
      if (mediaType === null) {
        return { status: "unavailable", reason: "unsupported_type" };
      }
      return {
        status: "captured",
        mediaType,
        chunks: encodeChunks(bytes),
      };
    } catch (error) {
      return {
        status: "unavailable",
        reason:
          error instanceof DOMException && error.name === "AbortError"
            ? "timeout"
            : "acquisition_failed",
      };
    } finally {
      clearTimeout(timeout);
    }
  };

  const source = new URL(location.href);
  source.hash = "";
  const base = new URL(document.baseURI);
  base.hash = "";
  const clone = document.documentElement.cloneNode(true) as HTMLElement;
  const liveImages = Array.from(document.querySelectorAll("img"));
  const clonedImages = Array.from(clone.querySelectorAll("img"));
  const domElements = clone.querySelectorAll("*").length + 1;
  clone
    .querySelectorAll(
      "script, iframe, frame, frameset, object, embed, canvas, video, audio",
    )
    .forEach((element) => {
      element.remove();
    });
  clone.querySelectorAll("style").forEach((element) => {
    element.remove();
  });
  clone.querySelectorAll("link").forEach((element) => {
    const relationships = new Set(
      element.rel.toLowerCase().split(/\s+/).filter(Boolean),
    );
    const resourceKind = element.getAttribute("as")?.toLowerCase();
    if (
      relationships.has("stylesheet") ||
      relationships.has("icon") ||
      relationships.has("apple-touch-icon") ||
      relationships.has("image_src") ||
      (relationships.has("preload") &&
        (resourceKind === "font" ||
          resourceKind === "image" ||
          resourceKind === "style"))
    ) {
      element.remove();
    }
  });
  clone.querySelectorAll("meta").forEach((element) => {
    const names = ["property", "name", "itemprop"].flatMap((attribute) =>
      (element.getAttribute(attribute) ?? "").toLowerCase().trim().split(/\s+/),
    );
    if (
      names.some((name) =>
        name.split(":").some((segment) => segment === "image"),
      )
    ) {
      element.remove();
    }
  });
  for (const element of [clone, ...Array.from(clone.querySelectorAll("*"))]) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (
        name.startsWith("on") ||
        name === "style" ||
        name.startsWith("data-increader-capture") ||
        name.startsWith("data-browser-capture")
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  }

  const candidates: Array<{
    id: string;
    acquisitionUrl: string;
    sourceUrl: string;
  }> = [];
  const assetsByCandidate = new Map<string, string>();
  for (let index = 0; index < liveImages.length; index += 1) {
    const liveImage = liveImages[index];
    const clonedImage = clonedImages[index];
    if (
      liveImage === undefined ||
      clonedImage === undefined ||
      !clone.contains(clonedImage)
    ) {
      continue;
    }
    const selected = selectImageCandidate(liveImage, base);
    removeResponsiveAlternatives(clonedImage);
    if (selected === null) {
      clonedImage.removeAttribute("src");
      continue;
    }
    let assetId = assetsByCandidate.get(selected);
    if (assetId === undefined) {
      if (candidates.length >= assetRecordsLimit) {
        throw new Error("The page contains too many selected images.");
      }
      assetId = `asset-${String(candidates.length + 1).padStart(4, "0")}`;
      assetsByCandidate.set(selected, assetId);
      candidates.push({
        id: assetId,
        acquisitionUrl: selected,
        sourceUrl: selected.startsWith("data:") ? "data:" : selected,
      });
    }
    clonedImage.setAttribute("src", `${marker}${assetId}`);
  }
  clone.querySelectorAll("picture source").forEach((element) => {
    element.remove();
  });
  const assets = new Array<CapturedPageAsset>(candidates.length);
  let capturedAssets = 0;
  let capturedBytes = 0;
  let binaryLimitReached = false;
  let aggregateLimitReached = false;
  for (
    let start = 0;
    start < candidates.length;
    start += assetReadConcurrency
  ) {
    const batch = candidates.slice(start, start + assetReadConcurrency);
    if (binaryLimitReached || aggregateLimitReached) {
      for (const [offset, asset] of batch.entries()) {
        assets[start + offset] = {
          id: asset.id,
          sourceUrl: asset.sourceUrl,
          outcome: {
            status: "unavailable",
            reason: binaryLimitReached ? "binary_limit" : "aggregate_limit",
          },
        };
      }
      continue;
    }
    const outcomes = await Promise.all(
      batch.map((asset) => acquire(asset.acquisitionUrl)),
    );
    for (const [offset, asset] of batch.entries()) {
      let outcome = outcomes[offset];
      if (outcome === undefined) {
        outcome = { status: "unavailable", reason: "acquisition_failed" };
      }
      if (outcome.status === "captured") {
        const outcomeBytes = outcome.chunks.reduce(
          (total, chunk) => total + atob(chunk).length,
          0,
        );
        if (aggregateLimitReached) {
          outcome = { status: "unavailable", reason: "aggregate_limit" };
        } else if (capturedAssets >= capturedAssetsLimit) {
          binaryLimitReached = true;
          outcome = { status: "unavailable", reason: "binary_limit" };
        } else if (capturedBytes + outcomeBytes > aggregateAssetBytesLimit) {
          aggregateLimitReached = true;
          outcome = { status: "unavailable", reason: "aggregate_limit" };
        } else {
          capturedAssets += 1;
          capturedBytes += outcomeBytes;
          if (capturedAssets === capturedAssetsLimit) {
            binaryLimitReached = true;
          }
        }
      }
      assets[start + offset] = {
        id: asset.id,
        sourceUrl: asset.sourceUrl,
        outcome,
      };
    }
  }

  const serializedDoctype =
    document.doctype === null
      ? ""
      : new XMLSerializer().serializeToString(document.doctype);
  const canonicalHref = document.querySelector<HTMLLinkElement>(
    'link[rel~="canonical"]',
  )?.href;
  let canonicalUrl: string | undefined;
  if (canonicalHref !== undefined) {
    try {
      const candidate = new URL(canonicalHref);
      if (
        (candidate.protocol === "http:" || candidate.protocol === "https:") &&
        candidate.username === "" &&
        candidate.password === "" &&
        candidate.hash === "" &&
        new TextEncoder().encode(candidate.toString()).byteLength <= 8_192
      ) {
        canonicalUrl = candidate.toString();
      }
    } catch {
      canonicalUrl = undefined;
    }
  }
  return {
    contentType: document.contentType,
    sourceUrl: source.toString(),
    baseUrl: base.toString(),
    ...(canonicalUrl === undefined ? {} : { canonicalUrl }),
    ...(document.title === "" ? {} : { title: document.title }),
    ...(document.documentElement.lang === ""
      ? {}
      : { language: document.documentElement.lang }),
    documentHtml: `${serializedDoctype}${clone.outerHTML}`,
    domElements,
    assets,
  };
}

function validateCapturedDocument(captured: CapturedTopLevelDocument): void {
  validateHttpUrl(captured.sourceUrl, "Capture Source URL");
  validateHttpUrl(captured.baseUrl, "Capture Base URL");
  if (captured.canonicalUrl !== undefined) {
    validateHttpUrl(captured.canonicalUrl, "Capture Canonical URL");
  }
  if (
    captured.domElements > DOM_ELEMENTS_LIMIT ||
    captured.assets.length > ASSET_RECORDS_LIMIT
  ) {
    throw captureFailure("The page contains too many elements to import.");
  }
  const bytes = new TextEncoder().encode(captured.documentHtml).byteLength;
  if (bytes === 0 || bytes > DOCUMENT_HTML_BYTES_LIMIT) {
    throw captureFailure("The page is too large to import.");
  }
  if (
    captured.title !== undefined &&
    Array.from(captured.title).length > TITLE_CODE_POINTS_LIMIT
  ) {
    throw captureFailure("The page title is too long to import.");
  }
  if (
    captured.language !== undefined &&
    (captured.language.length > LANGUAGE_CHARACTERS_LIMIT ||
      !/^[A-Za-z0-9-]+$/.test(captured.language))
  ) {
    throw captureFailure("The page language is invalid.");
  }
}

function validateHttpUrl(value: string, label: string): void {
  if (new TextEncoder().encode(value).byteLength > URL_BYTES_LIMIT) {
    throw captureFailure(`${label} is too long.`);
  }
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username !== "" ||
      url.password !== "" ||
      url.hash !== ""
    ) {
      throw new Error("invalid");
    }
  } catch {
    throw captureFailure(`${label} is invalid.`);
  }
}

function boundedProducerField(value: string): string {
  const bounded = Array.from(value.trim()).slice(0, 128).join("");
  if (bounded === "") {
    throw captureFailure("Capture producer metadata is invalid.");
  }
  return bounded;
}

function freezeManifest(
  manifest: CapturePackageManifest,
): Readonly<CapturePackageManifest> {
  Object.freeze(manifest.document);
  Object.freeze(manifest.producer);
  manifest.assets.forEach((asset) => Object.freeze(asset));
  Object.freeze(manifest.assets);
  return Object.freeze(manifest);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(bytes).buffer,
  );
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function decodeChunks(chunks: string[]): Uint8Array {
  const decoded = chunks.map((chunk) => atob(chunk));
  if (
    decoded.some((chunk) => chunk.length > CONTENT_SCRIPT_CHUNK_BYTES) ||
    decoded.reduce((length, chunk) => length + chunk.length, 0) >
      ASSET_BYTES_LIMIT
  ) {
    throw captureFailure("Captured asset data is invalid.");
  }
  const bytes = new Uint8Array(
    decoded.reduce((length, chunk) => length + chunk.length, 0),
  );
  let offset = 0;
  for (const chunk of decoded) {
    for (let index = 0; index < chunk.length; index += 1) {
      bytes[offset + index] = chunk.charCodeAt(index);
    }
    offset += chunk.length;
  }
  return bytes;
}

function isCapturedTopLevelDocument(
  value: unknown,
): value is CapturedTopLevelDocument {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.contentType === "string" &&
    typeof candidate.sourceUrl === "string" &&
    typeof candidate.baseUrl === "string" &&
    (candidate.canonicalUrl === undefined ||
      typeof candidate.canonicalUrl === "string") &&
    (candidate.title === undefined || typeof candidate.title === "string") &&
    (candidate.language === undefined ||
      typeof candidate.language === "string") &&
    typeof candidate.documentHtml === "string" &&
    typeof candidate.domElements === "number" &&
    Number.isInteger(candidate.domElements) &&
    Array.isArray(candidate.assets) &&
    candidate.assets.every(isCapturedPageAsset)
  );
}

function isCapturedPageAsset(value: unknown): value is CapturedPageAsset {
  if (value === null || typeof value !== "object") return false;
  const asset = value as Record<string, unknown>;
  if (
    typeof asset.id !== "string" ||
    !/^asset-[0-9]{4}$/.test(asset.id) ||
    typeof asset.sourceUrl !== "string" ||
    asset.outcome === null ||
    typeof asset.outcome !== "object"
  ) {
    return false;
  }
  const outcome = asset.outcome as Record<string, unknown>;
  if (outcome.status === "captured") {
    return (
      [
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
        "image/avif",
      ].includes(String(outcome.mediaType)) &&
      Array.isArray(outcome.chunks) &&
      outcome.chunks.every((chunk) => typeof chunk === "string")
    );
  }
  return (
    outcome.status === "unavailable" &&
    [
      "acquisition_failed",
      "timeout",
      "unsupported_type",
      "asset_too_large",
      "binary_limit",
      "aggregate_limit",
    ].includes(String(outcome.reason))
  );
}

function captureFailure(message: string): CapturePackageError {
  return new CapturePackageError(message);
}

function callbackResult<T>(
  invoke: (done: (value: T) => void) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    invoke((value) => {
      const browserApi = Reflect.get(globalThis, "chrome") as
        typeof chrome | undefined;
      const error = browserApi?.runtime.lastError;
      if (error === undefined) {
        resolve(value);
      } else {
        reject(captureFailure("The active page could not be captured."));
      }
    });
  });
}
