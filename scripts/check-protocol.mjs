import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  rm
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const protocolRoot = path.join(repositoryRoot, "protocol");
const provenance = JSON.parse(
  await readFile(path.join(protocolRoot, "PROVENANCE.json"), "utf8")
);

for (const [relativePath, expectedHash] of Object.entries(provenance.files)) {
  const contents = await readFile(path.join(protocolRoot, relativePath));
  const actualHash = createHash("sha256").update(contents).digest("hex");
  if (actualHash !== expectedHash) {
    throw new Error(
      `${relativePath} differs from the Increader source recorded in PROVENANCE.json`
    );
  }
}

const temporaryRoot = await mkdtemp(
  path.join(os.tmpdir(), "increader-browser-capture-protocol-")
);
try {
  const generated = path.join(temporaryRoot, "browser-capture.ts");
  const executable = path.join(
    repositoryRoot,
    "node_modules",
    ".bin",
    process.platform === "win32"
      ? "openapi-typescript.cmd"
      : "openapi-typescript"
  );
  const result = spawnSync(
    executable,
    [
      path.join(protocolRoot, "browser-capture.openapi.yaml"),
      "-o",
      generated
    ],
    { encoding: "utf8" }
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "Type generation failed");
  }

  const expected = await readFile(
    path.join(
      repositoryRoot,
      "src",
      "protocol",
      "generated",
      "browser-capture.ts"
    ),
    "utf8"
  );
  const actual = await readFile(generated, "utf8");
  if (actual !== expected) {
    throw new Error(
      "Generated Browser Capture types are stale; run npm run protocol:generate"
    );
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
