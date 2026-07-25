import type {
  PairingCredentials,
  PairingExchangeRequest,
  PairingProtocolClient,
  PairingRenewalRequest
} from "../pairing/pairing";

export function createPairingHttpClient(
  fetcher: typeof fetch = globalThis.fetch
): PairingProtocolClient {
  return {
    exchange: (origin, request) =>
      postCredentials(fetcher, origin, "exchange", request),
    renew: (origin, request) =>
      postCredentials(fetcher, origin, "renew", request),
    async revoke(origin, request) {
      const response = await post(fetcher, origin, "revoke", request);
      if (!response.ok && response.status !== 401) {
        throw pairingFailure();
      }
    }
  };
}

async function postCredentials(
  fetcher: typeof fetch,
  origin: string,
  operation: "exchange" | "renew",
  request: PairingExchangeRequest | PairingRenewalRequest
): Promise<PairingCredentials> {
  const response = await post(fetcher, origin, operation, request);
  if (!response.ok) {
    throw pairingFailure();
  }
  try {
    return parseCredentials(await response.json());
  } catch {
    throw pairingFailure();
  }
}

function post(
  fetcher: typeof fetch,
  origin: string,
  operation: "exchange" | "renew" | "revoke",
  request: PairingExchangeRequest | PairingRenewalRequest
): Promise<Response> {
  return fetcher(`${origin}/api/browser-capture/pairing/${operation}`, {
    body: JSON.stringify(request),
    cache: "no-store",
    credentials: "omit",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    method: "POST",
    redirect: "error"
  });
}

function parseCredentials(value: unknown): PairingCredentials {
  if (value === null || typeof value !== "object") {
    throw pairingFailure();
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.tokenType !== "Bearer" ||
    typeof candidate.accessToken !== "string" ||
    typeof candidate.renewalCredential !== "string" ||
    typeof candidate.pairingId !== "string" ||
    typeof candidate.expiresInSeconds !== "number" ||
    candidate.expiresInSeconds !== 600 ||
    typeof candidate.renewalExpiresInSeconds !== "number" ||
    candidate.renewalExpiresInSeconds !== 7_776_000
  ) {
    throw pairingFailure();
  }
  return {
    accessToken: candidate.accessToken,
    expiresInSeconds: candidate.expiresInSeconds,
    pairingId: candidate.pairingId,
    renewalCredential: candidate.renewalCredential,
    renewalExpiresInSeconds: candidate.renewalExpiresInSeconds,
    tokenType: "Bearer"
  };
}

function pairingFailure(): Error {
  return new Error("Could not complete Browser Capture Pairing.");
}
