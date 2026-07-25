import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { TextDecoder } from "node:util";
import { unzipSync } from "fflate";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const outputRoot = path.join(repositoryRoot, "dist", "production");
const packageJson = JSON.parse(
  await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
);
const version = packageJson.version;
const expectedFiles = [
  "background.js",
  "icons/icon-16.png",
  "icons/icon-32.png",
  "icons/icon-48.png",
  "icons/icon-128.png",
  "main.js",
  "manifest.json",
  "notification.svg",
  "popup.css",
  "popup.html",
].sort();
const expectedPermissions = [
  "activeTab",
  "identity",
  "notifications",
  "scripting",
  "storage",
];
const expectedOptionalHosts = [
  "http://127.0.0.1/*",
  "http://[::1]/*",
  "http://localhost/*",
  "https://*/*",
];
const forbiddenRuntimeName =
  /(?:^|\/)(?:tests?|fixtures?|__snapshots__|node_modules)(?:\/|$)|(?:\.map|\.pem|\.p12|\.pfx|\.key|\.env|~)$/i;
const forbiddenSourceName =
  /(?:^|\/)(?:node_modules|dist|coverage|\.git)(?:\/|$)|(?:\.pem|\.p12|\.pfx|\.key|\.env|~)$/i;
const sensitiveContent = new RegExp(
  [
    ["-----", "BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY", "-----"].join(""),
    ["(?:ghp|github_pat)_", "[A-Za-z0-9_]{20,}"].join(""),
    ["(?:sk|rk)_live_", "[A-Za-z0-9]{16,}"].join(""),
  ].join("|"),
);

