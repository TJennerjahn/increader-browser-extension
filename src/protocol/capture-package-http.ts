import type { StagedCapturePackage } from "../capture-package/capture-package";

const MULTIPART_REQUEST_BYTES_LIMIT = 64 * 1024 * 1024;
const CAPTURE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ASSET_ID_PATTERN = /^asset-[0-9]{4}$/;
const ASSET_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
]);

export interface CapturePackageOutcome {
  bookmarkId: number;
  title: string;
  created: boolean;
}

export interface CapturePackageHttpClient {
  transfer(
    origin: string,
    accessToken: string,
    staged: StagedCapturePackage,
    signal?: AbortSignal,
  ): Promise<CapturePackageOutcome>;
}

export class CaptureTransferError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly retryAfterSeconds: number | null;

  constructor(
    message: string,
    code: string,
    retryable: boolean,
    retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = CaptureTransferError.name;
    this.code = code;
    this.retryable = retryable;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function createCapturePackageHttpClient(
  fetcher: typeof fetch = fetch,
): CapturePackageHttpClient {
  return {
    async transfer(origin, accessToken, staged, signal) {
      const encoded = encodeCapturePackageMultipart(staged);
      const response = await fetcher(
        new URL("/api/browser-capture/captures", `${origin}/`).toString(),
        {
          method: "POST",
          credentials: "omit",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": encoded.contentType,
          },
          body: encoded.body,
          signal,
        },
      );
      if (response.status !== 200 && response.status !== 201) {
        throw await captureTransferFailure(response);
      }
      const value: unknown = await response.json();
      if (
        value === null ||
        typeof value !== "object" ||
        typeof (value as Record<string, unknown>).id !== "number"
      ) {
        throw new Error("Increader returned an invalid Bookmark outcome.");
      }
      const bookmark = value as Record<string, unknown>;
      return {
        bookmarkId: bookmark.id as number,
        created: response.status === 201,
        title: typeof bookmark.title === "string" ? bookmark.title : "",
      };
    },
  };
}

export function encodeCapturePackageMultipart(staged: StagedCapturePackage): {
  body: Blob;
  contentType: string;
} {
  const captureId = staged.manifest.captureId;
  if (!CAPTURE_ID_PATTERN.test(captureId)) {
    throw new Error("Capture Package is invalid.");
  }
  const boundary = `----increader-browser-capture-${captureId.toLowerCase()}`;
  const bodyParts: BlobPart[] = [];
  appendPart(
    bodyParts,
    boundary,
    "manifest",
    "application/json",
    JSON.stringify(staged.manifest),
  );
  appendPart(
    bodyParts,
    boundary,
    "document",
    "text/html;charset=utf-8",
    staged.documentHtml,
  );
  const seenAssetIds = new Set<string>();
  for (const asset of staged.assetParts) {
    if (
      !ASSET_ID_PATTERN.test(asset.id) ||
      seenAssetIds.has(asset.id) ||
      !ASSET_MEDIA_TYPES.has(asset.mediaType)
    ) {
      throw new Error("Capture Package is invalid.");
    }
    seenAssetIds.add(asset.id);
    appendPart(
      bodyParts,
      boundary,
      asset.id,
      asset.mediaType,
      asset.data,
    );
  }
  bodyParts.push(`--${boundary}--\r\n`);
  const contentType = `multipart/form-data; boundary=${boundary}`;
  const body = new Blob(bodyParts, { type: contentType });
  if (body.size > MULTIPART_REQUEST_BYTES_LIMIT) {
    throw new Error("Capture Package request is too large.");
  }
  return { body, contentType };
}

function appendPart(
  parts: BlobPart[],
  boundary: string,
  name: string,
  contentType: string,
  value: BlobPart,
): void {
  parts.push(
    `--${boundary}\r\n`,
    `Content-Disposition: form-data; name="${name}"; filename="capture-part"\r\n`,
    `Content-Type: ${contentType}\r\n\r\n`,
    value,
    "\r\n",
  );
}

async function captureTransferFailure(
  response: Response,
): Promise<CaptureTransferError> {
  let code = "capture_transfer_failed";
  try {
    const problem: unknown = await response.json();
    if (
      problem !== null &&
      typeof problem === "object" &&
      typeof (problem as Record<string, unknown>).code === "string"
    ) {
      const candidate = (problem as Record<string, unknown>).code as string;
      if (/^[a-z0-9_]{1,64}$/.test(candidate)) {
        code = candidate;
      }
    }
  } catch {
    // Stable local summaries never reflect a remote response body.
  }
  const retryable =
    response.status === 408 ||
    response.status === 429 ||
    response.status >= 500;
  const retryAfterSeconds =
    response.status === 429
      ? boundedRetryAfter(response.headers.get("Retry-After"))
      : null;
  return new CaptureTransferError(
    safeTransferMessage(code, response.status),
    code,
    retryable,
    retryAfterSeconds,
  );
}

function safeTransferMessage(code: string, status: number): string {
  switch (code) {
    case "capture_package_invalid":
      return "Capture Package is invalid.";
    case "capture_id_conflict":
      return "Capture ID was already used for different content.";
    case "capture_request_too_large":
      return "Capture Package request is too large.";
    case "capture_content_length_required":
      return "Capture Package requires a fixed request size.";
    case "capture_transfer_limited":
      return "Increader is temporarily limiting Browser Capture transfers.";
  }
  if (status === 401 || status === 403) {
    return "Reconnect this browser to Increader and try again.";
  }
  if (status === 408 || status === 429 || status >= 500) {
    return "Increader is temporarily unavailable for Browser Capture.";
  }
  return "Increader could not import this Capture Package.";
}

function boundedRetryAfter(value: string | null): number | null {
  if (value === null || !/^[0-9]{1,10}$/.test(value)) return null;
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds <= 0) return null;
  return Math.min(seconds, 3_600);
}
