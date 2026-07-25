/* eslint-disable no-undef -- This harness evaluates code in Node, browser, and extension contexts. */
import path from "node:path";
import { execFileSync } from "node:child_process";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createServer as createHttpServer,
  request as requestHttp,
} from "node:http";
import {
  createServer as createHttpsServer,
  request as requestHttps,
} from "node:https";
import { connect as connectTcp } from "node:net";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import process from "node:process";

import { unzipSync } from "fflate";
import { download as downloadGeckodriver } from "geckodriver";
import puppeteer from "puppeteer";
import { Builder, By, until } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const increaderRepository = path.resolve(
  process.env.INCREADER_REPOSITORY ??
    path.join(repositoryRoot, "..", "Increader"),
);
const packageJson = JSON.parse(
  await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
);
const stack = process.env.BROWSER_CAPTURE_STACK ?? "selfhosted";
if (stack !== "cloud" && stack !== "selfhosted") {
  throw new Error(`Unsupported Browser Capture stack: ${stack}`);
}
const cloud = stack === "cloud";
const internalInstanceOrigin = `http://127.0.0.1:${
  process.env.BROWSER_CAPTURE_WEB_PORT ?? "5289"
}`;
const publicProxyPort = Number(
  process.env.BROWSER_CAPTURE_PUBLIC_PORT ?? "5443",
);
const delayedResponseMilliseconds = Number(
  process.env.BROWSER_CAPTURE_DELAY_MILLISECONDS ?? "35000",
);
if (
  !Number.isSafeInteger(delayedResponseMilliseconds) ||
  delayedResponseMilliseconds < 1
) {
  throw new Error("BROWSER_CAPTURE_DELAY_MILLISECONDS must be positive");
}
const instanceOrigin = cloud
  ? "https://app.increader.com"
  : `https://127.0.0.1:${String(publicProxyPort)}`;
