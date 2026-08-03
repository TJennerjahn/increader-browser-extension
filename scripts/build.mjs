import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { TextEncoder } from "node:util";
import { build } from "esbuild";
import { zipSync } from "fflate";
import sharp from "sharp";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const modeArgument = process.argv.indexOf("--mode");
const mode = modeArgument >= 0 ? process.argv[modeArgument + 1] : "production";
if (mode !== "production" && mode !== "development") {
  throw new Error(`Unsupported build mode: ${mode}`);
}

const outputRoot = path.join(repositoryRoot, "dist", mode);
const packageJson = JSON.parse(
  await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
);
const packageLock = JSON.parse(
  await readFile(path.join(repositoryRoot, "package-lock.json"), "utf8"),
);
const version = packageJson.version;
const browsers = ["chrome", "firefox"];

await rm(outputRoot, { recursive: true, force: true });
await Promise.all(browsers.map(buildBrowser));
if (mode === "production") {
  await buildReleaseBundle();
}

async function buildBrowser(browser) {
  const browserRoot = path.join(outputRoot, browser);
  await mkdir(path.join(browserRoot, "icons"), { recursive: true });
  await build({
    entryPoints: {
      background: path.join(repositoryRoot, "src", "background.ts"),
      main: path.join(repositoryRoot, "src", "popup", "main.ts"),
    },
    bundle: true,
    entryNames: "[name]",
    format: "iife",
    legalComments: "none",
    minify: mode === "production",
    outdir: browserRoot,
    platform: "browser",
    sourcemap: mode === "development",
    target: browser === "chrome" ? "chrome140" : "firefox140",
  });
  await Promise.all(
    ["popup.html", "popup.css"].map((name) =>
      cp(
        path.join(repositoryRoot, "src", "popup", name),
        path.join(browserRoot, name),
      ),
    ),
  );
  await cp(
    path.join(repositoryRoot, "src", "assets", "notification.svg"),
    path.join(browserRoot, "notification.svg"),
  );
  await Promise.all(
    [16, 32, 48, 128].map((size) =>
      sharp(
        path.join(repositoryRoot, "release", "assets", "increader-mark.svg"),
      )
        .resize(size, size)
        .png({ adaptiveFiltering: false, compressionLevel: 9, palette: true })
        .toFile(path.join(browserRoot, "icons", `icon-${size}.png`)),
    ),
  );

  const manifest = JSON.parse(
    await readFile(
      path.join(repositoryRoot, "manifests", `${browser}.json`),
      "utf8",
    ),
  );
  manifest.version = version;
  if (mode === "development") {
    manifest.name += " (Development)";
  }
  await writeFile(
    path.join(browserRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  if (mode === "production") {
    await writeZip(
      path.join(
        outputRoot,
        `increader-browser-extension-${version}-${browser}-upload.zip`,
      ),
      await archiveEntries(browserRoot),
    );
  }
}

async function buildReleaseBundle() {
  const metadataRoot = path.join(outputRoot, "release-metadata");
  const listingRoot = path.join(outputRoot, "listing");
  await mkdir(metadataRoot, { recursive: true });
  await mkdir(listingRoot, { recursive: true });
  await Promise.all([
    cp(
      path.join(repositoryRoot, "release", "assets", "listing-screenshot.png"),
      path.join(listingRoot, "screenshot-1280x800.png"),
    ),
    cp(
      path.join(repositoryRoot, "release", "assets", "chrome-promo.png"),
      path.join(listingRoot, "chrome-promo-440x280.png"),
    ),
  ]);

  const reviewerEntries = await reviewerSourceEntries();
  const sourceTreeSha256 = hashEntries(reviewerEntries);
  const sourceCommit = git(["rev-parse", "HEAD"]).trim();
  const sourceCommitEpoch = Number(
    git(["show", "-s", "--format=%ct", sourceCommit]).trim(),
  );
  const provenance = {
    artifactVersion: version,
    sourceCommit,
    sourceTreeSha256,
    build: {
      node: process.versions.node,
      npm: execFileSync("npm", ["--version"], { encoding: "utf8" }).trim(),
      archiveEntryMtime: "1980-01-01T00:00:00.000Z",
      sourceDateEpoch: sourceCommitEpoch,
      command: "npm ci && npm run release:verify",
    },
    signingBoundary: {
      chrome: "Chrome Web Store signing and submission are external.",
      firefox: "AMO unlisted signing and submission are external.",
    },
  };
  await writeJson(path.join(metadataRoot, "provenance.json"), provenance);

  const permissionReport = await buildPermissionReport();
  await writeJson(
    path.join(metadataRoot, "manifest-permissions.json"),
    permissionReport,
  );

  const spdx = normalizedSbom("spdx", sourceCommitEpoch, sourceTreeSha256);
  const cyclonedx = normalizedSbom(
    "cyclonedx",
    sourceCommitEpoch,
    sourceTreeSha256,
  );
  await writeJson(path.join(metadataRoot, "sbom.spdx.json"), spdx);
  await writeJson(path.join(metadataRoot, "sbom.cyclonedx.json"), cyclonedx);
  await writeFile(
    path.join(metadataRoot, "THIRD_PARTY_NOTICES.md"),
    thirdPartyNotices(),
  );

  const sourceBuild = `# Firefox reviewer source

Artifact version: ${version}

This ZIP is generated from commit \`${sourceCommit}\`. It contains no generated
runtime bundle or dependency directory.

\`\`\`sh
npm ci
npm run verify
\`\`\`

The upload ZIP built by that command is
\`dist/production/increader-browser-extension-${version}-firefox-upload.zip\`.
The source and upload artifacts share the commit and normalized source-tree hash
recorded in \`release-metadata/provenance.json\`.
`;
  const sourceArchiveEntries = {
    ...reviewerEntries,
    "REVIEWER_SOURCE_BUILD.md": stringEntry(sourceBuild),
  };
  for (const name of await recursiveFiles(metadataRoot)) {
    sourceArchiveEntries[`release-metadata/${name.replaceAll(path.sep, "/")}`] =
      fileEntry(path.join(metadataRoot, name));
  }
  await resolveEntryPromises(sourceArchiveEntries);
  await writeZip(
    path.join(
      outputRoot,
      `increader-browser-extension-${version}-firefox-reviewer-source.zip`,
    ),
    sourceArchiveEntries,
  );

  const checksumTargets = [
    `increader-browser-extension-${version}-chrome-upload.zip`,
    `increader-browser-extension-${version}-firefox-upload.zip`,
    `increader-browser-extension-${version}-firefox-reviewer-source.zip`,
    "release-metadata/manifest-permissions.json",
    "release-metadata/provenance.json",
    "release-metadata/sbom.cyclonedx.json",
    "release-metadata/sbom.spdx.json",
    "release-metadata/THIRD_PARTY_NOTICES.md",
    "listing/chrome-promo-440x280.png",
    "listing/screenshot-1280x800.png",
  ];
  const checksumLines = [];
  for (const relative of checksumTargets) {
    const bytes = await readFile(path.join(outputRoot, relative));
    checksumLines.push(`${sha256(bytes)}  ${relative}`);
  }
  await writeFile(
    path.join(outputRoot, "checksums.sha256"),
    `${checksumLines.join("\n")}\n`,
  );
}

async function buildPermissionReport() {
  const reports = {};
  for (const browser of browsers) {
    const manifest = JSON.parse(
      await readFile(path.join(outputRoot, browser, "manifest.json"), "utf8"),
    );
    reports[browser] = {
      required: [...manifest.permissions].sort(),
      requiredHosts: [...manifest.host_permissions].sort(),
      optionalHosts: [...manifest.optional_host_permissions].sort(),
      incognito: manifest.incognito,
      contentScripts: manifest.content_scripts ?? [],
      externallyConnectable: manifest.externally_connectable ?? null,
      dataCollection:
        manifest.browser_specific_settings?.gecko
          ?.data_collection_permissions ?? null,
    };
  }
  return {
    artifactVersion: version,
    expectedRequired: [
      "activeTab",
      "cookies",
      "declarativeNetRequestWithHostAccess",
      "identity",
      "notifications",
      "scripting",
      "storage",
    ],
    expectedRequiredHosts: [
      "https://app.increader.com/*",
      "https://clerk.increader.com/*",
    ],
    expectedOptionalHosts: [
      "http://127.0.0.1/*",
      "http://[::1]/*",
      "http://localhost/*",
      "https://*/*",
    ],
    manifests: reports,
  };
}

function normalizedSbom(format, sourceCommitEpoch, sourceTreeSha256) {
  const raw = execFileSync("npm", ["sbom", "--sbom-format", format], {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  const value = JSON.parse(raw);
  const timestamp = new Date(sourceCommitEpoch * 1_000).toISOString();
  if (format === "spdx") {
    value.creationInfo.created = timestamp;
    value.documentNamespace = `https://increader.com/sbom/${version}/${sourceTreeSha256}`;
  } else {
    value.metadata.timestamp = timestamp;
    value.serialNumber = `urn:uuid:${sourceTreeSha256.slice(0, 8)}-${sourceTreeSha256.slice(8, 12)}-4${sourceTreeSha256.slice(13, 16)}-a${sourceTreeSha256.slice(17, 20)}-${sourceTreeSha256.slice(20, 32)}`;
  }
  return value;
}

function thirdPartyNotices() {
  const dependencies = Object.entries(packageLock.packages)
    .filter(([location, value]) => location !== "" && value.version)
    .map(([location, value]) => {
      const marker = "node_modules/";
      const name = location.slice(location.lastIndexOf(marker) + marker.length);
      return {
        license: value.license ?? "SEE PACKAGE",
        name,
        version: value.version,
      };
    })
    .sort((left, right) =>
      `${left.name}@${left.version}`.localeCompare(
        `${right.name}@${right.version}`,
      ),
    );
  return `# Third-party notices

The Browser Extension runtime is bundled from this repository and contains no
remote executable code. The following build and bundled dependency inventory
is derived from the exact npm lockfile. Complete machine-readable relationships
and declared licenses are in the SPDX and CycloneDX files beside this notice.

| Package | Version | Declared license |
| --- | --- | --- |
${dependencies.map(({ license, name, version: dependencyVersion }) => `| \`${name}\` | \`${dependencyVersion}\` | ${license} |`).join("\n")}
`;
}

async function reviewerSourceEntries() {
  const entries = {};
  const roots = [
    ".github",
    "docs",
    "manifests",
    "protocol",
    "release",
    "scripts",
    "src",
  ];
  for (const root of roots) {
    for (const name of await recursiveFiles(path.join(repositoryRoot, root))) {
      if (name.includes(`${path.sep}evidence${path.sep}generated`)) continue;
      const relative = path.join(root, name).replaceAll(path.sep, "/");
      entries[relative] = await fileEntry(path.join(repositoryRoot, relative));
    }
  }
  for (const name of [
    "CHANGELOG.md",
    "CONTRIBUTING.md",
    "LICENSE",
    "README.md",
    "SECURITY.md",
    "SUPPORT.md",
    "eslint.config.js",
    "package-lock.json",
    "package.json",
    "tsconfig.json",
    "vitest.config.ts",
  ]) {
    try {
      entries[name] = await fileEntry(path.join(repositoryRoot, name));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return entries;
}

async function archiveEntries(root, relative = "") {
  const entries = {};
  const children = await readdir(path.join(root, relative), {
    withFileTypes: true,
  });
  for (const child of children.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const childRelative = path.join(relative, child.name);
    if (child.isDirectory()) {
      Object.assign(entries, await archiveEntries(root, childRelative));
    } else {
      entries[childRelative.replaceAll(path.sep, "/")] = await fileEntry(
        path.join(root, childRelative),
      );
    }
  }
  return entries;
}

async function recursiveFiles(root, relative = "") {
  const result = [];
  for (const child of (
    await readdir(path.join(root, relative), { withFileTypes: true })
  ).sort((left, right) => left.name.localeCompare(right.name))) {
    const childRelative = path.join(relative, child.name);
    if (child.isDirectory()) {
      result.push(...(await recursiveFiles(root, childRelative)));
    } else {
      result.push(childRelative);
    }
  }
  return result;
}

async function fileEntry(file) {
  return [
    new Uint8Array(await readFile(file)),
    { mtime: new Date("1980-01-01T00:00:00.000Z") },
  ];
}

function stringEntry(value) {
  return [
    new TextEncoder().encode(value),
    { mtime: new Date("1980-01-01T00:00:00.000Z") },
  ];
}

async function resolveEntryPromises(entries) {
  for (const [name, value] of Object.entries(entries)) {
    entries[name] = await value;
  }
}

async function writeZip(file, entries) {
  await writeFile(file, zipSync(entries, { level: 9 }));
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function hashEntries(entries) {
  const hash = createHash("sha256");
  for (const [name, [bytes]] of Object.entries(entries).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    hash.update(name);
    hash.update("\0");
    hash.update(bytes);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function git(args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
}
