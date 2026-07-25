import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const sourceDirectory = path.join(
  repositoryRoot,
  "dist",
  "production",
  "firefox",
);
const webExt = path.join(repositoryRoot, "node_modules", ".bin", "web-ext");
const report = JSON.parse(
  execFileSync(
    webExt,
    ["lint", "--source-dir", sourceDirectory, "--output=json", "--no-input"],
    { cwd: repositoryRoot, encoding: "utf8" },
  ),
);
const manifest = JSON.parse(
  await readFile(path.join(sourceDirectory, "manifest.json"), "utf8"),
);
const allowedWarning = "KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION";
const unexpectedWarnings = report.warnings.filter(
  (warning) => warning.code !== allowedWarning,
);
const androidWarnings = report.warnings.filter(
  (warning) => warning.code === allowedWarning,
);
if (
  report.errors.length > 0 ||
  report.notices.length > 0 ||
  unexpectedWarnings.length > 0 ||
  androidWarnings.length !== 1 ||
  manifest.browser_specific_settings?.gecko_android !== undefined
) {
  process.stderr.write(`${JSON.stringify(report, null, 2)}\n`);
  throw new Error("Firefox package has actionable web-ext lint findings");
}

process.stdout.write(
  "web-ext lint passed with one explained desktop-only false positive: " +
    `${allowedWarning}. gecko_android is intentionally omitted so AMO does ` +
    "not make Browser Capture available on Android.\n",
);