let browser;
let extractedPackage;
let fixture;
let forwardProxy;
let publicProxy;
let services;
try {
  execFileSync(
    process.execPath,
    ["scripts/build.mjs", "--mode", "production"],
    {
      cwd: repositoryRoot,
      stdio: "inherit",
    },
  );
  fixture = await startFixtureServer();
  publicProxy = await startPublicProxy();
  if (cloud) {
    forwardProxy = await startConnectProxy();
  }
  if (process.env.BROWSER_CAPTURE_ONLY_FIREFOX !== "1") {
    services = await startIncreaderServices(increaderRepository);
    const archivePath = path.join(
      repositoryRoot,
      "dist",
      "production",
      `increader-browser-extension-${packageJson.version}-chrome-upload.zip`,
    );
    const archive = await readFile(archivePath);
    const archiveSha256 = createHash("sha256").update(archive).digest("hex");
    extractedPackage = await mkdtemp(
      path.join(os.tmpdir(), "browser-capture-chrome-upload-"),
    );
    await extractExactArchive(archive, extractedPackage);

    browser = await puppeteer.launch({
      headless: false,
      executablePath:
        process.env.CHROME_BINARY ?? (await puppeteer.executablePath()),
      args: [
        `--disable-extensions-except=${extractedPackage}`,
        "--ignore-certificate-errors",
        `--load-extension=${extractedPackage}`,
        "--no-sandbox",
        ...(forwardProxy === undefined
          ? []
          : [
              `--proxy-server=http://127.0.0.1:${String(forwardProxy.port)}`,
              "--proxy-bypass-list=127.0.0.1;localhost",
            ]),
      ],
    });

    const discoveryResponse = await fetchTrustedJson(
      `${instanceOrigin}/api/browser-capture/discovery`,
      publicProxy.caCertificatePath,
    );
    const discovery = discoveryResponse.body;
    if (
      discoveryResponse.status < 200 ||
      discoveryResponse.status >= 300 ||
      new URL(discoveryResponse.url).origin !== instanceOrigin ||
      discovery.protocol !== "increader-browser-capture"
    ) {
      throw new Error("Discovery did not use the public instance origin");
    }
    console.log(
      "discovery public origin",
      new URL(discoveryResponse.url).origin,
    );
    const deadline = Date.now() + 15_000;
    let extension;
    while (Date.now() < deadline) {
      extension = [...(await browser.extensions()).values()].find(
        (candidate) => candidate.name === "Increader Browser Capture",
      );
      if (extension !== undefined) break;
      await delay(100);
    }
    if (extension === undefined) throw new Error("extension unavailable");
    console.log(
      "extension",
      extension.id,
      extension.version,
      "archive SHA-256",
      archiveSha256,
    );

    const account = await browser.newPage();
    await account.goto(
      cloud ? `${instanceOrigin}/bookmarks` : `${instanceOrigin}/sign-up`,
    );
    if (!cloud) {
      await account.waitForSelector("input", { timeout: 15_000 });
      const inputs = await account.$$("input");
      await inputs[0].type("Browser Capture E2E");
      await inputs[1].type(
        `browser-capture-${String(Date.now())}@e2e.increader.local`,
      );
      await inputs[2].type("e2e-password-868");
      await inputs[3].type("e2e-password-868");
      await account.$eval("button[type=submit]", (button) => button.click());
    }
    await account.waitForFunction(() => location.pathname === "/bookmarks", {
      timeout: 15_000,
    });
    console.log("account", account.url());

    const publisher = await browser.newPage();
    await publisher.goto(fixture.articleUrl);
    await extension.triggerAction(publisher);
    let popup;
    while (Date.now() < deadline) {
      popup = (await extension.pages()).find((page) =>
        page.url().endsWith("/popup.html"),
      );
      if (popup !== undefined) break;
      await delay(100);
    }
    if (popup === undefined) throw new Error("popup unavailable");
    console.log("popup", popup.url());
    if (!cloud) {
      await popup.$eval("details", (details) => {
        details.open = true;
      });
      await popup.type("#self-hosted-origin", instanceOrigin);
    }

    const authPromise = browser.waitForTarget(
      (target) =>
        target
          .url()
          .startsWith(`${instanceOrigin}/browser-capture/pairing/approve`),
      { timeout: 15_000 },
    );
    await popup.click(
      cloud
        ? "[data-cloud-connect]"
        : "[data-self-hosted-form] button[type=submit]",
    );
    await delay(500);
    const chromeWindows = execFileSync(
      "xdotool",
      ["search", "--onlyvisible", "--class", "Chromium-browser"],
      { encoding: "utf8" },
    )
      .trim()
      .split("\n");
    const browserPid = browser.process()?.pid;
    const chromeWindow = chromeWindows.find((windowId) => {
      if (browserPid === undefined) return false;
      try {
        return (
          Number(
            execFileSync("xdotool", ["getwindowpid", windowId], {
              encoding: "utf8",
            }).trim(),
          ) === browserPid
        );
      } catch {
        return false;
      }
    });
    if (chromeWindow === undefined || chromeWindow.length === 0) {
      throw new Error("Chrome X11 window unavailable");
    }
    console.log(
      "chrome window",
      chromeWindow,
      execFileSync("xdotool", ["getwindowname", chromeWindow], {
        encoding: "utf8",
      }).trim(),
    );
    execFileSync("xdotool", ["windowfocus", "--sync", chromeWindow]);
    execFileSync("xdotool", ["key", "--window", chromeWindow, "Tab"]);
    await delay(200);
    execFileSync("xdotool", ["key", "--window", chromeWindow, "Return"]);
    await waitFor(
      async () =>
        await (
          await extension.workers()
        )[0].evaluate(
          (originPattern) =>
            new Promise((resolve) => {
              chrome.permissions.contains(
                { origins: [originPattern] },
                resolve,
              );
            }),
          `${instanceOrigin}/*`,
        ),
    );
    console.log("host permission granted");

    let authTarget;
    try {
      authTarget = await authPromise;
    } catch (error) {
      let popupBody = "detached";
      try {
        popupBody = await popup.$eval("body", (element) => element.innerText);
      } catch {
        // Browser action popups ordinarily detach when an identity window opens.
      }
      console.log(
        "connect failure",
        popupBody,
        (await browser.targets()).map((target) => ({
          type: target.type(),
          url: target.url(),
        })),
        await (
          await extension.workers()
        )[0].evaluate(
          (originPattern) =>
            new Promise((resolve) => {
              chrome.permissions.contains(
                { origins: [originPattern] },
                (granted) => {
                  chrome.storage.local.get(null, (storage) => {
                    resolve({ granted, storage });
                  });
                },
              );
            }),
          `${instanceOrigin}/*`,
        ),
        services.output(),
      );
      throw error;
    }
    const authPage = await authTarget.asPage();
    if (authPage === null) throw new Error("auth page unavailable");
    if (
      new URL(authPage.url()).searchParams.get("instance_origin") !==
      instanceOrigin
    ) {
      throw new Error(
        "PKCE approval did not preserve the public instance origin",
      );
    }
    await authPage.waitForSelector("button", { timeout: 15_000 });
    console.log("auth", authPage.url(), await authPage.title());
    console.log(
      "auth buttons",
      await authPage.$$eval("button", (buttons) =>
        buttons.map((button) => button.textContent?.trim()),
      ),
    );
    await authPage.click("button");
    try {
      await waitFor(
        async () =>
          await (
            await extension.workers()
          )[0].evaluate(
            () =>
              new Promise((resolve) => {
                chrome.storage.local.get(
                  ["browserCapturePairingCredential"],
                  (storage) => {
                    resolve(
                      storage.browserCapturePairingCredential === undefined
                        ? undefined
                        : storage,
                    );
                  },
                );
              }),
          ),
      );
    } catch (error) {
      console.log(
        "pairing state",
        await (
          await extension.workers()
        )[0].evaluate(
          () =>
            new Promise((resolve) => {
              chrome.storage.local.get(null, resolve);
            }),
        ),
        (await browser.targets()).map((target) => ({
          type: target.type(),
          url: target.url(),
        })),
      );
      throw error;
    }

    await publisher.bringToFront();
    await extension.triggerAction(publisher);
    popup = await waitFor(async () =>
      (await extension.pages()).find((page) =>
        page.url().endsWith("/popup.html"),
      ),
    );
    await popup.waitForFunction(
      () => document.querySelector("[data-status]")?.textContent === "Paired",
      { timeout: 15_000 },
    );
    console.log(
      "paired after first submit",
      await popup.$eval("[data-status]", (element) => element.textContent),
    );
    await popup.waitForFunction(
      () =>
        document.querySelector("[data-page-status]")?.textContent === "Ready",
      { timeout: 15_000 },
    );
    await popup.click("[data-import]");
    await popup.waitForFunction(
      () =>
        document.querySelector("[data-page-status]")?.textContent ===
        "Imported",
      { timeout: 30_000 },
    );
    const firstReaderTarget = browser.waitForTarget(
      (target) => target.url().startsWith(`${instanceOrigin}/bookmarks/`),
      { timeout: 15_000 },
    );
    await popup.click("[data-open-reader]");
    const firstReaderOpenedTarget = await firstReaderTarget;
    const firstReader = await firstReaderOpenedTarget.asPage();
    if (firstReader === null) throw new Error("Reader page unavailable");
    await firstReader.waitForFunction(
      () =>
        document.body.textContent?.includes(
          "This exact rendered text must appear in Reader Content.",
        ) === true,
      { timeout: 15_000 },
    );
    console.log("created Reader verified", firstReader.url());

    await publisher.bringToFront();
    await extension.triggerAction(publisher);
    popup = await waitFor(async () =>
      (await extension.pages()).find((page) =>
        page.url().endsWith("/popup.html"),
      ),
    );
    await popup.waitForFunction(
      () => {
        const button = document.querySelector("[data-import]");
        return button instanceof HTMLButtonElement && !button.disabled;
      },
      { timeout: 15_000 },
    );
    await popup.click("[data-import]");
    await popup.waitForFunction(
      () =>
        document.querySelector("[data-page-status]")?.textContent ===
        "Already in Increader",
      { timeout: 15_000 },
    );
    const existingReaderTarget = browser.waitForTarget(
      (target) =>
        target.url().startsWith(`${instanceOrigin}/bookmarks/`) &&
        target !== firstReaderOpenedTarget,
      { timeout: 15_000 },
    );
    await popup.click("[data-open-reader]");
    const existingReader = await (await existingReaderTarget).asPage();
    if (existingReader === null) {
      throw new Error("Existing Bookmark Reader page unavailable");
    }
    await existingReader.waitForFunction(
      () => location.pathname.startsWith("/bookmarks/"),
      { timeout: 15_000 },
    );
    console.log("existing Bookmark opened", existingReader.url());

    if (!cloud) {
      await runChromeStressWorkflow({
        browser,
        extension,
        publisher,
      });
    }

    await publisher.bringToFront();
    await extension.triggerAction(publisher);
    popup = await waitFor(async () =>
      (await extension.pages()).find((page) =>
        page.url().endsWith("/popup.html"),
      ),
    );
    await popup.click("[data-disconnect]");
    await popup.waitForFunction(
      () =>
        document.querySelector("[data-status]")?.textContent ===
        "Not connected",
      { timeout: 15_000 },
    );
    const disconnected = await waitFor(async () => {
      const state = await (
        await extension.workers()
      )[0].evaluate(
        (originPattern) =>
          new Promise((resolve) => {
            chrome.permissions.contains(
              { origins: [originPattern] },
              (granted) => {
                chrome.storage.local.get(null, (storage) => {
                  resolve({ granted, storage });
                });
              },
            );
          }),
        `${instanceOrigin}/*`,
      );
      return state.granted ? undefined : state;
    });
    console.log("disconnected", disconnected);

    await browser.close();
    browser = undefined;
    await services.close();
  }
  if (process.env.BROWSER_CAPTURE_ONLY_CHROME !== "1") {
    services = await startIncreaderServices(increaderRepository);
    await runFirefoxWorkflow({
      archivePath: path.join(
        repositoryRoot,
        "dist",
        "production",
        `increader-browser-extension-${packageJson.version}-firefox-upload.zip`,
      ),
      articleUrl: fixture.articleUrl,
      caCertificatePath: publicProxy.caCertificatePath,
    });
  }
} catch (error) {
  if (services !== undefined) {
    console.error(
      "Increader service trace after release failure\n",
      services.output(),
    );
  }
  throw error;
} finally {
  await browser?.close().catch(() => undefined);
  if (extractedPackage !== undefined) {
    await rm(extractedPackage, { force: true, recursive: true });
  }
  await fixture?.close().catch(() => undefined);
  await services?.close().catch(() => undefined);
  await forwardProxy?.close().catch(() => undefined);
  await publicProxy?.close().catch(() => undefined);
}

