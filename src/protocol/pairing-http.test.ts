import { describe, expect, it, vi } from "vitest";

import { createPairingHttpClient } from "./pairing-http";

describe("Browser Capture Pairing HTTP", () => {
  it("exchanges and renews without Account Identity credentials", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          accessToken: "bca_first",
          expiresInSeconds: 600,
          pairingId: "019bf66d-29df-7a41-950f-c4b36a9d61bd",
          renewalCredential: "bcr_first",
          renewalExpiresInSeconds: 7_776_000,
          tokenType: "Bearer"
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          accessToken: "bca_second",
          expiresInSeconds: 600,
          pairingId: "019bf66d-29df-7a41-950f-c4b36a9d61bd",
          renewalCredential: "bcr_second",
          renewalExpiresInSeconds: 7_776_000,
          tokenType: "Bearer"
        })
      );
    const client = createPairingHttpClient(fetcher);

    await client.exchange("https://reader.example", {
      authorizationCode: "bcc_approved",
      callbackUri: "https://extension.example/browser-capture",
      codeVerifier: "v".repeat(43),
      installationId: "019bf66c-42ac-7c33-b57d-e2131af04fe9",
      instanceOrigin: "https://reader.example",
      state: "s".repeat(43)
    });
    await client.renew("https://reader.example", {
      installationId: "019bf66c-42ac-7c33-b57d-e2131af04fe9",
      instanceOrigin: "https://reader.example",
      renewalCredential: "bcr_first"
    });

    expect(fetcher.mock.calls.map(([url, options]) => ({
      credentials: options?.credentials,
      method: options?.method,
      redirect: options?.redirect,
      url
    }))).toEqual([
      {
        credentials: "omit",
        method: "POST",
        redirect: "error",
        url: "https://reader.example/api/browser-capture/pairing/exchange"
      },
      {
        credentials: "omit",
        method: "POST",
        redirect: "error",
        url: "https://reader.example/api/browser-capture/pairing/renew"
      }
    ]);
  });
});
