/* eslint-disable no-undef -- The smoke test evaluates the extension page. */
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import puppeteer from "puppeteer";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const extensionRoot = path.join(repositoryRoot, "dist", "production", "chrome");

execFileSync(process.execPath, ["scripts/build.mjs", "--mode", "production"], {
  cwd: repositoryRoot,
  stdio: "inherit",
});

const manifest = JSON.parse(
  await readFile(path.join(extensionRoot, "manifest.json"), "utf8"),
);
let browser;
try {
  browser = await puppeteer.launch({
    args: [
      `--disable-extensions-except=${extensionRoot}`,
      `--load-extension=${extensionRoot}`,
      "--no-sandbox",
    ],
    executablePath:
      process.env.CHROME_BINARY ?? (await puppeteer.executablePath()),
    headless: true,
  });
  const extension = await waitFor(async () =>
    [...(await browser.extensions()).values()].find(
      (candidate) => candidate.name === manifest.name,
    ),
  );
  const popup = await browser.newPage();
  await popup.goto(`chrome-extension://${extension.id}/popup.html`);
  await popup.waitForFunction(
    () =>
      document.querySelector("[data-login-view]")?.hidden === false &&
      document.querySelector("[data-connection-card]")?.hidden === true,
  );
  const form = await popup.evaluate(() => ({
    accountCardHidden: document.querySelector("[data-connection-card]")?.hidden,
    bodyMinHeight: globalThis.getComputedStyle(document.body).minHeight,
    email: document.querySelector("#login-email")?.getAttribute("type"),
    google: document
      .querySelector("[data-google-sign-in]")
      ?.textContent?.trim(),
    loginHidden: document.querySelector("[data-login-view]")?.hidden,
    origin: document
      .querySelector("#self-hosted-origin")
      ?.getAttribute("value"),
    password: document.querySelector("#login-password")?.getAttribute("type"),
    settingsHidden: document.querySelector("[data-settings-view]")?.hidden,
  }));
  if (
    form.accountCardHidden !== true ||
    form.bodyMinHeight !== "0px" ||
    form.email !== "email" ||
    form.google !== "Continue with Google" ||
    form.loginHidden !== false ||
    form.password !== "password" ||
    form.origin !== "https://app.increader.com" ||
    form.settingsHidden !== true
  ) {
    throw new Error("The production popup did not expose the account form.");
  }
  await popup.click("[data-view-toggle]");
  const settings = await popup.evaluate(() => ({
    loginHidden: document.querySelector("[data-login-view]")?.hidden,
    settingsHidden: document.querySelector("[data-settings-view]")?.hidden,
  }));
  if (settings.loginHidden !== true || settings.settingsHidden !== false) {
    throw new Error("The cog did not open the separate instance screen.");
  }
  process.stdout.write(
    `Loaded ${manifest.name} ${manifest.version} (${extension.id})\n`,
  );
} finally {
  await browser?.close().catch(() => undefined);
}

async function waitFor(read, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => globalThis.setTimeout(resolve, 100));
  }
  throw new Error(`Browser smoke condition timed out after ${timeout} ms`);
}
