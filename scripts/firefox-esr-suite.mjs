import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const FIREFOX_VERSION = "140.0esr";
const ARCHIVE_SHA256 =
  "275b6a15b61553469d18cf5ec9d3571e2e82c1e661702a83a695f13b94d80543";
const ARCHIVE_URL =
  `https://archive.mozilla.org/pub/firefox/releases/${FIREFOX_VERSION}` +
  `/linux-x86_64/en-US/firefox-${FIREFOX_VERSION}.tar.xz`;
const repositoryRoot = path.resolve(import.meta.dirname, "..");
const cacheRoot = path.join(
  os.homedir(),
  ".cache",
  "increader-browser-capture",
  `firefox-${FIREFOX_VERSION}`,
);
const archivePath = path.join(cacheRoot, `firefox-${FIREFOX_VERSION}.tar.xz`);
const installRoot = path.join(cacheRoot, "installation");
const firefoxBinary = path.join(installRoot, "firefox", "firefox");

await installFirefoxEsr();
const reportedVersion = execFileSync(firefoxBinary, ["--version"], {
  encoding: "utf8",
}).trim();
if (reportedVersion !== "Mozilla Firefox 140.0esr") {
  throw new Error(`Unexpected Firefox ESR binary: ${reportedVersion}`);
}
process.stdout.write(`${reportedVersion}\n`);
execFileSync(process.execPath, ["scripts/real-browser-suite.mjs"], {
  cwd: repositoryRoot,
  env: {
    ...process.env,
    BROWSER_CAPTURE_ONLY_FIREFOX: "1",
    BROWSER_CAPTURE_STACK: "cloud",
    FIREFOX_BINARY: firefoxBinary,
  },
  stdio: "inherit",
});

async function installFirefoxEsr() {
  if (
    (await fileMatchesHash(firefoxBinary, null)) &&
    (await fileMatchesHash(archivePath, ARCHIVE_SHA256))
  ) {
    return;
  }
  await mkdir(cacheRoot, { recursive: true });
  if (!(await fileMatchesHash(archivePath, ARCHIVE_SHA256))) {
    const response = await globalThis.fetch(ARCHIVE_URL);
    if (!response.ok) {
      throw new Error(
        `Firefox ESR download failed with HTTP ${String(response.status)}`,
      );
    }
    const archive = new Uint8Array(await response.arrayBuffer());
    const actual = sha256(archive);
    if (actual !== ARCHIVE_SHA256) {
      throw new Error(
        `Firefox ESR archive checksum changed: expected ${ARCHIVE_SHA256}, received ${actual}`,
      );
    }
    await writeFile(archivePath, archive);
  }
  await rm(installRoot, { force: true, recursive: true });
  await mkdir(installRoot, { recursive: true });
  execFileSync("tar", ["-xJf", archivePath, "-C", installRoot], {
    stdio: "inherit",
  });
  await access(firefoxBinary);
}

async function fileMatchesHash(file, expected) {
  try {
    await access(file);
    if (expected === null) return true;
    return sha256(await readFile(file)) === expected;
  } catch {
    return false;
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
