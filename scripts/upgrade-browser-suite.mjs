/* eslint-disable no-undef -- This harness evaluates code in Node and browser extension contexts. */
import { execFileSync } from "node:child_process";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { download as downloadGeckodriver } from "geckodriver";
import { unzipSync, zipSync } from "fflate";
import puppeteer from "puppeteer";
import { Builder } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(
  await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
);
const candidateFixture = JSON.parse(
  await readFile(
    path.join(
      repositoryRoot,
      "release",
      "fixtures",
      "previous-candidate-0.0.9.json",
    ),
    "utf8",
  ),
);
const outputRoot = path.join(repositoryRoot, "dist", "production");
const chromeArchivePath = path.join(
  outputRoot,
  `increader-browser-extension-${packageJson.version}-chrome-upload.zip`,
);
const firefoxArchivePath = path.join(
  outputRoot,
  `increader-browser-extension-${packageJson.version}-firefox-upload.zip`,
);
const candidateRoot = await mkdtemp(
  path.join(os.tmpdir(), "browser-capture-upgrade-"),
);

try {
  console.log("Building exact production archives");
  execFileSync(
    process.execPath,
    ["scripts/build.mjs", "--mode", "production"],
    {
      cwd: repositoryRoot,
      stdio: "inherit",
    },
  );
  console.log("Running Chrome in-place upgrade");
  await runChromeUpgrade();
  console.log("Running Firefox in-place upgrade");
  await runFirefoxUpgrade();
} finally {
  await rm(candidateRoot, { force: true, recursive: true });
}

async function runChromeUpgrade() {
  const extensionRoot = path.join(candidateRoot, "chrome");
  const userDataDir = path.join(candidateRoot, "chrome-profile");
  await writePreviousCandidate(extensionRoot, "chrome");
  const previousBrowser = await launchChrome(extensionRoot, userDataDir);
  let extensionId;
  try {
    const previous = await waitFor(async () =>
      [...(await previousBrowser.extensions()).values()].find(
        (extension) =>
          extension.name === "Increader Browser Capture" &&
          extension.version === candidateFixture.candidateVersion,
      ),
    );
    if (previous.id !== "haipjkpamjpojalajcgfeggbjhifjpnn") {
      throw new Error(`Chrome candidate ID changed: ${previous.id}`);
    }
    extensionId = previous.id;
    const previousWorker = await waitFor(
      async () => (await previous.workers())[0],
    );
    console.log("Chrome previous candidate loaded", previous.id);
    await waitFor(async () => {
      const snapshot = await chromeWorkerSnapshot(previousWorker);
      return snapshot.seedReady === true && snapshot.captureId !== undefined
        ? snapshot
        : undefined;
    });
    console.log("Chrome previous candidate state seeded");
  } finally {
    await previousBrowser.close();
  }

  const exactArchive = new Uint8Array(await readFile(chromeArchivePath));
  await extractArchive(exactArchive, extensionRoot);
  console.log("Chrome exact archive replaced previous candidate files");
  const currentBrowser = await launchChrome(extensionRoot, userDataDir);
  try {
    const currentWorker = await waitFor(async () => {
      const current = [...(await currentBrowser.extensions()).values()].find(
        (extension) => extension.id === extensionId,
      );
      const worker = (await current?.workers())?.[0];
      if (worker === undefined) return undefined;
      const version = await worker.evaluate(
        () => chrome.runtime.getManifest().version,
      );
      return version === packageJson.version ? worker : undefined;
    }, 30_000);
    console.log("Chrome current release worker loaded after browser restart");
    await new Promise((resolve) => globalThis.setTimeout(resolve, 750));
    const snapshot = await chromeWorkerSnapshot(currentWorker);
    assertPreservedSnapshot("Chrome", snapshot);
    console.log("Chrome in-place previous-candidate upgrade verified", {
      extensionId,
      from: candidateFixture.candidateVersion,
      to: packageJson.version,
    });
  } finally {
    await currentBrowser.close();
  }
}

async function launchChrome(extensionRoot, userDataDir) {
  return puppeteer.launch({
    headless: false,
    executablePath:
      process.env.CHROME_BINARY ?? (await puppeteer.executablePath()),
    userDataDir,
    args: [
      `--disable-extensions-except=${extensionRoot}`,
      `--load-extension=${extensionRoot}`,
      "--no-sandbox",
    ],
  });
}