async function runFirefoxWorkflow({
  archivePath,
  articleUrl,
  caCertificatePath,
}) {
  const archive = await readFile(archivePath);
  const archiveSha256 = createHash("sha256").update(archive).digest("hex");
  const geckodriverPath = await downloadGeckodriver();
  const firefoxBinary = await findFirefoxBinary();
  const firefoxProfile = await mkdtemp(
    path.join(os.tmpdir(), "browser-capture-firefox-profile-"),
  );
  execFileSync(
    "certutil",
    ["-N", "--empty-password", "-d", `sql:${firefoxProfile}`],
    { stdio: "ignore" },
  );
  execFileSync(
    "certutil",
    [
      "-A",
      "-d",
      `sql:${firefoxProfile}`,
      "-i",
      caCertificatePath,
      "-n",
      "Increader Browser Capture release harness",
      "-t",
      "C,,",
    ],
    { stdio: "ignore" },
  );
  const service = new firefox.ServiceBuilder(geckodriverPath).addArguments(
    "--allow-system-access",
  );
  // Firefox's own identity mochitest is quarantined on Ubuntu 24.04/X11.
  // Run Gecko headless while still driving its real browser chrome, native
  // permission prompt, toolbar action, and remote popup actors through
  // Marionette. Chrome remains headed under Xvfb for its native prompt.
  const options = new firefox.Options()
    .setBinary(firefoxBinary)
    .setAcceptInsecureCerts(true)
    .setProfile(firefoxProfile)
    .addArguments("-headless");
  if (forwardProxy !== undefined) {
    options
      .setPreference("network.proxy.type", 1)
      .setPreference("network.proxy.http", "127.0.0.1")
      .setPreference("network.proxy.http_port", forwardProxy.port)
      .setPreference("network.proxy.ssl", "127.0.0.1")
      .setPreference("network.proxy.ssl_port", forwardProxy.port)
      .setPreference("network.proxy.no_proxies_on", "127.0.0.1,localhost");
  }
  const driver = await new Builder()
    .forBrowser("firefox")
    .setFirefoxOptions(options)
    .setFirefoxService(service)
    .build();

  try {
    const extensionId = await driver.installAddon(archivePath, true);
    if (extensionId !== "browser-capture@increader.com") {
      throw new Error(`Unexpected Firefox extension ID: ${extensionId}`);
    }
    console.log(
      "Firefox extension",
      extensionId,
      packageJson.version,
      "archive SHA-256",
      archiveSha256,
    );

    await driver.get(
      cloud ? `${instanceOrigin}/bookmarks` : `${instanceOrigin}/sign-up`,
    );
    if (!cloud) {
      const accountInputs = await driver.wait(
        until.elementsLocated(By.css("input")),
        15_000,
      );
      await accountInputs[0].sendKeys("Browser Capture Firefox E2E");
      await accountInputs[1].sendKeys(
        `browser-capture-firefox-${String(Date.now())}@e2e.increader.local`,
      );
      await accountInputs[2].sendKeys("e2e-password-868");
      await accountInputs[3].sendKeys("e2e-password-868");
      await driver.findElement(By.css("button[type=submit]")).click();
    }
    await driver.wait(until.urlContains("/bookmarks"), 15_000);
    const accountHandle = await driver.getWindowHandle();
    console.log("Firefox account", await driver.getCurrentUrl());

    await driver.switchTo().newWindow("tab");
    const publisherHandle = await driver.getWindowHandle();
    await driver.get(articleUrl);
    await openFirefoxPopup(driver);
    if (cloud) {
      await firefoxPopupClick(driver, "[data-cloud-connect]");
    } else {
      await firefoxPopupClick(driver, "details > summary");
      await firefoxPopupType(driver, "#self-hosted-origin", instanceOrigin);
      await firefoxPopupClick(
        driver,
        "[data-self-hosted-form] button[type=submit]",
      );
    }
    await delay(500);
    console.log(
      "Firefox connect state",
      await firefoxPopupEvaluate(
        driver,
        `return {
          status: document.querySelector("[data-status]")?.textContent,
          detail: document.querySelector("[data-detail]")?.textContent
        };`,
      ),
    );

    await driver.setContext(firefox.Context.CHROME);
    let permissionButton;
    try {
      permissionButton = await driver.wait(
        until.elementLocated(By.css(".popup-notification-primary-button")),
        15_000,
      );
    } catch (error) {
      console.log(
        "Firefox chrome buttons",
        await driver.executeScript(`
          return [...document.querySelectorAll("button, toolbarbutton")].map(
            element => ({
              id: element.id,
              className: element.className,
              label: element.getAttribute("label"),
              text: element.textContent?.trim(),
              hidden: element.hidden,
              rect: element.getBoundingClientRect().toJSON()
            })
          ).filter(candidate => candidate.rect.width > 0);
        `),
      );
      throw error;
    }
    await driver.wait(until.elementIsVisible(permissionButton), 15_000);
    try {
      await permissionButton.click();
    } catch (error) {
      if (error?.name !== "ElementNotInteractableError") throw error;
      await driver.executeScript("arguments[0].click();", permissionButton);
    }
    console.log("Firefox host permission granted");
    await driver.executeScript(`
      const extensionPopup = document.getElementById(
        "customizationui-widget-panel"
      );
      if (extensionPopup?.state === "open") extensionPopup.hidePopup();
    `);
    console.log("Firefox extension popup dismissed after native permission");
    await delay(500);

    const approvalPrefix = `${instanceOrigin}/browser-capture/pairing/approve`;
    let approvalUrl;
    try {
      approvalUrl = await waitFor(async () =>
        (await firefoxBrowserUrls(driver)).find((url) =>
          url.startsWith(approvalPrefix),
        ),
      );
    } catch (error) {
      console.error(
        "Firefox pairing popup diagnostics",
        await firefoxPopupEvaluate(
          driver,
          `
            const timeout = value => new Promise(resolve => {
              setTimeout(() => resolve(value), 3000);
            });
            return Promise.all([
              Promise.race([
                browser.permissions.contains({
                  origins: [${JSON.stringify(firefoxPermissionPattern())}]
                }).then(value => ({ permission: value })),
                timeout({ permission: "timed out" })
              ]),
              Promise.race([
                fetch(${JSON.stringify(
                  `${instanceOrigin}/api/browser-capture/discovery`,
                )}).then(async response => ({
                  discovery: response.status,
                  body: await response.text()
                })).catch(fetchError => ({
                  discovery: String(fetchError?.stack ?? fetchError)
                })),
                timeout({ discovery: "timed out" })
              ]),
              Promise.race([
                browser.runtime.sendMessage({
                  target: "pairing",
                  command: "discover",
                  origin: ${JSON.stringify(instanceOrigin)}
                }).then(value => ({ backgroundDiscovery: value })).catch(
                  sendError => ({
                    backgroundDiscovery: String(sendError?.stack ?? sendError)
                  })
                ),
                timeout({ backgroundDiscovery: "timed out" })
              ]),
              browser.storage.local.get(null)
            ]);
          `,
        ).catch((diagnosticError) => String(diagnosticError)),
      );
      console.error("Firefox pairing service trace\n", services.output());
      throw error;
    }
    console.log("Firefox auth window", approvalUrl);
    const authUrl = new URL(approvalUrl);
    if (authUrl.searchParams.get("instance_origin") !== instanceOrigin) {
      throw new Error(
        "Firefox PKCE approval did not preserve the public instance origin",
      );
    }
    await firefoxBrowserClick(driver, approvalPrefix, "button");
    console.log("Firefox approval submitted");
    await waitFor(
      async () =>
        !(await firefoxBrowserUrls(driver)).some((url) =>
          url.startsWith(approvalPrefix),
        ),
    );
    console.log("Firefox approval window closed");

    await driver.setContext(firefox.Context.CONTENT);
    await driver.switchTo().window(publisherHandle);
    await openFirefoxPopup(driver);
    await firefoxPopupWaitText(driver, "[data-status]", "Paired");
    await firefoxPopupWaitText(driver, "[data-page-status]", "Ready");
    console.log("Firefox paired after first submit");

    await firefoxPopupClick(driver, "[data-import]");
    await firefoxPopupWaitText(
      driver,
      "[data-page-status]",
      "Imported",
      30_000,
    );
    await driver.setContext(firefox.Context.CONTENT);
    const preReaderHandles = new Set(await driver.getAllWindowHandles());
    await firefoxPopupClick(driver, "[data-open-reader]");
    const firstReaderHandle = await waitFor(async () => {
      const handles = await driver.getAllWindowHandles();
      return handles.find((handle) => !preReaderHandles.has(handle));
    });
    await driver.setContext(firefox.Context.CONTENT);
    await driver.switchTo().window(firstReaderHandle);
    await waitFor(async () => {
      const text = await driver.executeScript(
        `return document.body?.innerText ?? "";`,
      );
      return text.includes(
        "This exact rendered text must appear in Reader Content.",
      );
    });
    console.log(
      "Firefox created Reader verified",
      await driver.getCurrentUrl(),
    );

    await driver.switchTo().window(publisherHandle);
    await openFirefoxPopup(driver);
    await waitFor(async () =>
      firefoxPopupEvaluate(
        driver,
        `return document.querySelector("[data-import]")?.disabled === false;`,
      ),
    );
    await firefoxPopupClick(driver, "[data-import]");
    await firefoxPopupWaitText(
      driver,
      "[data-page-status]",
      "Already in Increader",
    );
    await driver.setContext(firefox.Context.CONTENT);
    const preExistingReaderHandles = new Set(
      await driver.getAllWindowHandles(),
    );
    await firefoxPopupClick(driver, "[data-open-reader]");
    const existingReaderHandle = await waitFor(async () => {
      const handles = await driver.getAllWindowHandles();
      return handles.find((handle) => !preExistingReaderHandles.has(handle));
    });
    await driver.setContext(firefox.Context.CONTENT);
    await driver.switchTo().window(existingReaderHandle);
    await driver.wait(
      until.urlContains(`${instanceOrigin}/bookmarks/`),
      15_000,
    );
    console.log(
      "Firefox existing Bookmark opened",
      await driver.getCurrentUrl(),
    );

    if (!cloud) {
      await runFirefoxStressWorkflow({
        driver,
        publisherHandle,
      });
    }

    await driver.switchTo().window(publisherHandle);
    await openFirefoxPopup(driver);
    await firefoxPopupClick(driver, "[data-disconnect]");
    await firefoxPopupWaitText(driver, "[data-status]", "Not connected");
    const permissionRetained = await firefoxPopupEvaluate(
      driver,
      `return browser.permissions.contains({
        origins: [${JSON.stringify(firefoxPermissionPattern())}]
      });`,
    );
    if (permissionRetained !== false) {
      throw new Error("Firefox retained the revoked instance permission");
    }
    console.log("Firefox disconnected", {
      accountHandle,
      permissionRetained,
    });
  } finally {
    await driver.quit().catch(() => undefined);
    await rm(firefoxProfile, { force: true, recursive: true });
  }
}

