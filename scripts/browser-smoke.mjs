/* eslint-disable no-undef -- The smoke test evaluates the extension page. */
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import puppeteer from "puppeteer";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const extensionRoot = path.join(
  repositoryRoot,
  "dist",
  "production",
  "chrome",
);

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
      document.querySelector("[data-status]")?.textContent === "Signed out",
  );
  const form = await popup.evaluate(() => ({
    email: document.querySelector("#login-email")?.getAttribute("type"),
    origin: document
      .querySelector("#self-hosted-origin")
      ?.getAttribute("value"),
    password: document.querySelector("#login-password")?.getAttribute("type"),
  }));
  if (
    form.email !== "email" ||
    form.password !== "password" ||
    form.origin !== "https://app.increader.com"
  ) {
    throw new Error("The production popup did not expose the account form.");
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
