import { execFileSync } from "node:child_process";
import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { unzipSync } from "fflate";
import puppeteer from "puppeteer";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(
  await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
);
const version = packageJson.version;
const outputRoot = path.join(repositoryRoot, "dist", "production");
const browserSuiteRoot = path.join(
  repositoryRoot,
  "dist",
  "browser-release-suite",
);
const includeDelay = process.env.BROWSER_CAPTURE_REAL_DELAY !== "0";

await ensureReleaseBuild();
await rm(browserSuiteRoot, { recursive: true, force: true });
await mkdir(browserSuiteRoot, { recursive: true });
const suiteBundle = path.join(browserSuiteRoot, "core-matrix.js");
await build({
  entryPoints: [
    path.join(repositoryRoot, "release", "browser", "core-matrix.ts"),
  ],
  bundle: true,
  format: "iife",
  legalComments: "none",
  minify: true,
  outfile: suiteBundle,
  platform: "browser",
  target: ["chrome140", "firefox140"],
});

const temporaryRoot = await mkdtemp(
  path.join(os.tmpdir(), "increader-browser-release-"),
);
const suiteServer = await startSuiteServer(suiteBundle);
try {
  const chromeZip = path.join(
    outputRoot,
    `increader-browser-extension-${version}-chrome-upload.zip`,
  );
  const firefoxZip = path.join(
    outputRoot,
    `increader-browser-extension-${version}-firefox-upload.zip`,
  );
  const chromeExtracted = path.join(temporaryRoot, "chrome-exact-upload");
  const firefoxExtracted = path.join(temporaryRoot, "firefox-exact-upload");
  await extractExactZip(chromeZip, chromeExtracted);
  await extractExactZip(firefoxZip, firefoxExtracted);

  const [chromeResult, firefoxResult] = await Promise.all([
    exerciseBrowser({
      browserName: "Chrome",
      executablePath:
        process.env.CHROME_BINARY ?? (await puppeteer.executablePath()),
      extensionPath: chromeExtracted,
      expectedArchive: chromeZip,
      suiteUrl: suiteServer.url,
    }),
    exerciseFirefoxBrowser({
      executablePath:
        process.env.FIREFOX_BINARY ?? (await findFirefoxExecutable()),
      extensionPath: firefoxExtracted,
      expectedArchive: firefoxZip,
      suiteUrl: suiteServer.url,
    }),
  ]);
  process.stdout.write(
    `${JSON.stringify(
      {
        artifactVersion: version,
        realDelaySeconds: includeDelay ? 35 : 0.035,
        browsers: [chromeResult, firefoxResult],
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await suiteServer.close();
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function exerciseBrowser({
  browserName,
  executablePath,
  extensionPath,
  expectedArchive,
  suiteUrl,
}) {
  const product = browserName === "Chrome" ? "chrome" : "firefox";
  const versionOutput = execFileSync(executablePath, ["--version"], {
    encoding: "utf8",
  }).trim();
  if (browserName === "Firefox") {
    const major = Number(/Firefox\s+(\d+)/.exec(versionOutput)?.[1]);
    if (!Number.isSafeInteger(major) || major < 140) {
      throw new Error(`Firefox 140+ required, found ${versionOutput}`);
    }
  }
  const browser = await puppeteer.launch({
    browser: product,
    executablePath,
    enableExtensions: [extensionPath],
    headless: true,
    args: product === "chrome" ? ["--no-sandbox"] : [],
    timeout: 30_000,
  });
  try {
    const extension = await waitForExtension(browser);
    if (
      extension.name !== "Increader Browser Capture" ||
      extension.version !== version ||
      !extension.enabled
    ) {
      throw new Error(
        `${browserName} loaded unexpected extension ${extension.name} ${extension.version}`,
      );
    }

    const workers = await waitForWorkers(extension);
    const runtimeEvidence = await workers[0].evaluate(() => ({
      hasIndexedDb: typeof indexedDB === "object",
      manifestName: globalThis.chrome.runtime.getManifest().name,
      manifestVersion: globalThis.chrome.runtime.getManifest().version,
    }));
    if (
      runtimeEvidence.hasIndexedDb !== true ||
      runtimeEvidence.manifestName !== "Increader Browser Capture" ||
      runtimeEvidence.manifestVersion !== version
    ) {
      throw new Error(`${browserName} background runtime did not initialize`);
    }

    const page = await browser.newPage();
    await page.goto(suiteUrl);
    if (browserName === "Chrome") {
      await extension.triggerAction(page);
      const popup = await waitForPopup(extension);
      await popup.waitForSelector("#popup-title", { timeout: 10_000 });
      const title = await popup.$eval("#popup-title", (element) =>
        element.textContent?.trim(),
      );
      if (title !== "Browser Capture") {
        throw new Error("Chrome packaged popup did not render");
      }
    }

    await page.waitForFunction(
      () =>
        typeof globalThis.window.runBrowserCaptureReleaseSuite === "function",
      { timeout: 10_000 },
    );
    const matrix = await page.evaluate(
      async ({ selectedBrowser, selectedDelay }) =>
        globalThis.window.runBrowserCaptureReleaseSuite(
          selectedBrowser,
          selectedDelay,
        ),
      {
        selectedBrowser: browserName,
        selectedDelay: includeDelay,
      },
    );
    return {
      browser: browserName,
      browserVersion: versionOutput,
      exactUploadArchive: path.basename(expectedArchive),
      extensionId: extension.id,
      backgroundRuntime: runtimeEvidence,
      matrix,
    };
  } finally {
    await browser.close();
  }
}

async function exerciseFirefoxBrowser({
  executablePath,
  extensionPath,
  expectedArchive,
  suiteUrl,
}) {
  const temporaryInstall = await exerciseFirefoxTemporaryAddon({
    executablePath,
    extensionPath,
  });
  const versionOutput = execFileSync(executablePath, ["--version"], {
    encoding: "utf8",
  }).trim();
  const major = Number(/Firefox\s+(\d+)/.exec(versionOutput)?.[1]);
  if (!Number.isSafeInteger(major) || major < 140) {
    throw new Error(`Firefox 140+ required, found ${versionOutput}`);
  }
  const browser = await puppeteer.launch({
    browser: "firefox",
    executablePath,
    headless: true,
    timeout: 30_000,
  });
  try {
    const page = await browser.newPage();
    await page.goto(suiteUrl);
    await page.waitForFunction(
      () =>
        typeof globalThis.window.runBrowserCaptureReleaseSuite === "function",
      { timeout: 10_000 },
    );
    const matrix = await page.evaluate(
      async ({ selectedDelay }) =>
        globalThis.window.runBrowserCaptureReleaseSuite(
          "Firefox",
          selectedDelay,
        ),
      { selectedDelay: includeDelay },
    );
    return {
      browser: "Firefox",
      browserVersion: versionOutput,
      exactUploadArchive: path.basename(expectedArchive),
      extensionId: temporaryInstall.extensionId,
      backgroundRuntime: temporaryInstall,
      matrix,
    };
  } finally {
    await browser.close();
  }
}

async function exerciseFirefoxTemporaryAddon({
  executablePath,
  extensionPath,
}) {
  const remoteModule = await import(
    pathToFileURL(
      path.join(
        repositoryRoot,
        "node_modules",
        "web-ext",
        "lib",
        "firefox",
        "remote.js",
      ),
    ).toString()
  );
  const preferencesModule = await import(
    pathToFileURL(
      path.join(
        repositoryRoot,
        "node_modules",
        "web-ext",
        "lib",
        "firefox",
        "preferences.js",
      ),
    ).toString()
  );
  const profile = await mkdtemp(
    path.join(os.tmpdir(), "increader-firefox-profile-"),
  );
  const preferences = preferencesModule.getPrefs("firefox");
  await writeFile(
    path.join(profile, "user.js"),
    `${Object.entries(preferences)
      .map(
        ([name, value]) =>
          `user_pref(${JSON.stringify(name)}, ${JSON.stringify(value)});`,
      )
      .join("\n")}\n`,
  );
  const port = await remoteModule.findFreeTcpPort();
  const child = spawn(
    executablePath,
    [
      "-start-debugger-server",
      String(port),
      "-foreground",
      "-no-remote",
      "-profile",
      profile,
      "-headless",
    ],
    {
      env: { ...process.env, MOZ_HEADLESS: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${String(chunk)}`.slice(-16_384);
  });
  let remote;
  try {
    remote = await remoteModule.connectWithMaxRetries({
      maxRetries: 250,
      port,
      retryInterval: 120,
    });
    const installed = await remote.installTemporaryAddon(extensionPath, false);
    const extensionId = installed.addon?.id;
    if (extensionId !== "browser-capture@increader.com") {
      throw new Error(`Firefox installed unexpected add-on ${String(extensionId)}`);
    }
    const addon = await remote.getInstalledAddon(extensionId);
    const requestTypes = await remote.addonRequest(addon, "requestTypes");
    if (!requestTypes.requestTypes.includes("reload")) {
      throw new Error("Firefox add-on actor cannot reload the extension");
    }
    await remote.addonRequest(addon, "reload");
    const reloaded = await remote.getInstalledAddon(extensionId);
    if (reloaded.id !== extensionId || reloaded.actor === undefined) {
      throw new Error("Firefox extension did not survive runtime reload");
    }
    return {
      extensionId,
      temporaryInstall: true,
      runtimeReload: true,
      actorAvailable: true,
    };
  } catch (error) {
    throw new Error(
      `Firefox temporary-install smoke failed: ${
        error instanceof Error ? error.message : String(error)
      }\n${stderr}`,
      { cause: error },
    );
  } finally {
    remote?.disconnect();
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      delay(5_000),
    ]);
    if (child.exitCode === null) child.kill("SIGKILL");
    await rm(profile, { recursive: true, force: true });
  }
}