async function runChromeStressWorkflow({ browser, extension, publisher }) {
  console.log("Chrome stress workflow started");

  const tenMiBStart = Date.now();
  const tenMiBRecordIndex = publicProxy.captureRequests().length;
  await publisher.bringToFront();
  await publisher.goto(fixture.tenMiBUrl);
  let popup = await openChromePopup(browser, extension, publisher);
  await waitForChromeImportable(popup, fixture.tenMiBUrl);
  await popup.click("[data-import]");
  await waitForChromeImportStarted(popup);
  await waitForChromeCaptureOutcome(popup, 30_000);
  const tenMiBRecord = await waitForCaptureRecord(tenMiBRecordIndex);
  assertCaptureSource(tenMiBRecord, fixture.tenMiBUrl);
  const tenMiBElapsed = Date.now() - tenMiBStart;
  if (tenMiBRecord.bodyBytes < 10 * 1024 * 1024) {
    throw new Error(
      `Ten MiB capture request was only ${String(tenMiBRecord.bodyBytes)} bytes`,
    );
  }
  if (tenMiBElapsed >= 30_000) {
    throw new Error(
      `Ten MiB / 60-asset capture took ${String(tenMiBElapsed)} ms`,
    );
  }
  console.log("Chrome 10 MiB / 60 assets verified", {
    bodyBytes: tenMiBRecord.bodyBytes,
    elapsedMilliseconds: tenMiBElapsed,
  });

  const delayedRecordIndex = publicProxy.captureRequests().length;
  publicProxy.queueCaptureFault({
    type: "delay-response",
    milliseconds: delayedResponseMilliseconds,
  });
  await publisher.bringToFront();
  await publisher.goto(fixture.delayedUrl);
  popup = await openChromePopup(browser, extension, publisher);
  await waitForChromeImportable(popup, fixture.delayedUrl);
  await popup.click("[data-import]");
  await waitForChromePageStatus(popup, "Sending to Increader");
  await popup.close().catch(() => undefined);
  await delay(1_000);
  popup = await openChromePopup(browser, extension, publisher);
  await waitForChromeCaptureOutcome(popup, 50_000);
  const delayedRecord = await waitForCaptureRecord(delayedRecordIndex);
  assertCaptureSource(delayedRecord, fixture.delayedUrl);
  const delayedElapsed = Date.now() - delayedRecord.startedAt;
  if (delayedElapsed < delayedResponseMilliseconds) {
    throw new Error(
      `Delayed capture completed after only ${String(delayedElapsed)} ms`,
    );
  }
  console.log("Chrome delayed-response popup survival verified", {
    elapsedMilliseconds: delayedElapsed,
  });
  if (process.env.BROWSER_CAPTURE_STOP_AFTER_DELAY === "1") return;

  const nearLimitRecordIndex = publicProxy.captureRequests().length;
  await publisher.bringToFront();
  await publisher.goto(fixture.nearLimitUrl);
  popup = await openChromePopup(browser, extension, publisher);
  await waitForChromeImportable(popup, fixture.nearLimitUrl);
  await popup.click("[data-import]");
  await waitForChromeImportStarted(popup);
  await waitForChromeCaptureOutcome(popup, 120_000);
  const nearLimitRecord = await waitForCaptureRecord(nearLimitRecordIndex);
  assertCaptureSource(nearLimitRecord, fixture.nearLimitUrl);
  if (nearLimitRecord.bodyBytes < 48 * 1024 * 1024) {
    throw new Error(
      `Near-limit request was only ${String(nearLimitRecord.bodyBytes)} bytes`,
    );
  }
  console.log("Chrome near-50 MiB package verified", {
    bodyBytes: nearLimitRecord.bodyBytes,
  });

  const preOversizeRequestCount = publicProxy.captureRequests().length;
  await publisher.bringToFront();
  await publisher.goto(fixture.oneOverHtmlUrl);
  popup = await openChromePopup(browser, extension, publisher);
  await waitForChromeImportable(popup, fixture.oneOverHtmlUrl);
  await popup.click("[data-import]");
  await waitForChromePageStatus(popup, "Needs attention", 30_000);
  await delay(500);
  if (publicProxy.captureRequests().length !== preOversizeRequestCount) {
    throw new Error("Oversize document reached the Capture API");
  }
  const oversizeState = await popup.evaluate(() => ({
    detail: document.querySelector("[data-page-detail]")?.textContent?.trim(),
    retryHidden:
      document.querySelector("[data-retry]") instanceof HTMLButtonElement
        ? document.querySelector("[data-retry]").hidden
        : undefined,
  }));
  if (oversizeState.retryHidden !== true) {
    throw new Error("Oversize deterministic failure offered Retry");
  }
  console.log("Chrome one-over document rejected before durable write", {
    detail: oversizeState.detail,
  });

  const droppedRecordIndex = publicProxy.captureRequests().length;
  publicProxy.queueCaptureFault({ type: "drop-response" });
  await publisher.bringToFront();
  await publisher.goto(fixture.ambiguousUrl);
  popup = await openChromePopup(browser, extension, publisher);
  await waitForChromeImportable(popup, fixture.ambiguousUrl);
  await popup.click("[data-import]");
  await waitForChromePageStatus(popup, "Sending to Increader");
  const droppedRecord = await waitForCaptureRecord(droppedRecordIndex);
  await popup.close().catch(() => undefined);
  await delay(121_000);
  popup = await openChromePopup(browser, extension, publisher);
  await waitForChromePageStatus(popup, "Needs attention", 15_000);
  await popup.waitForFunction(
    () =>
      document.querySelector("[data-retry]") instanceof HTMLButtonElement &&
      !document.querySelector("[data-retry]").hidden,
    { timeout: 15_000 },
  );
  if (publicProxy.captureRequests().length !== droppedRecordIndex + 1) {
    throw new Error("Dropped transfer retried without explicit Retry");
  }
  await popup.click("[data-retry]");
  await waitForChromePageStatus(popup, "Already in Increader", 30_000);
  const retriedRecord = await waitForCaptureRecord(droppedRecordIndex + 1);
  assertSameCaptureRequest(droppedRecord, retriedRecord);
  console.log("Chrome explicit byte-identical Retry verified", {
    bodyBytes: retriedRecord.bodyBytes,
    captureId: retriedRecord.captureId,
  });
}

async function openChromePopup(browser, extension, publisher) {
  const existingPopups = (await extension.pages()).filter((page) =>
    page.url().endsWith("/popup.html"),
  );
  await Promise.all(
    existingPopups.map((page) => page.close().catch(() => undefined)),
  );
  await publisher.bringToFront();
  await extension.triggerAction(publisher);
  return waitFor(async () =>
    (await extension.pages()).find((page) =>
      page.url().endsWith("/popup.html"),
    ),
  );
}

async function waitForChromeImportable(popup, expectedSourceUrl) {
  await popup.waitForFunction(
    (sourceUrl) =>
      document.querySelector("[data-import]") instanceof HTMLButtonElement &&
      !document.querySelector("[data-import]").disabled &&
      document.querySelector("[data-page-source]")?.textContent === sourceUrl,
    { timeout: 15_000 },
    expectedSourceUrl,
  );
}

