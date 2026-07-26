const CLERK_NATIVE_RULE_ID = 1_712_001;

export function createClerkNativeTransport(
  declarativeNetRequest: typeof chrome.declarativeNetRequest = chrome.declarativeNetRequest,
): () => Promise<void> {
  let preparation: Promise<void> | null = null;
  return () => {
    preparation ??= declarativeNetRequest
      .updateSessionRules({
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
            id: CLERK_NATIVE_RULE_ID,
            priority: 1,
          },
        ],
        removeRuleIds: [CLERK_NATIVE_RULE_ID],
      })
      .catch((error: unknown) => {
        preparation = null;
        throw error;
      });
    return preparation;
  };
}
