/* eslint-disable no-undef -- Browser globals execute inside WebDriver. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { build } from "esbuild";
import { download } from "geckodriver";
import { zipSync } from "fflate";
import { Builder } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";

const root = path.resolve(import.meta.dirname, "..");
const reportDirectory = path.join(root, "dist", "qualification");
const temporary = await mkdtemp(path.join(tmpdir(), "increader-capture-"));
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9QAAAABJRU5ErkJggg==", "base64");
const apiOrigin = process.env.CAPTURE_API_ORIGIN;
if (apiOrigin && !/^http:\/\/(127\.0\.0\.1|localhost):[0-9]+$/.test(apiOrigin)) throw new Error("Qualification API must be a loopback origin");
const apiToken = apiOrigin ? (await readFile(process.env.CAPTURE_API_TOKEN_FILE, "utf8")).trim() : undefined;
const chatFixture = process.env.CAPTURE_CHATGPT_FIXTURE ? await readFile(process.env.CAPTURE_CHATGPT_FIXTURE, "utf8") : undefined;
const reports = [];
const transfers = [];
const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname === "/api/browser-capture/captures") {
    const parts = [];
    for await (const chunk of request) parts.push(chunk);
    const body = Buffer.concat(parts).toString();
    const manifest = JSON.parse(body.match(/Content-Type: application\/json\r\n\r\n([^\r]*)\r\n/)[1]);
    const documentHtml = body.match(/Content-Type: text\/html;charset=utf-8\r\n\r\n([\s\S]*?)\r\n------increader-browser-capture/)[1];
    if (!/^<!doctype html/i.test(documentHtml)) {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ code: "capture_package_invalid" }));
      return;
    }
    transfers.push(manifest);
    if (manifest.sourceUrl.endsWith("/retry-options") && transfers.filter((item) => item.captureId === manifest.captureId).length === 1) {
      request.socket.destroy();
      return;
    }
    if (manifest.sourceUrl.endsWith("/reconnect-options") && transfers.filter((item) => item.captureId === manifest.captureId).length === 1) {
      response.writeHead(401, { "Content-Type": "application/json" });
      response.end("{}");
      return;
    }
    if (manifest.sourceUrl.endsWith("/reconnect-options")) assert.equal(request.headers.authorization, "Bearer synthetic-qualification-token-2");
    if (manifest.sourceUrl.endsWith("/background-lifetime")) await new Promise((resolve) => setTimeout(resolve, 32_000));
    response.writeHead(201, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ id: transfers.length, title: manifest.title || "Imported article" }));
    return;
  }
  if (url.pathname === "/stall.png") {
    response.writeHead(200, { "Content-Type": "image/png" });
    response.write(png.subarray(0, 8));
    return;
  }
  if (url.pathname === "/image.png") {
    response.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "max-age=3600" });
    response.end(png);
    return;
  }
  if (url.pathname.startsWith("/c/")) {
    if (!chatFixture) throw new Error("CAPTURE_CHATGPT_FIXTURE is required for the ChatGPT scenario");
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(chatFixture);
    return;
  }
  const scenario = url.pathname.slice(1);
  const title = scenario === "untitled" ? "" : scenario === "long-title" ? "T".repeat(1400) : "A synthetic article";
  const lang = scenario === "invalid-language" ? "en_US" : "en";
  const image = scenario === "alt-attribute" ? `<img src="/image.png" alt="Example src='photo.jpg'">` : scenario === "fragment-image" ? '<img src="/image.png#figure">' : scenario === "slow-images" ? Array.from({ length: 8 }, (_, index) => `<img src="/stall.png?id=${index}" loading="lazy">`).join("") : "";
  const comment = scenario === "raw-text" ? "<xmp>a < b; don't worry</xmp>" : scenario === "comment" ? "<!-- Publisher's footer -->" : "";
  const pageScript = scenario === "overridden-page-api" ? '<script>window.XMLSerializer = class { serializeToString() { throw new Error("publisher instrumentation failure"); } };</script>' : "";
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(`${scenario === "missing-doctype" ? "" : "<!doctype html>"}<html lang="${lang}"><head><title>${title}</title></head><body>${pageScript}<article><h1>A synthetic article</h1><p>Complete visible article content survives optional publisher metadata and image failures.</p>${image}</article>${comment}</body></html>`);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let driver;
try {
  const entry = await build({ entryPoints: [path.join(root, "release/browser/capture-qualification.ts")], bundle: true, format: "iife", target: "firefox140", write: false });
  const background = await build({ entryPoints: [path.join(root, "release/browser/capture-background-qualification.ts")], bundle: true, format: "iife", target: "firefox140", write: false });
  const uuid = randomUUID();
  const addonId = "capture-qualification@increader.com";
  const manifest = { manifest_version: 3, name: "Capture qualification", version: "1.0", action: {}, background: { scripts: ["background.js"] }, permissions: ["scripting", "storage", "tabs"], host_permissions: ["http://127.0.0.1/*", "http://localhost/*", "http://chatgpt.com/*"], browser_specific_settings: { gecko: { id: addonId } } };
  const archive = path.join(temporary, "qualification.xpi");
  await writeFile(archive, zipSync({ "manifest.json": Buffer.from(JSON.stringify(manifest)), "qualification.html": Buffer.from('<!doctype html><title>Capture qualification</title><script src="qualification.js"></script>'), "qualification.js": entry.outputFiles[0].contents, "background.js": background.outputFiles[0].contents }));
  const options = new firefox.Options().addArguments("-headless").setPreference("extensions.webextensions.uuids", JSON.stringify({ [addonId]: uuid })).setPreference("browser.shell.checkDefaultBrowser", false).setPreference("network.dns.localDomains", "chatgpt.com");
  if (process.env.FIREFOX_BINARY) options.setBinary(process.env.FIREFOX_BINARY);
  driver = await new Builder().forBrowser("firefox").setFirefoxOptions(options).setFirefoxService(new firefox.ServiceBuilder(await download("0.36.0")).addArguments("--allow-system-access")).build();
  await driver.manage().setTimeouts({ script: 110_000, pageLoad: 15_000 });
  await driver.installAddon(archive, true);
  await driver.get(`moz-extension://${uuid}/qualification.html`);
  let harness = await driver.getWindowHandle();
  await driver.switchTo().newWindow("tab");
  const source = await driver.getWindowHandle();
  const scenarios = process.env.CAPTURE_SCENARIOS?.split(",") ?? ["ordinary", "missing-doctype", "invalid-language", "long-title", "untitled", "fragment-image", "alt-attribute", "comment", "raw-text", "overridden-page-api", "slow-images", "custom-options", "retry-options", "reconnect-options"];
  for (const scenario of scenarios) {
    await driver.switchTo().window(source);
    const sourceUrl = scenario === "chatgpt" ? `${origin.replace("127.0.0.1", "chatgpt.com")}/c/qualification-chat` : `${origin}/${scenario}`;
    await driver.get(sourceUrl);
    await driver.switchTo().window(harness);
    let result;
    try {
      if (scenario === "background-lifetime") {
        const started = Date.now();
        await driver.executeAsyncScript(function (sourceUrl, origin, done) {
          globalThis.startBackgroundCapture(sourceUrl, origin).then(done, (error) => done({ error: String(error) }));
        }, sourceUrl, origin);
        await driver.close();
        await driver.switchTo().window(source);
        await new Promise((resolve) => setTimeout(resolve, 36_000));
        await driver.switchTo().newWindow("tab");
        harness = await driver.getWindowHandle();
        await driver.get(`moz-extension://${uuid}/qualification.html`);
        const state = await driver.executeAsyncScript(function (done) {
          globalThis.readBackgroundCapture().then(done, (error) => done({ error: String(error) }));
        });
        result = { state, milliseconds: Date.now() - started };
      } else result = await driver.executeAsyncScript(function (sourceUrl, origin, token, done) {
        globalThis.qualifyCapture(sourceUrl, origin, token).then(done, (error) => done({ error: String(error) }));
      }, sourceUrl, scenario === "chatgpt" ? (apiOrigin ?? origin) : origin, scenario === "chatgpt" ? apiToken : undefined);
      assert.equal(result.state?.phase, "completed");
      if (scenario === "custom-options" || scenario === "retry-options" || scenario === "reconnect-options") {
        const attempts = transfers.filter((manifest) => manifest.sourceUrl === sourceUrl);
        assert.equal(attempts[0].titleOverride, "Firefox custom title 🌊");
        assert.equal(attempts[0].addToQueue, false);
        if (scenario === "retry-options" || scenario === "reconnect-options") {
          assert.equal(attempts.length, 2);
          assert.deepEqual(attempts[1], attempts[0], "Retry must retain immutable import choices");
        }
      }
      if (scenario === "slow-images") assert.ok(result.milliseconds < 7_000, `Optional image reads delayed import by ${result.milliseconds}ms`);
      reports.push({ scenario, passed: true, ...result });
    } catch (error) {
      reports.push({ scenario, passed: false, ...result, assertion: error.message });
    }
    process.stdout.write(`${scenario}: ${reports.at(-1).passed ? "PASS" : "FAIL"} ${result?.milliseconds ?? "?"}ms${reports.at(-1).assertion ? ` ${reports.at(-1).assertion}` : ""}\n`);
  }
  await mkdir(reportDirectory, { recursive: true });
  const capabilities = await driver.getCapabilities();
  const artifact = {
    browser: capabilities.get("browserName"),
    version: capabilities.get("browserVersion"),
    scenarios: reports,
    limitations: apiOrigin
      ? "Real Firefox DOM, scripting, IndexedDB, multipart HTTP and real loopback Increader API using a disposable account; ChatGPT fixture served locally through a DNS alias. Does not authenticate against live ChatGPT."
      : "Real Firefox DOM, scripting, IndexedDB and multipart HTTP; synthetic loopback server stands in for authentication and Increader import. The background-lifetime scenario closes the extension utility during a 32-second transfer. Extra synthetic host grants exist only in the temporary test extension; production permissions are unchanged.",
  };
  await writeFile(path.join(reportDirectory, apiOrigin ? "firefox-capture-backend.json" : scenarios.length === 1 && scenarios[0] === "background-lifetime" ? "firefox-background-lifetime.json" : "firefox-capture.json"), JSON.stringify(artifact, null, 2) + "\n");
  assert.ok(reports.every((report) => report.passed), "Capture qualification failed; see dist/qualification/firefox-capture.json");
} finally {
  await driver?.quit();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