async function waitForChromePageStatus(popup, expected, timeout = 15_000) {
  try {
    await popup.waitForFunction(
      (value) =>
        document.querySelector("[data-page-status]")?.textContent === value,
      { timeout },
      expected,
    );
  } catch (error) {
    const snapshot = await popup
      .evaluate(() => ({
        body: document.body.innerText,
        sourceUrl: document
          .querySelector("[data-page-source]")
          ?.textContent?.trim(),
        status: document
          .querySelector("[data-page-status]")
          ?.textContent?.trim(),
      }))
      .catch((diagnosticError) => String(diagnosticError));
    throw new Error(
      `Chrome popup did not reach ${JSON.stringify(expected)}: ${JSON.stringify(snapshot)}`,
      { cause: error },
    );
  }
}

async function waitForChromeCaptureOutcome(popup, timeout) {
  await popup.waitForFunction(
    () => {
      const status = document
        .querySelector("[data-page-status]")
        ?.textContent?.trim();
      return status === "Imported" || status === "Already in Increader";
    },
    { timeout },
  );
}

async function waitForChromeImportStarted(popup) {
  await popup.waitForFunction(
    () => {
      const status = document
        .querySelector("[data-page-status]")
        ?.textContent?.trim();
      return [
        "Import authorized",
        "Capturing page",
        "Sending to Increader",
        "Imported",
        "Already in Increader",
      ].includes(status);
    },
    { timeout: 15_000 },
  );
}

async function runFirefoxStressWorkflow({ driver, publisherHandle }) {
  console.log("Firefox stress workflow started");

  const tenMiBStart = Date.now();
  const tenMiBRecordIndex = publicProxy.captureRequests().length;
  await firefoxNavigatePublisher(driver, publisherHandle, fixture.tenMiBUrl);
  await openFirefoxPopup(driver);
  await waitForFirefoxImportable(driver, fixture.tenMiBUrl);
  await firefoxPopupClick(driver, "[data-import]");
  await waitForFirefoxImportStarted(driver);
  await waitForFirefoxCaptureOutcome(driver, 30_000);
  const tenMiBRecord = await waitForCaptureRecord(tenMiBRecordIndex);
  assertCaptureSource(tenMiBRecord, fixture.tenMiBUrl);
  const tenMiBElapsed = Date.now() - tenMiBStart;
  if (tenMiBRecord.bodyBytes < 10 * 1024 * 1024) {
    throw new Error(
      `Firefox ten MiB capture was only ${String(tenMiBRecord.bodyBytes)} bytes`,
    );
  }
  if (tenMiBElapsed >= 30_000) {
    throw new Error(
      `Firefox ten MiB / 60-asset capture took ${String(tenMiBElapsed)} ms`,
    );
  }
  console.log("Firefox 10 MiB / 60 assets verified", {
    bodyBytes: tenMiBRecord.bodyBytes,
    elapsedMilliseconds: tenMiBElapsed,
  });

  const delayedRecordIndex = publicProxy.captureRequests().length;
  publicProxy.queueCaptureFault({
    type: "delay-response",
    milliseconds: delayedResponseMilliseconds,
  });
  await firefoxNavigatePublisher(driver, publisherHandle, fixture.delayedUrl);
  await openFirefoxPopup(driver);
  await waitForFirefoxImportable(driver, fixture.delayedUrl);
  await firefoxPopupClick(driver, "[data-import]");
  await firefoxPopupWaitText(
    driver,
    "[data-page-status]",
    "Sending to Increader",
  );
  await dismissFirefoxPopup(driver);
  await delay(1_000);
  await openFirefoxPopup(driver);
  await waitForFirefoxCaptureOutcome(driver, 50_000);
  const delayedRecord = await waitForCaptureRecord(delayedRecordIndex);
  assertCaptureSource(delayedRecord, fixture.delayedUrl);
  const delayedElapsed = Date.now() - delayedRecord.startedAt;
  if (delayedElapsed < delayedResponseMilliseconds) {
    throw new Error(
      `Firefox delayed capture completed after only ${String(delayedElapsed)} ms`,
    );
  }
  console.log("Firefox delayed-response popup survival verified", {
    elapsedMilliseconds: delayedElapsed,
  });
  if (process.env.BROWSER_CAPTURE_STOP_AFTER_DELAY === "1") return;

  const nearLimitRecordIndex = publicProxy.captureRequests().length;
  await firefoxNavigatePublisher(driver, publisherHandle, fixture.nearLimitUrl);
  await openFirefoxPopup(driver);
  await waitForFirefoxImportable(driver, fixture.nearLimitUrl);
  await firefoxPopupClick(driver, "[data-import]");
  await waitForFirefoxImportStarted(driver);
  await waitForFirefoxCaptureOutcome(driver, 120_000);
  const nearLimitRecord = await waitForCaptureRecord(nearLimitRecordIndex);
  assertCaptureSource(nearLimitRecord, fixture.nearLimitUrl);
  if (nearLimitRecord.bodyBytes < 48 * 1024 * 1024) {
    throw new Error(
      `Firefox near-limit request was only ${String(nearLimitRecord.bodyBytes)} bytes`,
    );
  }
  console.log("Firefox near-50 MiB package verified", {
    bodyBytes: nearLimitRecord.bodyBytes,
  });

  const preOversizeRequestCount = publicProxy.captureRequests().length;
  await firefoxNavigatePublisher(
    driver,
    publisherHandle,
    fixture.oneOverHtmlUrl,
  );
  await openFirefoxPopup(driver);
  await waitForFirefoxImportable(driver, fixture.oneOverHtmlUrl, 30_000);
  await firefoxPopupClick(driver, "[data-import]");
  await firefoxPopupWaitText(
    driver,
    "[data-page-status]",
    "Needs attention",
    30_000,
  );
  await delay(500);
  if (publicProxy.captureRequests().length !== preOversizeRequestCount) {
    throw new Error("Firefox oversize document reached the Capture API");
  }
  const oversizeState = await firefoxPopupEvaluate(
    driver,
    `return {
      detail: document.querySelector("[data-page-detail]")?.textContent?.trim(),
      retryHidden: document.querySelector("[data-retry]")?.hidden
    };`,
  );
  if (oversizeState.retryHidden !== true) {
    throw new Error("Firefox oversize deterministic failure offered Retry");
  }
  console.log(
    "Firefox one-over document rejected before durable write",
    oversizeState,
  );

  const droppedRecordIndex = publicProxy.captureRequests().length;
  publicProxy.queueCaptureFault({ type: "drop-response" });
  await firefoxNavigatePublisher(driver, publisherHandle, fixture.ambiguousUrl);
  await openFirefoxPopup(driver);
  await waitForFirefoxImportable(driver, fixture.ambiguousUrl);
  await firefoxPopupClick(driver, "[data-import]");
  await firefoxPopupWaitText(
    driver,
    "[data-page-status]",
    "Sending to Increader",
  );
  const droppedRecord = await waitForCaptureRecord(droppedRecordIndex);
  await dismissFirefoxPopup(driver);
  await delay(121_000);
  await openFirefoxPopup(driver);
  await firefoxPopupWaitText(driver, "[data-page-status]", "Needs attention");
  const retryVisible = await firefoxPopupEvaluate(
    driver,
    `return document.querySelector("[data-retry]")?.hidden === false;`,
  );
  if (retryVisible !== true) {
    throw new Error("Firefox explicit Retry was unavailable after timeout");
  }
  if (publicProxy.captureRequests().length !== droppedRecordIndex + 1) {
    throw new Error("Firefox dropped transfer retried without explicit Retry");
  }
  await firefoxPopupClick(driver, "[data-retry]");
  await firefoxPopupWaitText(
    driver,
    "[data-page-status]",
    "Already in Increader",
    30_000,
  );
  const retriedRecord = await waitForCaptureRecord(droppedRecordIndex + 1);
  assertSameCaptureRequest(droppedRecord, retriedRecord);
  console.log("Firefox explicit byte-identical Retry verified", {
    bodyBytes: retriedRecord.bodyBytes,
    captureId: retriedRecord.captureId,
  });
}

