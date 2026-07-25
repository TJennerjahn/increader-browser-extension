import { createCaptureJob } from "../../src/capture-job/capture-job";
import type { StagedCapturePackage } from "../../src/capture-package/capture-package";
import { createCapturePackageAssembler } from "../../src/capture-package/capture-package";
import { createPairing } from "../../src/pairing/pairing";
import type {
  BrowserIdentityFlow,
  CredentialStore,
  DestinationStore,
  PairingCredentials,
  PairingProtocolClient,
  RuntimeOriginPermissions,
} from "../../src/pairing/pairing";
import { createTabOpener } from "../../src/browser/chrome-adapters";
import { createBookmarkLookupHttpClient } from "../../src/protocol/bookmark-lookup-http";
import {
  createCapturePackageHttpClient,
  encodeCapturePackageMultipart,
} from "../../src/protocol/capture-package-http";

declare global {
  interface Window {
    runBrowserCaptureReleaseSuite: (
      browser: "Chrome" | "Firefox",
      includeDelay: boolean,
    ) => Promise<ReleaseSuiteResult>;
  }
}

interface ReleaseSuiteResult {
  browser: string;
  checks: string[];
  elapsedMilliseconds: number;
}

window.runBrowserCaptureReleaseSuite = async (browser, includeDelay) => {
  const startedAt = performance.now();
  const checks: string[] = [];
  installChromeCallbackShim();
  for (const instance of ["cloud", "selfhosted"] as const) {
    await exerciseCoreMatrix(browser, instance);
    checks.push(`${browser}-${instance}-pairing-lookup-create-existing-open-revoke`);
  }
  await exerciseSyntheticPackages(browser);
  checks.push("10MiB-60-image", "near-50MiB", "one-over-limit");
  await exerciseAmbiguousRetry();
  checks.push("120-second-ambiguous-explicit-retry");
  await exerciseDelayedTransfer(includeDelay);
  checks.push("35-second-delayed-transfer");
  return {
    browser,
    checks,
    elapsedMilliseconds: Math.round(performance.now() - startedAt),
  };
};

