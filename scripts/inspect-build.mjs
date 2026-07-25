import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { unzipSync } from "fflate";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const outputRoot = path.join(repositoryRoot, "dist", "production");
const packageJson = JSON.parse(
  await readFile(path.join(repositoryRoot, "package.json"), "utf8")
);
const expectedFiles = [
  "background.js",
  "main.js",
  "manifest.json",
  "notification.svg",
  "popup.css",
  "popup.html"
];

for (const browser of ["chrome", "firefox"]) {
  const browserRoot = path.join(outputRoot, browser);
  const builtManifest = JSON.parse(
    await readFile(path.join(browserRoot, "manifest.json"), "utf8")
  );
  const sourceManifest = JSON.parse(
    await readFile(
      path.join(repositoryRoot, "manifests", `${browser}.json`),
      "utf8"
    )
  );
  if (JSON.stringify(builtManifest) !== JSON.stringify(sourceManifest)) {
    throw new Error(`${browser} production manifest differs from its source`);
  }

  const archivePath = path.join(
    outputRoot,
    `increader-browser-extension-${packageJson.version}-${browser}.zip`
  );
  const archive = new Uint8Array(await readFile(archivePath));
  const entries = Object.keys(unzipSync(archive)).sort();
  if (JSON.stringify(entries) !== JSON.stringify(expectedFiles)) {
    throw new Error(
      `${browser} archive contains unexpected files: ${entries.join(", ")}`
    );
  }
  const digest = createHash("sha256").update(archive).digest("hex");
  process.stdout.write(
    `${browser}: ${archive.length} bytes sha256=${digest}\n`
  );
}