async function firefoxNavigatePublisher(driver, publisherHandle, url) {
  await driver.setContext(firefox.Context.CONTENT);
  await driver.switchTo().window(publisherHandle);
  await driver.get(url);
}

async function waitForFirefoxImportable(
  driver,
  expectedSourceUrl,
  timeout = 15_000,
) {
  await waitFor(
    async () =>
      (await firefoxPopupEvaluate(
        driver,
        `return (
          document.querySelector("[data-import]")?.disabled === false &&
          document.querySelector("[data-page-source]")?.textContent ===
            ${JSON.stringify(expectedSourceUrl)}
        );`,
      )) === true,
    timeout,
  );
}

async function waitForFirefoxCaptureOutcome(driver, timeout) {
  try {
    await waitFor(
      async () =>
        (await firefoxPopupEvaluate(
          driver,
          `return ["Imported", "Already in Increader"].includes(
            document.querySelector("[data-page-status]")?.textContent?.trim()
          );`,
        )) === true,
      timeout,
    );
  } catch (error) {
    const snapshot = await firefoxPopupEvaluate(
      driver,
      `return {
        body: document.body?.innerText,
        sourceUrl:
          document.querySelector("[data-page-source]")?.textContent?.trim(),
        status:
          document.querySelector("[data-page-status]")?.textContent?.trim()
      };`,
    ).catch((diagnosticError) => String(diagnosticError));
    throw new Error(
      `Firefox popup did not reach a Capture Outcome: ${JSON.stringify(snapshot)}`,
      { cause: error },
    );
  }
}

async function waitForFirefoxImportStarted(driver) {
  await waitFor(async () => {
    const status = await firefoxPopupEvaluate(
      driver,
      `return document.querySelector(
        "[data-page-status]"
      )?.textContent?.trim();`,
    );
    return [
      "Import authorized",
      "Capturing page",
      "Sending to Increader",
      "Imported",
      "Already in Increader",
    ].includes(status);
  });
}

async function dismissFirefoxPopup(driver) {
  await driver.setContext(firefox.Context.CHROME);
  await driver.executeScript(`
    const extensionPopup = document.getElementById(
      "customizationui-widget-panel"
    );
    if (extensionPopup?.state === "open") extensionPopup.hidePopup();
  `);
}

async function waitForCaptureRecord(index, timeout = 15_000) {
  return waitFor(() => {
    const record = publicProxy.captureRequests()[index];
    return record?.bodySha256 === undefined ? undefined : record;
  }, timeout);
}

function assertSameCaptureRequest(first, second) {
  if (
    first.captureId === undefined ||
    first.captureId !== second.captureId ||
    first.bodySha256 === undefined ||
    first.bodySha256 !== second.bodySha256 ||
    first.bodyBytes !== second.bodyBytes
  ) {
    throw new Error(
      `Retry changed the Capture Package: ${JSON.stringify({
        first,
        second,
      })}`,
    );
  }
}

function assertCaptureSource(record, expectedSourceUrl) {
  if (record.sourceUrl !== expectedSourceUrl) {
    throw new Error(
      `Capture Package source was ${JSON.stringify(record.sourceUrl)} instead of ${JSON.stringify(expectedSourceUrl)}`,
    );
  }
}

async function firefoxBrowserUrls(driver) {
  await driver.setContext(firefox.Context.CHROME);
  return driver.executeScript(`
    const urls = [];
    for (const win of Services.wm.getEnumerator("navigator:browser")) {
      for (const browser of win.document.querySelectorAll("browser")) {
        if (browser.currentURI?.spec !== undefined) {
          urls.push(browser.currentURI.spec);
        }
      }
    }
    return urls;
  `);
}

async function firefoxBrowserClick(driver, urlPrefix, selector) {
  await driver.setContext(firefox.Context.CHROME);
  const result = await driver.executeAsyncScript(
    `
      const urlPrefix = arguments[0];
      const selector = arguments[1];
      const done = arguments[arguments.length - 1];
      let target;
      for (const win of Services.wm.getEnumerator("navigator:browser")) {
        target = [...win.document.querySelectorAll("browser")].find(
          browser => browser.currentURI?.spec.startsWith(urlPrefix)
        );
        if (target !== undefined) break;
      }
      if (target === undefined) {
        done({ browserCaptureHarnessError: "Firefox browser unavailable" });
        return;
      }
      const actor = target.browsingContext.currentWindowGlobal.getActor(
        "MarionetteCommands"
      );
      const capabilities = {
        toJSON: () => ({
          "moz:accessibilityChecks": false,
          "moz:webdriverClick": true,
          strictFileInteractability: false
        })
      };
      actor.findElement("css selector", selector, {
        timeout: 15_000,
        all: false
      }).then(element => actor.clickElement(element, capabilities)).then(
        () => done({ value: true }),
        error => done({
          browserCaptureHarnessError: String(error?.stack ?? error)
        })
      );
    `,
    urlPrefix,
    selector,
  );
  if (result.browserCaptureHarnessError !== undefined) {
    throw new Error(result.browserCaptureHarnessError);
  }
}

async function openFirefoxPopup(driver) {
  await driver.setContext(firefox.Context.CHROME);
  await driver.executeScript(`
    const extensionPopup = document.getElementById(
      "customizationui-widget-panel"
    );
    if (extensionPopup?.state === "open") extensionPopup.hidePopup();
  `);
  const extensionsButton = await driver.wait(
    until.elementLocated(By.id("unified-extensions-button")),
    15_000,
  );
  await extensionsButton.click();
  const widget = await driver.wait(
    until.elementLocated(By.id("browser-capture_increader_com-BAP")),
    15_000,
  );
  await widget.click();
  await waitFor(async () =>
    firefoxPopupEvaluate(driver, "return document.readyState;").then(
      (readyState) => readyState === "complete",
    ),
  );
}

async function firefoxPopupEvaluate(driver, script) {
  await driver.setContext(firefox.Context.CHROME);
  const result = await driver.executeAsyncScript(
    `
      const source = arguments[0];
      const done = arguments[arguments.length - 1];
      const win = Services.wm.getMostRecentWindow("navigator:browser");
      const popups = [...win.document.querySelectorAll("browser")].filter(
        candidate => candidate.currentURI?.spec.endsWith("/popup.html")
      );
      const popup = popups.find(candidate => {
        const rect = candidate.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }) ?? popups.at(-1);
      if (popup === undefined) {
        done({ browserCaptureHarnessError: "Firefox popup actor unavailable" });
        return;
      }
      const actor = popup.browsingContext.currentWindowGlobal.getActor(
        "MarionetteCommands"
      );
      actor.executeScript(source, [], {
        sandbox: "default",
        newSandbox: true,
        filename: "browser-capture-release",
        line: 0,
        debug: false,
        async: false
      }).then(
        value => done({ value }),
        error => done({
          browserCaptureHarnessError: String(error?.stack ?? error)
        })
      );
    `,
    script,
  );
  if (result.browserCaptureHarnessError !== undefined) {
    throw new Error(result.browserCaptureHarnessError);
  }
  return result.value;
}

async function firefoxPopupClick(driver, selector) {
  await firefoxPopupElementCommand(driver, "click", selector);
}

async function firefoxPopupType(driver, selector, text) {
  await firefoxPopupElementCommand(driver, "type", selector, text);
}

async function firefoxPopupElementCommand(driver, command, selector, text) {
  await driver.setContext(firefox.Context.CHROME);
  const result = await driver.executeAsyncScript(
    `
      const command = arguments[0];
      const selector = arguments[1];
      const text = arguments[2];
      const done = arguments[arguments.length - 1];
      const win = Services.wm.getMostRecentWindow("navigator:browser");
      const popups = [...win.document.querySelectorAll("browser")].filter(
        candidate => candidate.currentURI?.spec.endsWith("/popup.html")
      );
      const popup = popups.find(candidate => {
        const rect = candidate.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }) ?? popups.at(-1);
      if (popup === undefined) {
        done({ browserCaptureHarnessError: "Firefox popup actor unavailable" });
        return;
      }
      const actor = popup.browsingContext.currentWindowGlobal.getActor(
        "MarionetteCommands"
      );
      const capabilities = {
        toJSON: () => ({
          "moz:accessibilityChecks": false,
          "moz:webdriverClick": true,
          strictFileInteractability: false
        })
      };
      actor.findElement("css selector", selector, {
        timeout: 0,
        all: false
      }).then(element => {
        if (command === "click") {
          return actor.clickElement(element, capabilities);
        }
        return actor.sendKeysToElement(element, text, capabilities);
      }).then(
        () => done({ value: true }),
        error => done({
          browserCaptureHarnessError: String(error?.stack ?? error)
        })
      );
    `,
    command,
    selector,
    text,
  );
  if (result.browserCaptureHarnessError !== undefined) {
    throw new Error(result.browserCaptureHarnessError);
  }
}