async function exerciseCoreMatrix(
  browser: "Chrome" | "Firefox",
  instance: "cloud" | "selfhosted",
): Promise<void> {
  const origin =
    instance === "cloud"
      ? "https://app.increader.com"
      : "https://reader.example.test";
  let destination: string | null = null;
  let credential: Awaited<ReturnType<CredentialStore["load"]>> = null;
  let revoked = false;
  const store: DestinationStore = {
    load: () => Promise.resolve(destination),
    save(value) {
      destination = value;
      return Promise.resolve();
    },
    clear() {
      destination = null;
      return Promise.resolve();
    },
  };
  const credentials: CredentialStore = {
    load: () => Promise.resolve(credential),
    save(value) {
      credential = value;
      return Promise.resolve();
    },
    clear() {
      credential = null;
      return Promise.resolve();
    },
  };
  const permissions: RuntimeOriginPermissions = {
    contains: () => Promise.resolve(false),
    request: () => Promise.resolve(true),
    remove: () => Promise.resolve(),
  };
  const protocol: PairingProtocolClient = {
    exchange: () =>
      Promise.resolve(issuedCredentials("renewal-initial", "access-initial")),
    renew: () =>
      Promise.resolve(issuedCredentials("renewal-rotated", "access-rotated")),
    revoke: () => {
      revoked = true;
      return Promise.resolve();
    },
  };
  const identity: BrowserIdentityFlow = {
    callbackUri: () => "https://extension.invalid/browser-capture",
    launch: (approvalUrl) => {
      const approval = new URL(approvalUrl);
      const callback = new URL("https://extension.invalid/browser-capture");
      callback.searchParams.set("state", required(approval.searchParams.get("state")));
      callback.searchParams.set("code", "authorization-code");
      return Promise.resolve(callback.toString());
    },
  };
  const pairing = createPairing({
    credentials,
    discovery: {
      discover: () =>
        Promise.resolve({
          protocol: "increader-browser-capture",
          displayName: instance === "cloud" ? "Increader Cloud" : "Increader",
          pairingAvailable: true,
          capabilities: ["pairing", "bookmark-lookup", "capture-package"],
          limits: fixedLimits(),
        }),
    },
    identity,
    installation: {
      id: () => Promise.resolve("019c0000-0000-7000-8000-000000000868"),
      name: `${browser} clean profile`,
    },
    permissions,
    protocol,
    store,
  });
  const paired = await pairing.connect(origin);
  equal(paired.origin, origin, "Pairing exact origin");
  equal(await pairing.accessToken(), "access-initial", "Capture access token");

  const lookup = createBookmarkLookupHttpClient((_input, request) => {
    equal(request?.credentials, "omit", "Lookup omits cookies");
    return Promise.resolve(Response.json({ exists: false }));
  });
  equal(
    (await lookup.lookup(origin, "access-initial", "https://example.test/page"))
      .exists,
    false,
    "Bookmark Lookup missing outcome",
  );
  const existingLookup = createBookmarkLookupHttpClient(() =>
    Promise.resolve(
      Response.json({ exists: true, bookmarkId: 41, title: "Existing" }),
    ),
  );
  const existing = await existingLookup.lookup(
    origin,
    "access-initial",
    "https://example.test/page",
  );
  equal(existing.exists, true, "Bookmark Lookup existing outcome");

  const staged = tinyPackage(browser);
  for (const [status, created] of [
    [201, true],
    [200, false],
  ] as const) {
    const capture = createCapturePackageHttpClient((_input, request) => {
      equal(request?.credentials, "omit", "Capture omits cookies");
      return Promise.resolve(
        Response.json(
          { id: created ? 42 : 41, title: created ? "Created" : "Existing" },
          { status },
        ),
      );
    });
    equal(
      (await capture.transfer(origin, "access-initial", staged)).created,
      created,
      "Capture outcome",
    );
  }
  const opened = new URL(
    `/bookmarks/${String(existing.bookmarkId)}`,
    `${origin}/`,
  ).toString();
  let openedTab: string | undefined;
  const openReader = createTabOpener(
    {
      create(
        options: chrome.tabs.CreateProperties,
        callback: (tab: chrome.tabs.Tab) => void,
      ) {
        openedTab = options.url;
        callback({ id: 41 } as chrome.tabs.Tab);
      },
    } as unknown as typeof chrome.tabs,
  );
  await openReader(opened);
  equal(openedTab, `${origin}/bookmarks/41`, "Open Reader tab");
  await pairing.disconnect();
  equal(revoked, true, "Pairing revoked");
  equal(credential, null, "Pairing credential cleared");
  equal(destination, null, "Destination cleared");
}

async function exerciseSyntheticPackages(
  browser: "Chrome" | "Firefox",
): Promise<void> {
  const tenMiB = await assembledPackage(
    browser,
    Array.from({ length: 60 }, () => Math.floor((10 * 1024 * 1024) / 60)),
    "019c0000-0000-7000-8000-000000000860",
  );
  equal(tenMiB.assetParts.length, 60, "60 captured binaries");
  const tenMiBBody = encodeCapturePackageMultipart(tenMiB).body;
  assert(
    tenMiBBody.size > 10 * 1024 * 1024,
    "10 MiB package includes multipart overhead",
  );

  const nearFifty = await assembledPackage(
    browser,
    Array.from({ length: 7 }, () => 7 * 1024 * 1024),
    "019c0000-0000-7000-8000-000000000861",
  );
  equal(nearFifty.assetParts.length, 7, "49 MiB captured binaries");
  const nearFiftyBody = encodeCapturePackageMultipart(nearFifty).body;
  assert(
    nearFiftyBody.size > 49 * 1024 * 1024 &&
      nearFiftyBody.size < 64 * 1024 * 1024,
    "near-50 MiB package remains transferable",
  );

  const oneOver = await assembledPackage(
    browser,
    [8 * 1024 * 1024 + 1],
    "019c0000-0000-7000-8000-000000000862",
  );
  equal(oneOver.assetParts.length, 0, "one-over asset has no binary part");
  equal(
    oneOver.manifest.assets[0]?.status,
    "unavailable",
    "one-over asset remains explicit",
  );
}

