import { describe, expect, it } from "vitest";

import { runtimeOriginPermissionPattern } from "./runtime-origin-permission";

describe("runtime origin permission patterns", () => {
  it("keeps the exact instance port in Chrome", () => {
    expect(
      runtimeOriginPermissionPattern("http://127.0.0.1:5289", {
        getURL: () => "chrome-extension://extension-id/",
      }),
    ).toBe("http://127.0.0.1:5289/*");
  });

  it("omits the unsupported port in Firefox", () => {
    expect(
      runtimeOriginPermissionPattern("http://127.0.0.1:5289", {
        getURL: () => "moz-extension://extension-id/",
      }),
    ).toBe("http://127.0.0.1/*");
  });

  it("also adapts an exact pattern passed by a caller", () => {
    expect(
      runtimeOriginPermissionPattern("http://127.0.0.1:5289/*", {
        getURL: () => "moz-extension://extension-id/",
      }),
    ).toBe("http://127.0.0.1/*");
  });

  it("preserves Firefox IPv6 host syntax while omitting the port", () => {
    expect(
      runtimeOriginPermissionPattern("http://[::1]:5289", {
        getURL: () => "moz-extension://extension-id/",
      }),
    ).toBe("http://[::1]/*");
  });
});