async function runFirefoxUpgrade() {
  const extensionRoot = path.join(candidateRoot, "firefox");
  const profileSnapshot = path.join(candidateRoot, "firefox-profile");
  await writePreviousCandidate(extensionRoot, "firefox");
  const candidateArchivePath = path.join(
    candidateRoot,
    "previous-candidate-firefox.zip",
  );
  await writeCandidateZip(extensionRoot, candidateArchivePath);
  const previousDriver = await buildFirefoxDriver();
  let extensionId;
  try {
    extensionId = await previousDriver.installAddon(candidateArchivePath, true);
    console.log("Firefox previous candidate installed", extensionId);
    if (extensionId !== "browser-capture@increader.com") {
      throw new Error(`Firefox candidate ID changed: ${extensionId}`);
    }
    const previousPopupUrl = await firefoxExtensionUrl(
      previousDriver,
      extensionId,
      "popup.html",
    );
    await previousDriver.setContext(firefox.Context.CONTENT);
    await previousDriver.get(previousPopupUrl);
    await waitFor(async () => {
      const snapshot = await firefoxPageSnapshot(previousDriver);
      return snapshot.seedReady === true && snapshot.captureId !== undefined
        ? snapshot
        : undefined;
    });
    console.log("Firefox previous candidate state seeded");
    await previousDriver.get("about:blank");
    await new Promise((resolve) => globalThis.setTimeout(resolve, 750));
    const liveProfile = (await previousDriver.getCapabilities()).get(
      "moz:profile",
    );
    if (typeof liveProfile !== "string") {
      throw new Error("Firefox live profile path was unavailable");
    }
    await copyFirefoxProfile(liveProfile, profileSnapshot);
    console.log("Firefox previous candidate profile captured");
  } finally {
    await previousDriver.quit().catch(() => undefined);
  }

  const currentDriver = await buildFirefoxDriver(profileSnapshot);
  try {
    const updatedId = await currentDriver.installAddon(
      firefoxArchivePath,
      true,
    );
    console.log(
      "Firefox exact archive installed after browser restart",
      updatedId,
    );
    if (updatedId !== extensionId) {
      throw new Error(`Firefox update replaced the extension ID: ${updatedId}`);
    }
    const currentPopupUrl = await firefoxExtensionUrl(
      currentDriver,
      extensionId,
      "popup.html",
    );
    await currentDriver.setContext(firefox.Context.CONTENT);
    await currentDriver.get(currentPopupUrl);
    const snapshot = await waitFor(async () => {
      const value = await firefoxPageSnapshot(currentDriver);
      return value.version === packageJson.version &&
        value.captureId ===
          candidateFixture.captureJob.package.manifest.captureId
        ? value
        : undefined;
    }, 30_000);
    assertPreservedSnapshot("Firefox", snapshot);
    console.log("Firefox in-place previous-candidate upgrade verified", {
      extensionId,
      from: candidateFixture.candidateVersion,
      to: packageJson.version,
    });
  } finally {
    await currentDriver.quit().catch(() => undefined);
  }
}

async function buildFirefoxDriver(profileTemplate) {
  const geckodriverPath = await downloadGeckodriver();
  const options = new firefox.Options()
    .setBinary(await findFirefoxBinary())
    .addArguments("-headless");
  if (profileTemplate !== undefined) {
    options.setProfile(profileTemplate);
  }
  const service = new firefox.ServiceBuilder(geckodriverPath).addArguments(
    "--allow-system-access",
  );
  return new Builder()
    .forBrowser("firefox")
    .setFirefoxOptions(options)
    .setFirefoxService(service)
    .build();
}

async function copyFirefoxProfile(sourceRoot, destinationRoot) {
  const volatileRoots = new Set([
    "cache2",
    "crashes",
    "datareporting",
    "minidumps",
    "safebrowsing",
    "safebrowsing-updating",
    "shader-cache",
    "startupCache",
    "thumbnails",
  ]);
  await cp(sourceRoot, destinationRoot, {
    recursive: true,
    filter: (source) => {
      const relative = path.relative(sourceRoot, source);
      const root = relative.split(path.sep)[0];
      return (
        ![".parentlock", "lock", "parent.lock"].includes(
          path.basename(source),
        ) && !volatileRoots.has(root)
      );
    },
  });
}

