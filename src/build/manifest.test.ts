import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const requiredPermissions = [
  "activeTab",
  "scripting",
  "storage",
  "cookies",
  "identity",
  "notifications",
  "declarativeNetRequestWithHostAccess",
];
const requiredCloudOrigins = [
  "https://app.increader.com/*",
  "https://clerk.increader.com/*",
];
const optionalOrigins = [
  "https://*/*",
  "http://localhost/*",
  "http://127.0.0.1/*",
  "http://[::1]/*",
];

function manifest(browser: "chrome" | "firefox"): Record<string, unknown> {
  const url = new URL(`../../manifests/${browser}.json`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as Record<
    string,
    unknown
  >;
}

describe("production manifests", () => {
  it("keeps Chrome identity and authority stable and narrow", () => {
    const chrome = manifest("chrome");
    const publicKey = chrome.key;

    expect(typeof publicKey).toBe("string");
    if (typeof publicKey !== "string") return;
    expect({
      name: chrome.name,
      defaultTitle: (chrome.action as Record<string, unknown>).default_title,
      extensionId: chromeExtensionId(publicKey),
      oauthCallback: chromeOauthCallback(publicKey),
      permissions: chrome.permissions,
      hostPermissions: chrome.host_permissions,
      optionalHostPermissions: chrome.optional_host_permissions,
      incognito: chrome.incognito,
    }).toEqual({
      name: "Increader",
      defaultTitle: "Increader",
      extensionId: "haipjkpamjpojalajcgfeggbjhifjpnn",
      oauthCallback:
        "https://haipjkpamjpojalajcgfeggbjhifjpnn.chromiumapp.org/clerk",
      permissions: requiredPermissions,
      hostPermissions: requiredCloudOrigins,
      optionalHostPermissions: optionalOrigins,
      incognito: "not_allowed",
    });
  });

  it("keeps Firefox 140+ desktop identity, authority, and data declarations stable", () => {
    const firefox = manifest("firefox");
    const settings = firefox.browser_specific_settings as {
      gecko: Record<string, unknown>;
      gecko_android?: unknown;
    };

    expect({
      name: firefox.name,
      defaultTitle: (firefox.action as Record<string, unknown>).default_title,
      id: settings.gecko.id,
      oauthCallback: firefoxOauthCallback(settings.gecko.id),
      minimum: settings.gecko.strict_min_version,
      android: settings.gecko_android,
      data: settings.gecko.data_collection_permissions,
      permissions: firefox.permissions,
      hostPermissions: firefox.host_permissions,
      optionalHostPermissions: firefox.optional_host_permissions,
      incognito: firefox.incognito,
    }).toEqual({
      name: "Increader",
      defaultTitle: "Increader",
      id: "browser-capture@increader.com",
      oauthCallback:
        "https://67a4223028cae940bb8b49e4730746728ae11c28.extensions.allizom.org/clerk",
      minimum: "140.0",
      android: undefined,
      data: {
        required: ["authenticationInfo", "browsingActivity", "websiteContent"],
      },
      permissions: requiredPermissions,
      hostPermissions: requiredCloudOrigins,
      optionalHostPermissions: optionalOrigins,
      incognito: "not_allowed",
    });
  });
});

function chromeExtensionId(publicKey: string): string {
  return [
    ...createHash("sha256")
      .update(Buffer.from(publicKey, "base64"))
      .digest()
      .subarray(0, 16),
  ]
    .map(
      (byte) =>
        String.fromCharCode("a".charCodeAt(0) + (byte >> 4)) +
        String.fromCharCode("a".charCodeAt(0) + (byte & 0x0f)),
    )
    .join("");
}

function chromeOauthCallback(publicKey: string): string {
  return `https://${chromeExtensionId(publicKey)}.chromiumapp.org/clerk`;
}

function firefoxOauthCallback(addOnId: unknown): string | null {
  if (typeof addOnId !== "string") return null;
  const subdomain = createHash("sha1").update(addOnId).digest("hex");
  return `https://${subdomain}.extensions.allizom.org/clerk`;
}