async function firefoxPopupWaitText(
  driver,
  selector,
  expected,
  timeout = 15_000,
) {
  let actual;
  try {
    await waitFor(async () => {
      actual = await firefoxPopupEvaluate(
        driver,
        `return document.querySelector(${JSON.stringify(
          selector,
        )})?.textContent?.trim();`,
      );
      return actual === expected;
    }, timeout);
  } catch (error) {
    const snapshot = await firefoxPopupEvaluate(
      driver,
      `return Promise.all([
        browser.storage.local.get(null),
        browser.runtime.sendMessage({
          target: "pairing",
          command: "current"
        }).catch(error => ({ error: String(error?.stack ?? error) })),
        browser.runtime.sendMessage({
          target: "pairing",
          command: "operation"
        }).catch(error => ({ error: String(error?.stack ?? error) }))
      ]).then(([storage, current, operation]) => ({
        body: document.body?.innerText,
        current,
        operation,
        storage
      }));`,
    ).catch((diagnosticError) => String(diagnosticError));
    throw new Error(
      `Firefox popup ${selector} stayed ${JSON.stringify(actual)} instead of ${JSON.stringify(expected)}: ${JSON.stringify(snapshot)}`,
      { cause: error },
    );
  }
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
    throw new Error(
      "Firefox unavailable; set FIREFOX_BINARY to the release-test binary",
    );
  }
  return executable;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function firefoxPermissionPattern() {
  const url = new URL(instanceOrigin);
  return `${url.protocol}//${url.hostname}/*`;
}

async function waitFor(read, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await read();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`Condition not met within ${timeout} ms`, {
    cause: lastError,
  });
}

async function fetchTrustedJson(url, caCertificatePath) {
  const ca = await readFile(caCertificatePath);
  const destination = new URL(url);
  return new Promise((resolve, reject) => {
    const request = requestHttps(
      {
        ca,
        headers: {
          Accept: "application/json",
          Host: destination.host,
        },
        hostname: "127.0.0.1",
        method: "GET",
        path: `${destination.pathname}${destination.search}`,
        port: publicProxyPort,
        servername: destination.hostname,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          try {
            resolve({
              body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
              status: response.statusCode ?? 0,
              url,
            });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.on("error", reject);
    request.end();
  });
}

async function extractExactArchive(archive, destinationRoot) {
  const files = unzipSync(new Uint8Array(archive));
  for (const [relativePath, bytes] of Object.entries(files)) {
    const segments = relativePath.split(/[\\/]/u);
    if (
      path.isAbsolute(relativePath) ||
      segments.includes("..") ||
      segments.includes("")
    ) {
      throw new Error(`Unsafe upload ZIP path: ${relativePath}`);
    }
    const destination = path.resolve(destinationRoot, relativePath);
    if (
      !destination.startsWith(`${path.resolve(destinationRoot)}${path.sep}`)
    ) {
      throw new Error(`Upload ZIP escaped extraction root: ${relativePath}`);
    }
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
  }
  const manifest = JSON.parse(
    await readFile(path.join(destinationRoot, "manifest.json"), "utf8"),
  );
  if (manifest.version !== packageJson.version) {
    throw new Error("Exact upload ZIP version does not match package version");
  }
}

async function startFixtureServer() {
  const tenMiBAsset = syntheticPngBytes(Math.floor((10 * 1024 * 1024) / 60));
  const nearLimitAsset = syntheticPngBytes(7 * 1024 * 1024);
  const server = createHttpServer((request, response) => {
    const requestUrl = new URL(
      request.url ?? "/",
      "http://browser-capture-fixture.invalid",
    );
    if (requestUrl.pathname.startsWith("/asset/ten/")) {
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Length": String(tenMiBAsset.byteLength),
        "Content-Type": "image/png",
      });
      response.end(tenMiBAsset);
      return;
    }
    if (requestUrl.pathname.startsWith("/asset/near/")) {
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Length": String(nearLimitAsset.byteLength),
        "Content-Type": "image/png",
      });
      response.end(nearLimitAsset);
      return;
    }
    const article = syntheticArticle(requestUrl.pathname);
    if (article === null) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
    });
    response.end(article);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Synthetic publisher did not bind");
  }
  return {
    articleUrl: `http://127.0.0.1:${String(address.port)}/article`,
    ambiguousUrl: `http://127.0.0.1:${String(address.port)}/ambiguous`,
    delayedUrl: `http://127.0.0.1:${String(address.port)}/delayed`,
    nearLimitUrl: `http://127.0.0.1:${String(address.port)}/near-limit`,
    oneOverHtmlUrl: `http://127.0.0.1:${String(address.port)}/one-over-html`,
    tenMiBUrl: `http://127.0.0.1:${String(address.port)}/ten-mib`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
      }),
  };
}

function syntheticArticle(pathname) {
  const articleStart = `<!doctype html>
    <html lang="en">
      <head><title>Browser Capture Synthetic Article</title></head>
      <body>
        <article>
          <h1>Browser Capture Synthetic Article</h1>
          <p>This exact rendered text must appear in Reader Content.</p>`;
  const articleEnd = `
        </article>
      </body>
    </html>`;
  if (
    pathname === "/article" ||
    pathname === "/ambiguous" ||
    pathname === "/delayed"
  ) {
    return `${articleStart}
      <p>The release harness captures this live page only after explicit
        Import and verifies normal Reader Content.</p>
      ${articleEnd}`;
  }
  if (pathname === "/ten-mib") {
    return `${articleStart}
      ${Array.from(
        { length: 60 },
        (_, index) =>
          `<img src="/asset/ten/${String(index)}.png" alt="Ten MiB image ${String(index)}">`,
      ).join("\n")}
      ${articleEnd}`;
  }
  if (pathname === "/near-limit") {
    return `${articleStart}
      ${Array.from(
        { length: 7 },
        (_, index) =>
          `<img src="/asset/near/${String(index)}.png" alt="Near-limit image ${String(index)}">`,
      ).join("\n")}
      ${articleEnd}`;
  }
  if (pathname === "/one-over-html") {
    return `${articleStart}<p>${"x".repeat(5 * 1024 * 1024 + 1)}</p>${articleEnd}`;
  }
  return null;
}

function syntheticPngBytes(size) {
  const bytes = Buffer.alloc(size, 0x61);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  return bytes;
}

