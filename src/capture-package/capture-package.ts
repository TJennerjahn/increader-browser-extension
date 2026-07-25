import type { ActivePageInspection } from "../browser/active-page";
import type { components } from "../protocol/generated/browser-capture";

const DOCUMENT_HTML_BYTES_LIMIT = 5 * 1024 * 1024;
const DOM_ELEMENTS_LIMIT = 100_000;
const LANGUAGE_CHARACTERS_LIMIT = 35;
const TITLE_CODE_POINTS_LIMIT = 1_024;
const URL_BYTES_LIMIT = 8_192;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CapturePackageManifest =
  components["schemas"]["BrowserCapturePackageManifest"] & {
    assets: [];
  };

export interface StagedCapturePackage {
  readonly manifest: Readonly<CapturePackageManifest>;
  readonly documentHtml: string;
}

export interface CapturePackageAssembler {
  capture(
    page: Extract<ActivePageInspection, { kind: "supported" }>,
  ): Promise<StagedCapturePackage>;
}

interface CapturePackageAssemblerDependencies {
  scripting?: typeof chrome.scripting;
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
}

export function createCapturePackageAssembler({
  scripting = chrome.scripting,
  randomUuid = () => globalThis.crypto.randomUUID(),
  now = () => new Date(),
  producer,
}: CapturePackageAssemblerDependencies): CapturePackageAssembler {
  return {
    async capture(page) {
      const results = await callbackResult<
        chrome.scripting.InjectionResult<unknown>[]
      >((done) => {
        scripting.executeScript(
          {
            func: captureTopLevelDocument,
            target: { tabId: page.tabId },
            world: "ISOLATED",
          },
          done,
        );
      });
      const captured = results.find((result) => result.frameId === 0)?.result;
      if (!isCapturedTopLevelDocument(captured)) {
        throw captureFailure("The active page could not be captured.");
      }
      if (captured.sourceUrl !== page.sourceUrl) {
        throw captureFailure(
          "The active page changed before capture started.",
        );
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
        assets: [],
      };
      return Object.freeze({
        manifest: freezeManifest(manifest),
        documentHtml: captured.documentHtml,
      });
    },
  };
}

function captureTopLevelDocument(): CapturedTopLevelDocument {
  const source = new URL(location.href);
  source.hash = "";
  const base = new URL(document.baseURI);
  base.hash = "";
  const clone = document.documentElement.cloneNode(true) as HTMLElement;
  const domElements = clone.querySelectorAll("*").length + 1;
  clone
    .querySelectorAll("script, iframe, frame, frameset, object, embed")
    .forEach((element) => {
      element.remove();
    });
  for (const element of [
    clone,
    ...Array.from(clone.querySelectorAll("*")),
  ]) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (
        name.startsWith("on") ||
        name.startsWith("data-increader-capture") ||
        name.startsWith("data-browser-capture")
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  }

  const serializedDoctype =
    document.doctype === null
      ? ""
      : new XMLSerializer().serializeToString(document.doctype);
  const canonicalHref =
    document.querySelector<HTMLLinkElement>('link[rel~="canonical"]')?.href;
  let canonicalUrl: string | undefined;
  if (canonicalHref !== undefined) {
    try {
      const candidate = new URL(canonicalHref);
      if (
        (candidate.protocol === "http:" ||
          candidate.protocol === "https:") &&
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
  };
}

function validateCapturedDocument(captured: CapturedTopLevelDocument): void {
  validateHttpUrl(captured.sourceUrl, "Capture Source URL");
  validateHttpUrl(captured.baseUrl, "Capture Base URL");
  if (captured.canonicalUrl !== undefined) {
    validateHttpUrl(captured.canonicalUrl, "Capture Canonical URL");
  }
  if (captured.domElements > DOM_ELEMENTS_LIMIT) {
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
    Number.isInteger(candidate.domElements)
  );
}

function captureFailure(message: string): Error {
  return new Error(message);
}

function callbackResult<T>(
  invoke: (done: (value: T) => void) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    invoke((value) => {
      const browserApi = Reflect.get(globalThis, "chrome") as
        | typeof chrome
        | undefined;
      const error = browserApi?.runtime.lastError;
      if (error === undefined) {
        resolve(value);
      } else {
        reject(new Error(error.message));
      }
    });
  });
}