async function writePreviousCandidate(destination, browser) {
  await mkdir(destination, { recursive: true });
  const currentManifest = JSON.parse(
    await readFile(
      path.join(repositoryRoot, "manifests", `${browser}.json`),
      "utf8",
    ),
  );
  const manifest = {
    ...currentManifest,
    version: candidateFixture.candidateVersion,
    icons: undefined,
    action: {
      default_title: "Increader Browser Capture",
      default_popup: "popup.html",
    },
    background:
      browser === "chrome"
        ? { service_worker: "background.js" }
        : { scripts: ["background.js"] },
  };
  await writeFile(
    path.join(destination, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await writeFile(
    path.join(destination, "background.js"),
    previousCandidateBackground(browser),
  );
  await writeFile(
    path.join(destination, "popup.html"),
    '<!doctype html><meta charset="utf-8"><title>Previous candidate</title>',
  );
}

function previousCandidateBackground(browser) {
  const storage = candidateFixture.storageLocal;
  const captureJob = candidateFixture.captureJob;
  const documentHtml = Buffer.from(
    captureJob.package.documentHtmlBase64,
    "base64",
  ).toString("utf8");
  const assetParts = captureJob.package.assetParts.map((part) => ({
    id: part.id,
    mediaType: part.mediaType,
    dataBase64: part.dataBase64,
  }));
  return `
const storage = ${JSON.stringify(storage)};
const captureJob = ${JSON.stringify({
    ...captureJob,
    package: {
      manifest: captureJob.package.manifest,
      documentHtml,
      assetParts,
    },
  })};
const bytes = value => Uint8Array.from(atob(value), character =>
  character.charCodeAt(0)
);
captureJob.package.assetParts = captureJob.package.assetParts.map(part => ({
  id: part.id,
  mediaType: part.mediaType,
  data: new Blob([bytes(part.dataBase64)], { type: part.mediaType })
}));
const setStorage = () => ${
    browser === "firefox"
      ? "browser.storage.local.set(storage)"
      : "new Promise((resolve, reject) => chrome.storage.local.set(storage, () => chrome.runtime.lastError === undefined ? resolve() : reject(new Error(chrome.runtime.lastError.message))))"
  };
const setReady = () => ${
    browser === "firefox"
      ? "browser.storage.local.set({ browserCapturePreviousCandidateSeedReady: true })"
      : "new Promise((resolve, reject) => chrome.storage.local.set({ browserCapturePreviousCandidateSeedReady: true }, () => chrome.runtime.lastError === undefined ? resolve() : reject(new Error(chrome.runtime.lastError.message))))"
  };
const seedJob = () => new Promise((resolve, reject) => {
  const request = indexedDB.open("increader-browser-capture", 1);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains("capture-job")) {
      request.result.createObjectStore("capture-job");
    }
  };
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const transaction = request.result.transaction("capture-job", "readwrite");
    transaction.objectStore("capture-job").put(captureJob, "current");
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () =>
      reject(transaction.error);
  };
});
void Promise.all([setStorage(), seedJob()]).then(setReady);
`;
}

async function writeCandidateZip(sourceRoot, destination) {
  const entries = {};
  for (const name of ["background.js", "manifest.json", "popup.html"]) {
    entries[name] = new Uint8Array(await readFile(path.join(sourceRoot, name)));
  }
  await writeFile(destination, zipSync(entries, { level: 9 }));
}

async function extractArchive(archive, destinationRoot) {
  const entries = unzipSync(archive);
  for (const [relativePath, bytes] of Object.entries(entries)) {
    if (
      path.isAbsolute(relativePath) ||
      relativePath.split(/[\\/]/u).includes("..")
    ) {
      throw new Error(`Unsafe archive path: ${relativePath}`);
    }
    const destination = path.resolve(destinationRoot, relativePath);
    if (
      !destination.startsWith(`${path.resolve(destinationRoot)}${path.sep}`)
    ) {
      throw new Error(`Archive escaped extraction root: ${relativePath}`);
    }
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
  }
}

async function chromeWorkerSnapshot(worker) {
  return worker.evaluate(async () => {
    const storage = await new Promise((resolve, reject) => {
      chrome.storage.local.get(null, (value) => {
        const error = chrome.runtime.lastError;
        if (error === undefined) resolve(value);
        else reject(new Error(error.message));
      });
    });
    const record = await new Promise((resolve, reject) => {
      const request = indexedDB.open("increader-browser-capture", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const read = request.result
          .transaction("capture-job", "readonly")
          .objectStore("capture-job")
          .get("current");
        read.onerror = () => reject(read.error);
        read.onsuccess = () => resolve(read.result);
      };
    });
    const assetBytes =
      record?.package?.assetParts?.[0]?.data instanceof Blob
        ? Array.from(
            new Uint8Array(
              await record.package.assetParts[0].data.arrayBuffer(),
            ),
          )
        : null;
    return {
      assetId: record?.package?.assetParts?.[0]?.id,
      assetMediaType: record?.package?.assetParts?.[0]?.mediaType,
      assetBytes,
      captureId: record?.package?.manifest?.captureId,
      documentHtml: record?.package?.documentHtml,
      installationId: storage.browserCaptureInstallationId,
      manifest: record?.package?.manifest,
      message: record?.message,
      origin: record?.origin,
      pairing: storage.browserCapturePairingCredential,
      phase: record?.phase,
      retryable: record?.retryable,
      seedReady: storage.browserCapturePreviousCandidateSeedReady,
      version: chrome.runtime.getManifest().version,
    };
  });
}

async function firefoxPageSnapshot(driver) {
  return driver.executeAsyncScript(`
    const done = arguments[arguments.length - 1];
    const readJob = () => new Promise((resolve, reject) => {
      const request = indexedDB.open("increader-browser-capture", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const read = request.result
          .transaction("capture-job", "readonly")
          .objectStore("capture-job")
          .get("current");
        read.onerror = () => reject(read.error);
        read.onsuccess = () => resolve(read.result);
      };
    });
    Promise.all([browser.storage.local.get(null), readJob()]).then(
      async ([storage, record]) => {
        const assetBytes =
          record?.package?.assetParts?.[0]?.data instanceof Blob
            ? Array.from(new Uint8Array(
                await record.package.assetParts[0].data.arrayBuffer()
              ))
            : null;
        done({
          assetId: record?.package?.assetParts?.[0]?.id,
          assetMediaType: record?.package?.assetParts?.[0]?.mediaType,
          assetBytes,
          captureId: record?.package?.manifest?.captureId,
          documentHtml: record?.package?.documentHtml,
          installationId: storage.browserCaptureInstallationId,
          manifest: record?.package?.manifest,
          message: record?.message,
          origin: record?.origin,
          pairing: storage.browserCapturePairingCredential,
          phase: record?.phase,
          retryable: record?.retryable,
          seedReady: storage.browserCapturePreviousCandidateSeedReady,
          version: browser.runtime.getManifest().version
        });
      },
      error => done({ error: String(error?.stack ?? error) })
    );
  `);
}

async function firefoxExtensionUrl(driver, extensionId, relativePath) {
  await driver.setContext(firefox.Context.CHROME);
  const url = await driver.executeScript(
    `
      return WebExtensionPolicy.getByID(arguments[0]).getURL(arguments[1]);
    `,
    extensionId,
    relativePath,
  );
  if (typeof url !== "string") {
    throw new Error("Firefox extension policy URL was unavailable");
  }
  return url;
}

function assertPreservedSnapshot(browser, snapshot) {
  const expectedAsset = Buffer.from(
    candidateFixture.captureJob.package.assetParts[0].dataBase64,
    "base64",
  );
  const expectedHtml = Buffer.from(
    candidateFixture.captureJob.package.documentHtmlBase64,
    "base64",
  ).toString("utf8");
  const expectedPart = candidateFixture.captureJob.package.assetParts[0];
  if (
    snapshot.version !== packageJson.version ||
    snapshot.installationId !==
      candidateFixture.storageLocal.browserCaptureInstallationId ||
    canonicalJson(snapshot.pairing) !==
      canonicalJson(
        candidateFixture.storageLocal.browserCapturePairingCredential,
      ) ||
    snapshot.phase !== candidateFixture.captureJob.phase ||
    snapshot.origin !== candidateFixture.captureJob.origin ||
    snapshot.message !== candidateFixture.captureJob.message ||
    snapshot.captureId !==
      candidateFixture.captureJob.package.manifest.captureId ||
    canonicalJson(snapshot.manifest) !==
      canonicalJson(candidateFixture.captureJob.package.manifest) ||
    snapshot.documentHtml !== expectedHtml ||
    snapshot.assetId !== expectedPart.id ||
    snapshot.assetMediaType !== expectedPart.mediaType ||
    snapshot.retryable !== true ||
    !Array.isArray(snapshot.assetBytes) ||
    !Buffer.from(snapshot.assetBytes).equals(expectedAsset)
  ) {
    throw new Error(
      `${browser} previous-candidate state changed: ${JSON.stringify(snapshot)}`,
    );
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function findFirefoxBinary() {
  if (process.env.FIREFOX_BINARY !== undefined) {
    await access(process.env.FIREFOX_BINARY);
    return process.env.FIREFOX_BINARY;
  }
  const cacheRoot = path.join(os.homedir(), ".cache", "puppeteer", "firefox");
  const versions = execFileSync(
    "find",
    [
      cacheRoot,
      "-mindepth",
      "3",
      "-maxdepth",
      "3",
      "-type",
      "f",
      "-name",
      "firefox",
    ],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean)
    .sort();
  const executable = versions.at(-1);
  if (executable === undefined) {
    throw new Error("Firefox unavailable; set FIREFOX_BINARY");
  }
  return executable;
}

async function waitFor(read, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, 100));
  }
  throw new Error(`Upgrade condition not met within ${String(timeout)} ms`, {
    cause: lastError,
  });
}