async function waitForExtension(browser) {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const extensions = await browser.extensions();
    const extension = [...extensions.values()].find(
      (candidate) => candidate.name === "Increader Browser Capture",
    );
    if (extension !== undefined) return extension;
    if (Date.now() >= deadline) {
      throw new Error("Packaged Browser Extension did not install");
    }
    await delay(100);
  }
}

async function waitForWorkers(extension) {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const workers = await extension.workers();
    if (workers.length > 0) return workers;
    if (Date.now() >= deadline) {
      throw new Error(`${extension.name} background worker did not start`);
    }
    await delay(100);
  }
}

async function waitForPopup(extension) {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const pages = await extension.pages();
    const popup = pages.find((page) => page.url().endsWith("/popup.html"));
    if (popup !== undefined) return popup;
    if (Date.now() >= deadline) {
      throw new Error("Packaged Chrome popup did not open");
    }
    await delay(100);
  }
}

async function extractExactZip(archivePath, destination) {
  const files = unzipSync(new Uint8Array(await readFile(archivePath)));
  for (const [name, bytes] of Object.entries(files)) {
    const target = path.join(destination, name);
    if (!target.startsWith(`${destination}${path.sep}`)) {
      throw new Error(`Unsafe archive path: ${name}`);
    }
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  const extractedManifest = JSON.parse(
    await readFile(path.join(destination, "manifest.json"), "utf8"),
  );
  if (extractedManifest.version !== version) {
    throw new Error("Extracted upload ZIP version mismatch");
  }
}

async function findFirefoxExecutable() {
  const expected = await puppeteer.executablePath({ browser: "firefox" });
  try {
    await access(expected);
    return expected;
  } catch {
    // `puppeteer browsers install firefox` uses a stable-version cache key
    // which is intentionally discovered rather than guessed.
  }
  const root = path.join(
    process.env.PUPPETEER_CACHE_DIR ?? path.join(os.homedir(), ".cache", "puppeteer"),
    "firefox",
  );
  const candidates = [];
  for (const directory of await readdir(root, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    const candidate = path.join(root, directory.name, "firefox", "firefox");
    try {
      await access(candidate);
      candidates.push(candidate);
    } catch {
      // Ignore partial or other-platform cache entries.
    }
  }
  candidates.sort();
  const newest = candidates.at(-1);
  if (newest === undefined) {
    throw new Error(
      "Firefox is unavailable; run `npx puppeteer browsers install firefox`.",
    );
  }
  return newest;
}

async function ensureReleaseBuild() {
  try {
    await access(
      path.join(
        outputRoot,
        `increader-browser-extension-${version}-chrome-upload.zip`,
      ),
    );
  } catch {
    execFileSync(process.execPath, ["scripts/build.mjs", "--mode", "production"], {
      cwd: repositoryRoot,
      stdio: "inherit",
    });
  }
}

async function startSuiteServer(bundlePath) {
  const bundle = await readFile(bundlePath);
  const server = createServer((request, response) => {
    if (request.url === "/core-matrix.js") {
      response.writeHead(200, {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(bundle);
      return;
    }
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(
      "<!doctype html><meta charset=utf-8><title>Browser Capture release suite</title><script src=/core-matrix.js></script>",
    );
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Release suite server did not bind");
  }
  return {
    url: `http://127.0.0.1:${String(address.port)}/`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
      }),
  };
}

function delay(milliseconds) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}
