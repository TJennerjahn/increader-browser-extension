import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const lock = JSON.parse(
  await readFile(path.join(repositoryRoot, "package-lock.json"), "utf8"),
);
const allowedTokens = new Set([
  "0BSD",
  "Apache-2.0",
  "BlueOak-1.0.0",
  "BSD",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC-BY-3.0",
  "CC0-1.0",
  "ISC",
  "LGPL-3.0-or-later",
  "MIT",
  "MIT-0",
  "MPL-2.0",
  "Python-2.0",
  "Unlicense",
  "GPL-2.0",
  "GPL-3.0-or-later",
  "Zlib",
]);
const rejected = [];
for (const [location, dependency] of Object.entries(lock.packages)) {
  if (location === "" || dependency.version === undefined) continue;
  const license = dependency.license;
  if (
    typeof license !== "string" ||
    !license
      .replace(/[()]/g, "")
      .split(/\s+(?:AND|OR)\s+/)
      .every((token) => allowedTokens.has(token))
  ) {
    rejected.push(`${location}: ${String(license)}`);
  }
}
if (rejected.length > 0) {
  throw new Error(`Unreviewed dependency licenses:\n${rejected.join("\n")}`);
}
process.stdout.write(
  `dependency license audit passed for ${String(Object.keys(lock.packages).length - 1)} locked packages\n`,
);
