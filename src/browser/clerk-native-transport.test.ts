import { describe, expect, it, vi } from "vitest";

import { createClerkNativeTransport } from "./clerk-native-transport";

describe("Clerk native transport", () => {
  it("removes browser Origin headers only from background Clerk requests", async () => {
    const updateSessionRules = vi.fn().mockResolvedValue(undefined);
    const prepare = createClerkNativeTransport({
      updateSessionRules,
    } as unknown as typeof chrome.declarativeNetRequest);

    await Promise.all([prepare(), prepare()]);

    expect(updateSessionRules).toHaveBeenCalledOnce();
    expect(updateSessionRules).toHaveBeenCalledWith({
      addRules: [
        {
          action: {
            requestHeaders: [{ header: "Origin", operation: "remove" }],
            type: "modifyHeaders",
          },
          condition: {
            requestDomains: ["clerk.increader.com"],
            resourceTypes: ["xmlhttprequest"],
            tabIds: [-1],
          },
          id: 1_712_001,
          priority: 1,
        },
      ],
      removeRuleIds: [1_712_001],
    });
  });

  it("retries rule installation after a browser API failure", async () => {
    const updateSessionRules = vi
      .fn()
      .mockRejectedValueOnce(new Error("rule rejected"))
      .mockResolvedValueOnce(undefined);
    const prepare = createClerkNativeTransport({
      updateSessionRules,
    } as unknown as typeof chrome.declarativeNetRequest);

    await expect(prepare()).rejects.toThrow("rule rejected");
    await expect(prepare()).resolves.toBeUndefined();

    expect(updateSessionRules).toHaveBeenCalledTimes(2);
  });
});