async function exerciseAmbiguousRetry(): Promise<void> {
  const staged = tinyPackage("Chrome");
  let record: Parameters<NonNullable<Parameters<typeof createCaptureJob>[0]["store"]["save"]>>[0] | null =
    null;
  const timeouts: Array<{ milliseconds: number; task: () => void }> = [];
  let transfers = 0;
  const job = createCaptureJob({
    accessToken: () => Promise.resolve("access"),
    capture: () => Promise.resolve(staged),
    clock: {
      setTimeout(task, milliseconds) {
        timeouts.push({ milliseconds, task });
        return timeouts.length;
      },
      clearTimeout: () => undefined,
    },
    notifyFailure: () => Promise.resolve(),
    randomUuid: () => "019c0000-0000-7000-8000-000000000863",
    store: {
      load: () => Promise.resolve(record),
      save(value) {
        record = value;
        return Promise.resolve();
      },
      clear() {
        record = null;
        return Promise.resolve();
      },
    },
    transfer: () => {
      transfers += 1;
      return transfers === 1
        ? new Promise(() => undefined)
        : Promise.resolve({ bookmarkId: 88, created: true, title: "Retry" });
    },
  });
  await job.startImport(
    {
      kind: "supported",
      sourceUrl: staged.manifest.sourceUrl,
      tabId: 1,
      title: "Synthetic",
    },
    "https://app.increader.com",
  );
  await waitFor(() => timeouts.length === 1);
  equal(timeouts[0]?.milliseconds, 120_000, "Transfer deadline");
  timeouts[0]?.task();
  await waitFor(async () => (await job.current()).phase === "failed");
  const failed = await job.current();
  assert(
    failed.phase === "failed" &&
      failed.retryable &&
      failed.captureId === staged.manifest.captureId,
    "Ambiguous timeout preserves retryable staged package",
  );
  await job.retry();
  await waitFor(async () => (await job.current()).phase === "completed");
  const completed = await job.current();
  assert(
    completed.phase === "completed" &&
      completed.captureId === staged.manifest.captureId,
    "Explicit Retry reuses Capture ID",
  );
}

async function exerciseDelayedTransfer(includeDelay: boolean): Promise<void> {
  const delay = includeDelay ? 35_000 : 35;
  const startedAt = performance.now();
  const capture = createCapturePackageHttpClient(
    () =>
      new Promise((resolve) => {
        setTimeout(() => {
          resolve(Response.json({ id: 35, title: "Delayed" }, { status: 201 }));
        }, delay);
      }),
  );
  const result = await capture.transfer(
    "https://app.increader.com",
    "access",
    tinyPackage("Chrome"),
  );
  equal(result.created, true, "Delayed transfer outcome");
  assert(
    performance.now() - startedAt >= delay - 10,
    "Delayed transfer did not finish early",
  );
}

