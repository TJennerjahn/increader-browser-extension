import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { build } from "esbuild";
import { zipSync } from "fflate";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const modeArgument = process.argv.indexOf("--mode");
const mode =
  modeArgument >= 0 ? process.argv[modeArgument + 1] : "production";
if (mode !== "production" && mode !== "development") {
  throw new Error(`Unsupported build mode: ${mode}`);
}

const outputRoot = path.join(repositoryRoot, "dist", mode);
const packageJson = JSON.parse(
  await readFile(path.join(repositoryRoot, "package.json"), "utf8")
);
const browsers = ["chrome", "firefox"];

await rm(outputRoot, { recursive: true, force: true });
await Promise.all(browsers.map(buildBrowser));

async function buildBrowser(browser) {
  const browserRoot = path.join(outputRoot, browser);
  await mkdir(browserRoot, { recursive: true });
  await build({
    entryPoints: {
      background: path.join(repositoryRoot, "src", "background.ts"),
      main: path.join(repositoryRoot, "src", "popup", "main.ts")
    },
    bundle: true,
    entryNames: "[name]",
    format: "iife",
    minify: mode === "production",
    outdir: browserRoot,
    platform: "browser",
    sourcemap: mode === "development",
    target: browser === "chrome" ? "chrome140" : "firefox140"
  });
  await cp(
    path.join(repositoryRoot, "src", "popup", "popup.html"),
    path.join(browserRoot, "popup.html")
  );
  await cp(
    path.join(repositoryRoot, "src", "popup", "popup.css"),
    path.join(browserRoot, "popup.css")
  );
  await cp(
    path.join(repositoryRoot, "src", "assets", "notification.svg"),
    path.join(browserRoot, "notification.svg")
  );

  const manifest = JSON.parse(
    await readFile(
      path.join(repositoryRoot, "manifests", `${browser}.json`),
      "utf8"
    )
  );
  manifest.version = packageJson.version;
  if (mode === "development") {
    manifest.name += " (Development)";
  }
  await writeFile(
    path.join(browserRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`
  );

  if (mode === "production") {
    const archiveName =
      `increader-browser-extension-${packageJson.version}-${browser}.zip`;
    await writeFile(
      path.join(outputRoot, archiveName),
      zipSync(await archiveEntries(browserRoot), { level: 9 })
    );
  }
}

async function archiveEntries(root, relative = "") {
  const entries = {};
  const children = await readdir(path.join(root, relative), {
    withFileTypes: true
  });
  for (const child of children.sort((left, right) =>
    left.name.localeCompare(right.name)
  )) {
    const childRelative = path.join(relative, child.name);
    if (child.isDirectory()) {
      Object.assign(entries, await archiveEntries(root, childRelative));
    } else {
      entries[childRelative.replaceAll(path.sep, "/")] = [
        new Uint8Array(await readFile(path.join(root, childRelative))),
        { mtime: new Date("1980-01-01T00:00:00.000Z") }
      ];
    }
  }
  return entries;
}
