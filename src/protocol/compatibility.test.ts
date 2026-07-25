import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createBookmarkLookupHttpClient } from "./bookmark-lookup-http";
import { createCapturePackageHttpClient } from "./capture-package-http";
import { parseDiscovery } from "./discovery";
import { createPairingHttpClient } from "./pairing-http";

describe.each(["Chrome", "Firefox"])("%s additive compatibility", () => {
  it("accepts every oldest-supported server response fixture", async () => {
    const fixture = JSON.parse(
      await readFile(
        path.resolve(
          "protocol/compatibility/oldest-supported-server.json",
        ),
        "utf8",
      ),
    ) as Record<string, unknown>;
    expect(parseDiscovery(fixture.discovery)).toMatchObject({
      protocol: "increader-browser-capture",
    });

    const pairing = createPairingHttpClient(() =>
      Promise.resolve(Response.json(fixture.pairingCredentials)),
    );
    await expect(
      pairing.renew("https://app.increader.com", {
        installationId: "019c0000-0000-7000-8000-000000000088",
        instanceOrigin: "https://app.increader.com",
        renewalCredential: "fixture",
      }),
    ).resolves.toMatchObject({ tokenType: "Bearer" });

    for (const key of ["lookupMissing", "lookupExisting"]) {
      const lookup = createBookmarkLookupHttpClient(() =>
        Promise.resolve(Response.json(fixture[key])),
      );
      await expect(
        lookup.lookup(
          "https://app.increader.com",
          "access",
          "https://example.test/page",
        ),
      ).resolves.toEqual(fixture[key]);
    }

    for (const [key, status, created] of [
      ["captureCreated", 201, true],
      ["captureExisting", 200, false],
    ] as const) {
      const capture = createCapturePackageHttpClient(() =>
        Promise.resolve(Response.json(fixture[key], { status })),
      );
      await expect(
        capture.transfer(
          "https://app.increader.com",
          "access",
          minimalPackage(),
        ),
      ).resolves.toMatchObject({ created });
    }
  });
});

function minimalPackage() {
  return {
    manifest: {
      captureId: "019c0000-0000-7000-8000-000000000088",
      capturedAt: "2026-07-25T00:00:00.000Z",
      sourceUrl: "https://example.test/page",
      baseUrl: "https://example.test/page",
      document: { bytes: 41, sha256: "0".repeat(64) },
      producer: { browser: "Chrome", extensionVersion: "0.1.0" },
      assets: [],
    },
    documentHtml: "<!doctype html><html><body></body></html>",
    assetParts: [],
  };
}
