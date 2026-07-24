import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const requiredPermissions = [
  "activeTab",
  "scripting",
  "storage",
  "identity",
  "notifications"
];
const optionalOrigins = [
  "https://*/*",
  "http://localhost/*",
  "http://127.0.0.1/*",
  "http://[::1]/*"
];

function manifest(browser: "chrome" | "firefox"): Record<string, unknown> {
  const url = new URL(`../../manifests/${browser}.json`, import.meta.url);
  return JSON.parse(
    readFileSync(fileURLToPath(url), "utf8")
  ) as Record<string, unknown>;
}

describe("production manifests", () => {
  it("keeps Chrome identity and authority stable and narrow", () => {
    const chrome = manifest("chrome");
    const publicKey = chrome.key;

    expect(typeof publicKey).toBe("string");
    if (typeof publicKey !== "string") return;
    expect({
      extensionId: chromeExtensionId(publicKey),
      permissions: chrome.permissions,
      hostPermissions: chrome.host_permissions,
      optionalHostPermissions: chrome.optional_host_permissions,
      incognito: chrome.incognito
    }).toEqual({
      extensionId: "haipjkpamjpojalajcgfeggbjhifjpnn",
      permissions: requiredPermissions,
      hostPermissions: undefined,
      optionalHostPermissions: optionalOrigins,
      incognito: "not_allowed"
    });
  });

  it("keeps Firefox 140+ identity, authority, and data declarations stable", () => {
    const firefox = manifest("firefox");
    const settings = firefox.browser_specific_settings as {
      gecko: Record<string, unknown>;
      gecko_android: Record<string, unknown>;
    };

    expect({
      id: settings.gecko.id,
      minimum: settings.gecko.strict_min_version,
      androidMinimum: settings.gecko_android.strict_min_version,
      data: settings.gecko.data_collection_permissions,
      permissions: firefox.permissions,
      hostPermissions: firefox.host_permissions,
      optionalHostPermissions: firefox.optional_host_permissions,
      incognito: firefox.incognito
    }).toEqual({
      id: "browser-capture@increader.com",
      minimum: "140.0",
      androidMinimum: "142.0",
      data: {
        required: [
          "authenticationInfo",
          "browsingActivity",
          "websiteContent"
        ]
      },
      permissions: requiredPermissions,
      hostPermissions: undefined,
      optionalHostPermissions: optionalOrigins,
      incognito: "not_allowed"
    });
  });
});

function chromeExtensionId(publicKey: string): string {
  return [...createHash("sha256").update(Buffer.from(publicKey, "base64"))
    .digest()
    .subarray(0, 16)]
    .map(
      (byte) =>
        String.fromCharCode("a".charCodeAt(0) + (byte >> 4)) +
        String.fromCharCode("a".charCodeAt(0) + (byte & 0x0f))
    )
    .join("");
}