async function assembledPackage(
  browser: "Chrome" | "Firefox",
  assetSizes: number[],
  captureId: string,
): Promise<StagedCapturePackage> {
  const assets = assetSizes.map((size, index) => {
    const id = `asset-${String(index + 1).padStart(4, "0")}`;
    const sourceUrl = `https://assets.example.test/${String(index)}.png`;
    if (size > 8 * 1024 * 1024) {
      return {
        id,
        sourceUrl,
        outcome: {
          status: "unavailable",
          reason: "asset_too_large",
        },
      };
    }
    const bytes = new Uint8Array(size);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    return {
      id,
      sourceUrl,
      outcome: {
        status: "captured",
        mediaType: "image/png",
        chunks: bytesToChunks(bytes),
      },
    };
  });
  const documentHtml = `<!doctype html><html><body>${assets
    .map(
      ({ id }) =>
        `<img src="increader:browser-capture-asset/${id}" alt="Synthetic">`,
    )
    .join("")}</body></html>`;
  const result = {
    contentType: "text/html",
    sourceUrl: "https://example.test/synthetic",
    baseUrl: "https://example.test/synthetic",
    title: "Synthetic",
    documentHtml,
    domElements: assetSizes.length + 2,
    assets,
  };
  const assembler = createCapturePackageAssembler({
    now: () => new Date("2026-07-25T00:00:00.000Z"),
    producer: { browser, extensionVersion: "0.1.0" },
    randomUuid: () => captureId,
    scripting: {
      executeScript(
        _injection: unknown,
        callback: (values: unknown[]) => void,
      ) {
        callback([{ frameId: 0, result }]);
      },
    } as unknown as typeof chrome.scripting,
  });
  return assembler.capture({
    kind: "supported",
    sourceUrl: result.sourceUrl,
    tabId: 1,
    title: result.title,
  });
}

function tinyPackage(browser: "Chrome" | "Firefox"): StagedCapturePackage {
  return {
    manifest: {
      captureId: "019c0000-0000-7000-8000-000000000868",
      capturedAt: "2026-07-25T00:00:00.000Z",
      sourceUrl: "https://example.test/article",
      baseUrl: "https://example.test/article",
      title: "Synthetic",
      document: {
        bytes: 41,
        sha256: "0".repeat(64),
      },
      producer: { browser, extensionVersion: "0.1.0" },
      assets: [],
    },
    documentHtml: "<!doctype html><html><body></body></html>",
    assetParts: [],
  };
}

function issuedCredentials(
  renewalCredential: string,
  accessToken: string,
): PairingCredentials {
  return {
    tokenType: "Bearer",
    pairingId: "019c0000-0000-7000-8000-000000000867",
    renewalCredential,
    renewalExpiresInSeconds: 7_776_000,
    accessToken,
    expiresInSeconds: 600,
  };
}

function fixedLimits() {
  return {
    multipartRequestBytes: 64 * 1024 * 1024,
    manifestBytes: 512 * 1024,
    documentHtmlBytes: 5 * 1024 * 1024,
    domElements: 100_000,
    assetRecords: 1_000,
    binaryAssets: 60,
    assetBytes: 8 * 1024 * 1024,
    aggregateAssetBytes: 50 * 1024 * 1024,
    urlBytes: 8_192,
    titleCodePoints: 1_024,
    languageTagCharacters: 35,
    producerFieldCodePoints: 128,
    contentScriptChunkBytes: 192 * 1024,
    assetReadConcurrency: 4,
    assetTimeoutMilliseconds: 15_000,
    captureDeadlineMilliseconds: 90_000,
    transferDeadlineMilliseconds: 120_000,
    inFlightTransfersPerPairing: 1,
    inFlightTransfersPerUser: 2,
    transferAttemptsPerUserHour: 30,
    idempotencyRetentionDays: 90,
  };
}

function bytesToChunks(bytes: Uint8Array): string[] {
  const result: string[] = [];
  for (let start = 0; start < bytes.byteLength; start += 192 * 1024) {
    let binary = "";
    for (const byte of bytes.slice(start, start + 192 * 1024)) {
      binary += String.fromCharCode(byte);
    }
    result.push(btoa(binary));
  }
  return result;
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("Release suite timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function installChromeCallbackShim(): void {
  const target = globalThis as unknown as {
    chrome?: { runtime?: { lastError?: unknown } };
  };
  if (target.chrome === undefined) {
    target.chrome = { runtime: { lastError: undefined } };
  } else if (target.chrome.runtime === undefined) {
    Object.defineProperty(target.chrome, "runtime", {
      configurable: true,
      value: { lastError: undefined },
    });
  }
}

function required<T>(value: T | null): T {
  if (value === null) throw new Error("Required value is missing");
  return value;
}

function equal(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assert(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label);
}