for (const browser of ["chrome", "firefox"]) {
  const browserRoot = path.join(outputRoot, browser);
  const builtManifest = JSON.parse(
    await readFile(path.join(browserRoot, "manifest.json"), "utf8"),
  );
  const sourceManifest = JSON.parse(
    await readFile(
      path.join(repositoryRoot, "manifests", `${browser}.json`),
      "utf8",
    ),
  );
  if (JSON.stringify(builtManifest) !== JSON.stringify(sourceManifest)) {
    throw new Error(`${browser} production manifest differs from its source`);
  }
  assertNumericVersion(builtManifest.version);
  assertSameSet(
    `${browser} required permissions`,
    builtManifest.permissions,
    expectedPermissions,
  );
  assertSameSet(
    `${browser} optional host permissions`,
    builtManifest.optional_host_permissions,
    expectedOptionalHosts,
  );
  if (
    builtManifest.incognito !== "not_allowed" ||
    builtManifest.content_scripts !== undefined ||
    builtManifest.externally_connectable !== undefined
  ) {
    throw new Error(`${browser} manifest grants unexpected runtime authority`);
  }

  const archivePath = path.join(
    outputRoot,
    `increader-browser-extension-${version}-${browser}-upload.zip`,
  );
  const archive = new Uint8Array(await readFile(archivePath));
  if (archive.byteLength >= 10 * 1024 * 1024) {
    throw new Error(`${browser} runtime archive is not below 10 MiB`);
  }
  const extracted = unzipSync(archive);
  const entries = Object.keys(extracted).sort();
  if (JSON.stringify(entries) !== JSON.stringify(expectedFiles)) {
    throw new Error(
      `${browser} archive contains unexpected files: ${entries.join(", ")}`,
    );
  }
  if (entries.some((name) => forbiddenRuntimeName.test(name))) {
    throw new Error(`${browser} archive contains a forbidden runtime file`);
  }
  for (const name of entries) {
    const built = new Uint8Array(await readFile(path.join(browserRoot, name)));
    if (!bytesEqual(built, extracted[name])) {
      throw new Error(`${browser} upload ZIP differs from unpacked ${name}`);
    }
  }
  const executable = `${new TextDecoder().decode(extracted["background.js"])}\n${new TextDecoder().decode(extracted["main.js"])}`;
  if (sensitiveContent.test(executable)) {
    throw new Error(`${browser} archive contains credential material`);
  }
  if (
    /(?:eval\s*\(|new\s+Function\s*\(|import\s*\(\s*["']https?:|<script[^>]+src=["']https?:)/i.test(
      executable,
    )
  ) {
    throw new Error(`${browser} archive contains remote/dynamic code`);
  }
  process.stdout.write(
    `${browser}: ${archive.length} bytes sha256=${sha256(archive)}\n`,
  );
}

const sourceArchivePath = path.join(
  outputRoot,
  `increader-browser-extension-${version}-firefox-reviewer-source.zip`,
);
const sourceArchive = unzipSync(
  new Uint8Array(await readFile(sourceArchivePath)),
);
const sourceEntries = Object.keys(sourceArchive).sort();
for (const required of [
  "LICENSE",
  "README.md",
  "REVIEWER_SOURCE_BUILD.md",
  "package-lock.json",
  "package.json",
  "release-metadata/provenance.json",
  "release-metadata/sbom.cyclonedx.json",
  "release-metadata/sbom.spdx.json",
  "src/background.ts",
]) {
  if (!sourceEntries.includes(required)) {
    throw new Error(`Reviewer source archive is missing ${required}`);
  }
}
if (sourceEntries.some((name) => forbiddenSourceName.test(name))) {
  throw new Error("Reviewer source archive contains forbidden files");
}
for (const [name, bytes] of Object.entries(sourceArchive)) {
  if (sensitiveContent.test(new TextDecoder().decode(bytes))) {
    throw new Error(`Reviewer source archive contains credential material: ${name}`);
  }
}

const permissionReport = JSON.parse(
  await readFile(
    path.join(outputRoot, "release-metadata", "manifest-permissions.json"),
    "utf8",
  ),
);
assertNumericVersion(permissionReport.artifactVersion);
assertSameSet(
  "permission report required permissions",
  permissionReport.expectedRequired,
  expectedPermissions,
);
assertSameSet(
  "permission report optional hosts",
  permissionReport.expectedOptionalHosts,
  expectedOptionalHosts,
);

const provenance = JSON.parse(
  await readFile(
    path.join(outputRoot, "release-metadata", "provenance.json"),
    "utf8",
  ),
);
assertNumericVersion(provenance.artifactVersion);
if (
  !/^[a-f0-9]{40}$/.test(provenance.sourceCommit) ||
  !/^[a-f0-9]{64}$/.test(provenance.sourceTreeSha256)
) {
  throw new Error("Release provenance is incomplete");
}

const checksumLines = (
  await readFile(path.join(outputRoot, "checksums.sha256"), "utf8")
)
  .trim()
  .split("\n");
for (const line of checksumLines) {
  const match = /^([a-f0-9]{64}) {2}(.+)$/.exec(line);
  if (match === null) throw new Error(`Invalid checksum line: ${line}`);
  const actual = sha256(await readFile(path.join(outputRoot, match[2])));
  if (actual !== match[1]) {
    throw new Error(`Checksum mismatch for ${match[2]}`);
  }
}

for (const [file, width, height] of [
  ["listing/screenshot-1280x800.png", 1280, 800],
  ["listing/chrome-promo-440x280.png", 440, 280],
]) {
  const bytes = await readFile(path.join(outputRoot, file));
  if (
    bytes.readUInt32BE(16) !== width ||
    bytes.readUInt32BE(20) !== height
  ) {
    throw new Error(`${file} has incorrect dimensions`);
  }
}

function assertNumericVersion(value) {
  if (typeof value !== "string" || !/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(value)) {
    throw new Error(`Release version is not numeric: ${String(value)}`);
  }
  if (value !== version) {
    throw new Error(`Release version ${String(value)} differs from ${version}`);
  }
}

function assertSameSet(label, actual, expected) {
  const normalizedActual = [...actual].sort();
  const normalizedExpected = [...expected].sort();
  if (JSON.stringify(normalizedActual) !== JSON.stringify(normalizedExpected)) {
    throw new Error(
      `${label} changed: ${normalizedActual.join(", ")}`,
    );
  }
}

function bytesEqual(left, right) {
  return (
    left.byteLength === right.byteLength &&
    left.every((byte, index) => byte === right[index])
  );
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
