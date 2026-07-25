import { execFileSync } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const version = process.env.npm_package_version;
if (version === undefined) {
  throw new Error("npm_package_version is unavailable");
}
const sourceDirectory = path.join(
  repositoryRoot,
  "dist",
  "production",
  "firefox",
);
const sourceArchive = path.join(
  repositoryRoot,
  "dist",
  "production",
  `increader-browser-extension-${version}-firefox-reviewer-source.zip`,
);
await Promise.all([access(sourceDirectory), access(sourceArchive)]);

const webExt = path.join(repositoryRoot, "node_modules", ".bin", "web-ext");
const help = execFileSync(webExt, ["sign", "--help"], {
  cwd: repositoryRoot,
  encoding: "utf8",
});
for (const option of [
  "--api-key",
  "--api-secret",
  "--artifacts-dir",
  "--channel",
  "--source-dir",
  "--upload-source-code",
]) {
  if (!help.includes(option)) {
    throw new Error(`Pinned web-ext no longer supports ${option}`);
  }
}

process.stdout
  .write(`AMO non-secret boundary verified. External credential step:
WEB_EXT_API_KEY=<AMO JWT issuer> WEB_EXT_API_SECRET=<AMO JWT secret> \\
  npx web-ext sign --channel=unlisted \\
  --source-dir dist/production/firefox \\
  --artifacts-dir dist/signed \\
  --upload-source-code ${path.relative(repositoryRoot, sourceArchive)}
`);
