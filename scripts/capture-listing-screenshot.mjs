/* eslint-disable no-undef -- The capture evaluates the production extension page. */
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { unzipSync } from "fflate";
import puppeteer from "puppeteer";
import sharp from "sharp";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(
  await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
);
const archivePath = path.join(
  repositoryRoot,
  "dist",
  "production",
  `increader-browser-extension-${packageJson.version}-chrome-upload.zip`,
);
const outputPath = path.join(
  repositoryRoot,
  "release",
  "assets",
  "listing-screenshot.png",
);
const extensionRoot = await mkdtemp(
  path.join(os.tmpdir(), "browser-capture-listing-"),
);
let browser;

try {
  execFileSync(
    process.execPath,
    ["scripts/build.mjs", "--mode", "production"],
    {
      cwd: repositoryRoot,
      stdio: "inherit",
    },
  );
  await extractArchive(
    new Uint8Array(await readFile(archivePath)),
    extensionRoot,
  );
  browser = await puppeteer.launch({
    headless: false,
    executablePath:
      process.env.CHROME_BINARY ?? (await puppeteer.executablePath()),
    args: [
      `--disable-extensions-except=${extensionRoot}`,
      `--load-extension=${extensionRoot}`,
      "--no-sandbox",
    ],
  });
  const extension = await waitFor(async () =>
    [...(await browser.extensions()).values()].find(
      (candidate) => candidate.name === "Increader Browser Capture",
    ),
  );
  const popup = await browser.newPage();
  await popup.setViewport({ width: 344, height: 620, deviceScaleFactor: 1 });
  await popup.emulateMediaFeatures([
    { name: "prefers-color-scheme", value: "light" },
  ]);
  await popup.goto(`chrome-extension://${extension.id}/popup.html`);
  await popup.waitForFunction(
    () =>
      document.querySelector("[data-status]")?.textContent === "Not connected",
  );
  const body = await popup.$("body");
  if (body === null) throw new Error("Production popup body was unavailable");
  const popupPng = await body.screenshot({ type: "png" });
  const popupMetadata = await sharp(popupPng).metadata();
  const popupWidth = popupMetadata.width;
  const popupHeight = popupMetadata.height;
  if (popupWidth === undefined || popupHeight === undefined) {
    throw new Error("Production popup screenshot dimensions were unavailable");
  }
  const popupLeft = 820;
  const popupTop = Math.floor((800 - popupHeight) / 2);
  const artwork = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800">
      <rect width="1280" height="800" fill="#eef2ff"/>
      <circle cx="126" cy="158" r="54" fill="#4f46e5"/>
      <path d="M94 126h26a18 18 0 0 1 18 18v62a16 16 0 0 0-16-16H94z"
        fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round"
        stroke-linejoin="round"/>
      <path d="M190 126h-26a18 18 0 0 0-18 18v62a16 16 0 0 1 16-16h28z"
        fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round"
        stroke-linejoin="round"/>
      <text x="94" y="300" font-family="Arial, sans-serif" font-size="54"
        font-weight="700" fill="#1e1b4b">Send the page you choose.</text>
      <text x="94" y="366" font-family="Arial, sans-serif" font-size="27"
        fill="#475569">Pair once. Check the exact URL.</text>
      <text x="94" y="408" font-family="Arial, sans-serif" font-size="27"
        fill="#475569">Import only when you decide.</text>
      <text x="94" y="516" font-family="Arial, sans-serif" font-size="20"
        font-weight="700" fill="#4338ca">INCREADER BROWSER CAPTURE</text>
      <rect x="${String(popupLeft - 18)}" y="${String(popupTop - 18)}"
        width="${String(popupWidth + 36)}" height="${String(popupHeight + 36)}"
        rx="20" fill="#c7d2fe"/>
    </svg>
  `);
  await sharp({
    create: {
      width: 1280,
      height: 800,
      channels: 4,
      background: "#eef2ff",
    },
  })
    .composite([
      { input: artwork, left: 0, top: 0 },
      { input: popupPng, left: popupLeft, top: popupTop },
    ])
    .png({ adaptiveFiltering: false, compressionLevel: 9 })
    .toFile(outputPath);
  console.log("Captured actual production popup listing screenshot", {
    chrome: await browser.version(),
    extensionId: extension.id,
    outputPath,
    version: extension.version,
  });
} finally {
  await browser?.close().catch(() => undefined);
  await rm(extensionRoot, { force: true, recursive: true });
}

async function extractArchive(archive, destinationRoot) {
  for (const [relativePath, bytes] of Object.entries(unzipSync(archive))) {
    const destination = path.resolve(destinationRoot, relativePath);
    if (!destination.startsWith(`${destinationRoot}${path.sep}`)) {
      throw new Error(`Archive escaped extraction root: ${relativePath}`);
    }
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
  }
}

async function waitFor(read, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => globalThis.setTimeout(resolve, 100));
  }
  throw new Error(
    `Listing capture condition not met within ${String(timeout)} ms`,
  );
}
