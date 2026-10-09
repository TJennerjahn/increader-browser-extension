/* eslint-disable no-undef -- The smoke test evaluates the extension page. */
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import puppeteer from "puppeteer";
import assert from "node:assert/strict";
import { build } from "esbuild";

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
    progress: (() => {
      const icon = document.querySelector("[data-page-icon]");
      const indicator = document.querySelector(
        "[data-page-progress-indicator]",
      );
      if (
        !(icon instanceof HTMLElement) ||
        !(indicator instanceof SVGElement)
      ) {
        return null;
      }
      icon.dataset.state = "loading";
      return {
        animationName: globalThis.getComputedStyle(indicator).animationName,
        dashArray: indicator.getAttribute("stroke-dasharray"),
        pathLength: indicator.getAttribute("pathLength"),
        rotatingBorderAnimation: globalThis.getComputedStyle(icon, "::before")
          .animationName,
      };
    })(),
    settingsHidden: document.querySelector("[data-settings-view]")?.hidden,
  }));
  if (
    form.accountCardHidden !== true ||
    form.bodyMinHeight !== "0px" ||
    form.email !== "email" ||
    form.google !== "Continue with Google" ||
    form.loginHidden !== false ||
    form.password !== "password" ||
    form.progress?.animationName !== "page-icon-progress" ||
    form.progress.dashArray !== "22 78" ||
    form.progress.pathLength !== "100" ||
    form.progress.rotatingBorderAnimation !== "none" ||
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
  await qualifyImportOptions(browser);
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

// The packaged extension is checked above. Here the production popup is mounted
// against delayed browser/HTTP boundaries to exercise draft and keyboard behavior.
async function qualifyImportOptions(browser) {
  const bundle = await build({
    entryPoints: [
      path.join(repositoryRoot, "release/browser/popup-qualification.ts"),
    ],
    bundle: true,
    format: "iife",
    target: "chrome140",
    write: false,
  });
  const reportDirectory = path.join(repositoryRoot, "dist", "qualification");
  await mkdir(reportDirectory, { recursive: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 384, height: 620 });
  await page.emulateMediaFeatures([
    { name: "prefers-reduced-motion", value: "reduce" },
  ]);
  await page.setContent(
    '<!doctype html><html lang="en"><head><title>Import options qualification</title></head><body><main></main></body></html>',
  );
  await page.addStyleTag({
    content: await readFile(
      path.join(repositoryRoot, "src/popup/popup.css"),
      "utf8",
    ),
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.waitForFunction(
    () =>
      document.querySelector("#bookmark-title")?.value === "A readable article",
  );
  assert.equal(
    await page.$eval("#add-to-queue", (input) => input.checked),
    true,
  );
  await page.focus("#bookmark-title");
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.type("My reading title");
  await page.keyboard.press("Tab");
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    "add-to-queue",
  );
  await page.keyboard.press("Space");
  await page.evaluate(() => {
    globalThis.popupQualification.refresh();
    globalThis.popupQualification.finishLookup();
  });
  await page.waitForFunction(
    () => document.querySelector("[data-import]")?.disabled === false,
  );
  const readOptions = () =>
    page.evaluate(() => ({
      title: document.querySelector("#bookmark-title")?.value,
      queue: document.querySelector("#add-to-queue")?.checked,
      titleLabel: document
        .querySelector('label[for="bookmark-title"]')
        ?.textContent.trim(),
      queueLabel: document
        .querySelector('label[for="add-to-queue"]')
        ?.textContent.trim(),
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
    }));
  const edited = await readOptions();
  assert.deepEqual(edited, {
    title: "My reading title",
    queue: false,
    titleLabel: "Bookmark title",
    queueLabel: "Add to reading queue",
    horizontalOverflow: false,
  });
  await page.screenshot({
    path: path.join(reportDirectory, "popup-options.png"),
    fullPage: true,
  });
  await page.emulateMediaFeatures([
    { name: "prefers-color-scheme", value: "light" },
    { name: "prefers-reduced-motion", value: "reduce" },
  ]);
  await page.screenshot({
    path: path.join(reportDirectory, "popup-options-light.png"),
    fullPage: true,
  });
  await page.setViewport({ width: 320, height: 620 });
  await page.waitForFunction(
    () => document.documentElement.scrollWidth <= innerWidth,
  );
  assert.equal((await readOptions()).horizontalOverflow, false);
  await page.screenshot({
    path: path.join(reportDirectory, "popup-options-narrow.png"),
    fullPage: true,
  });
  await page.click("[data-import]");
  await page.waitForFunction(
    () => globalThis.popupQualification.imports.length === 1,
  );
  const submitted = await page.evaluate(() => ({
    options: globalThis.popupQualification.imports[0][3],
    titleDisabled: document.querySelector("#bookmark-title")?.disabled,
    queueDisabled: document.querySelector("#add-to-queue")?.disabled,
  }));
  assert.deepEqual(submitted, {
    options: { titleOverride: "My reading title", addToQueue: false },
    titleDisabled: true,
    queueDisabled: true,
  });
  await page.evaluate(() => globalThis.popupQualification.complete());
  await page.waitForFunction(
    () => document.querySelector("[data-open-reader]")?.hidden === false,
  );
  assert.equal(
    await page.$eval("[data-import-options]", (element) => element.hidden),
    true,
  );
  await writeFile(
    path.join(reportDirectory, "popup-options.json"),
    JSON.stringify({ edited, submitted, completed: true }, null, 2) + "\n",
  );
  await page.close();
}