async function startPublicProxy() {
  const certificateDirectory = await mkdtemp(
    path.join(os.tmpdir(), "browser-capture-tls-"),
  );
  const caCertificatePath = path.join(
    certificateDirectory,
    "ca-certificate.pem",
  );
  const caKeyPath = path.join(certificateDirectory, "ca-private-key.pem");
  const certificatePath = path.join(certificateDirectory, "certificate.pem");
  const certificateRequestPath = path.join(
    certificateDirectory,
    "certificate-request.pem",
  );
  const keyPath = path.join(certificateDirectory, "private-key.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-keyout",
      caKeyPath,
      "-out",
      caCertificatePath,
      "-subj",
      "/CN=Increader Browser Capture release harness",
      "-addext",
      "basicConstraints=critical,CA:TRUE",
      "-addext",
      "keyUsage=critical,keyCertSign,cRLSign",
    ],
    { stdio: "ignore" },
  );
  execFileSync(
    "openssl",
    [
      "req",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      keyPath,
      "-out",
      certificateRequestPath,
      "-subj",
      `/CN=${new URL(instanceOrigin).hostname}`,
      "-addext",
      cloud
        ? "subjectAltName=DNS:app.increader.com"
        : "subjectAltName=IP:127.0.0.1",
    ],
    { stdio: "ignore" },
  );
  execFileSync(
    "openssl",
    [
      "x509",
      "-req",
      "-in",
      certificateRequestPath,
      "-CA",
      caCertificatePath,
      "-CAkey",
      caKeyPath,
      "-CAcreateserial",
      "-copy_extensions",
      "copy",
      "-days",
      "1",
      "-out",
      certificatePath,
    ],
    { stdio: "ignore" },
  );
  const publicUrl = new URL(instanceOrigin);
  const upstreamUrl = new URL(internalInstanceOrigin);
  const captureFaults = [];
  const captureRequests = [];
  const server = createHttpsServer(
    {
      cert: await readFile(certificatePath),
      key: await readFile(keyPath),
    },
    (request, response) => {
      const traceBrowserCapture =
        request.url?.startsWith("/api/browser-capture/") === true ||
        request.url?.startsWith("/browser-capture/pairing/approve") === true;
      const captureRequest =
        request.method === "POST" &&
        request.url === "/api/browser-capture/captures";
      const captureRecord = captureRequest
        ? {
            bodyBytes: 0,
            bodySha256: undefined,
            captureId: request.headers["content-type"]?.match(
              /browser-capture-([0-9a-f-]{36})/iu,
            )?.[1],
            fault: captureFaults.shift() ?? { type: "none" },
            sourceUrl: undefined,
            startedAt: Date.now(),
            status: undefined,
          }
        : undefined;
      const bodyHash = captureRequest ? createHash("sha256") : undefined;
      const capturePrefixChunks = [];
      let capturePrefixBytes = 0;
      if (captureRecord !== undefined) {
        captureRequests.push(captureRecord);
        request.on("data", (chunk) => {
          captureRecord.bodyBytes += chunk.length;
          bodyHash.update(chunk);
          if (capturePrefixBytes < 768 * 1024) {
            const remaining = 768 * 1024 - capturePrefixBytes;
            const prefixChunk =
              chunk.length <= remaining ? chunk : chunk.subarray(0, remaining);
            capturePrefixChunks.push(prefixChunk);
            capturePrefixBytes += prefixChunk.length;
          }
        });
        request.once("end", () => {
          captureRecord.bodySha256 = bodyHash.digest("hex");
          const sourceMatch = Buffer.concat(capturePrefixChunks)
            .toString("utf8")
            .match(/"sourceUrl":"([^"]+)"/u);
          if (sourceMatch?.[1] !== undefined) {
            captureRecord.sourceUrl = JSON.parse(`"${sourceMatch[1]}"`);
          }
        });
      }
      if (traceBrowserCapture) {
        console.log("[release-proxy] request", {
          method: request.method,
          origin: request.headers.origin,
          path: new URL(request.url ?? "/", instanceOrigin).pathname,
          userAgent: request.headers["user-agent"],
        });
      }
      const upstream = requestHttp(
        new URL(request.url ?? "/", upstreamUrl),
        {
          headers: {
            ...request.headers,
            forwarded: `for=127.0.0.1;host="${publicUrl.host}";proto=https`,
            host: publicUrl.host,
            "x-forwarded-for": "127.0.0.1",
            "x-forwarded-host": publicUrl.host,
            "x-forwarded-port": publicUrl.port || "443",
            "x-forwarded-proto": "https",
          },
          method: request.method,
        },
        (upstreamResponse) => {
          if (captureRecord !== undefined) {
            captureRecord.status = upstreamResponse.statusCode;
          }
          if (traceBrowserCapture) {
            console.log("[release-proxy] response", {
              accessControlAllowOrigin:
                upstreamResponse.headers["access-control-allow-origin"],
              path: new URL(request.url ?? "/", instanceOrigin).pathname,
              status: upstreamResponse.statusCode,
            });
          }
          if (captureRecord?.fault.type === "drop-response") {
            upstreamResponse.resume();
            return;
          }
          const sendResponse = () => {
            response.writeHead(
              upstreamResponse.statusCode ?? 502,
              upstreamResponse.headers,
            );
            upstreamResponse.pipe(response);
          };
          if (captureRecord?.fault.type === "delay-response") {
            upstreamResponse.pause();
            setTimeout(sendResponse, captureRecord.fault.milliseconds);
          } else {
            sendResponse();
          }
        },
      );
      upstream.on("error", (error) => {
        if (traceBrowserCapture) {
          console.error("[release-proxy] upstream error", {
            message: error.message,
            path: new URL(request.url ?? "/", instanceOrigin).pathname,
          });
        }
        if (response.headersSent) {
          response.destroy(error);
          return;
        }
        response.writeHead(502, {
          "Content-Type": "text/plain; charset=utf-8",
        });
        response.end("Increader release proxy could not reach the web app.");
      });
      request.pipe(upstream);
    },
  );
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(publicProxyPort, "127.0.0.1", resolve);
  });
  return {
    caCertificatePath,
    captureRequests: () => captureRequests.map((record) => ({ ...record })),
    queueCaptureFault: (fault) => captureFaults.push(fault),
    close: async () => {
      const closing = new Promise((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
      });
      server.closeAllConnections();
      await closing;
      await rm(certificateDirectory, { force: true, recursive: true });
    },
  };
}

async function startConnectProxy() {
  const sockets = new Set();
  const server = createHttpServer((_request, response) => {
    response.writeHead(502);
    response.end("CONNECT required");
  });
  server.on("connect", (request, client, head) => {
    if (request.url !== "app.increader.com:443") {
      client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    const upstream = connectTcp(publicProxyPort, "127.0.0.1", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on("error", () => client.destroy());
    client.on("error", () => upstream.destroy());
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Cloud CONNECT proxy did not bind");
  }
  return {
    port: address.port,
    close: async () => {
      const closing = new Promise((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
      });
      for (const socket of sockets) socket.destroy();
      await closing;
    },
  };
}

async function startIncreaderServices(increaderRoot) {
  const runServices = path.join(
    increaderRoot,
    "tests",
    "e2e",
    "support",
    "run-services.cjs",
  );
  await access(runServices);
  const webPort = new URL(internalInstanceOrigin).port;
  const child = spawn(process.execPath, [runServices], {
    cwd: increaderRoot,
    env: {
      ...process.env,
      E2E_API_PORT: process.env.BROWSER_CAPTURE_API_PORT ?? "18289",
      E2E_POSTGRES_CONTAINER:
        process.env.BROWSER_CAPTURE_POSTGRES_CONTAINER ??
        `increader-browser-release-${String(process.pid)}`,
      E2E_POSTGRES_DB: "increader_browser_release",
      E2E_POSTGRES_PORT: process.env.BROWSER_CAPTURE_POSTGRES_PORT ?? "55639",
      E2E_BASE_URL: instanceOrigin,
      E2E_STACK: stack,
      E2E_WEB_PORT: webPort,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("spawn", resolve);
  });
  let output = "";
  const remember = (chunk) => {
    output = `${output}${String(chunk)}`.slice(-32_768);
    if (process.env.BROWSER_CAPTURE_SERVICE_TRACE === "1") {
      process.stderr.write(chunk);
    }
  };
  child.stdout.on("data", remember);
  child.stderr.on("data", remember);

  try {
    await waitFor(async () => {
      if (child.exitCode !== null) {
        throw new Error(`Increader services exited early\n${output}`);
      }
      const response = await fetch(
        `http://127.0.0.1:${
          process.env.BROWSER_CAPTURE_API_PORT ?? "18289"
        }/health`,
      );
      return response.ok;
    }, 120_000);
    await waitFor(async () => {
      const response = await fetch(internalInstanceOrigin);
      return response.ok;
    }, 120_000);
  } catch (error) {
    child.kill("SIGINT");
    throw new Error(`Could not start clean Increader stack\n${output}`, {
      cause: error,
    });
  }

  return {
    output: () => output,
    close: async () => {
      if (child.exitCode !== null) return;
      child.kill("SIGINT");
      const stopped = await Promise.race([
        new Promise((resolve) => child.once("exit", () => resolve(true))),
        delay(10_000).then(() => false),
      ]);
      if (!stopped && child.exitCode === null) {
        child.kill("SIGTERM");
      }
    },
  };
}
