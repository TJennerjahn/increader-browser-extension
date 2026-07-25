import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  type BrowserCaptureDiscovery,
  parseDiscovery
} from "./discovery";

const futureCapability: BrowserCaptureDiscovery["capabilities"][number] =
  "future-capture-hint";

function fixture(name: string): unknown {
  const url = new URL(`../../protocol/fixtures/${name}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as unknown;
}

describe("Browser Capture Discovery", () => {
  it("accepts the canonical compatible instance fixture", () => {
    const discovery = parseDiscovery(fixture("discovery.valid.json"));

    expect(discovery.protocol).toBe("increader-browser-capture");
    expect(discovery.displayName).toBe("Increader");
    expect(discovery.pairingAvailable).toBe(true);
    expect(discovery.capabilities).toEqual([
      "pairing",
      "bookmark-lookup",
      "capture-package",
      futureCapability
    ]);
    expect(discovery.limits.multipartRequestBytes).toBe(67_108_864);
  });

  it("rejects the canonical incompatible instance fixture with a safe error", () => {
    expect(() => parseDiscovery(fixture("discovery.invalid.json"))).toThrow(
      "This destination does not support Increader Browser Capture."
    );
  });

  it("tolerates unknown additive fields and capability names", () => {
    const compatible = fixture("discovery.valid.json") as Record<string, unknown>;

    const discovery = parseDiscovery({
      ...compatible,
      futureServerHint: "ignored"
    });

    expect(discovery.protocol).toBe("increader-browser-capture");
    expect(discovery.capabilities).toContain("future-capture-hint");
  });
});
