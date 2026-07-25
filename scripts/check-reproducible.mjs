import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const checksumFile = path.join(
  repositoryRoot,
  "dist",
  "production",
  "checksums.sha256",
);

runBuild();
const first = await readFile(checksumFile, "utf8");
runBuild();
const second = await readFile(checksumFile, "utf8");
if (first !== second) {
  throw new Error("Two clean release builds produced different checksums");
}
process.stdout.write("release artifacts reproduced byte-for-byte\n");

function runBuild() {
  execFileSync(process.execPath, ["scripts/build.mjs", "--mode", "production"], {
    cwd: repositoryRoot,
    stdio: "inherit",
  });
}
