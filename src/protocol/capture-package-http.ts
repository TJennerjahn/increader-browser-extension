import type { StagedCapturePackage } from "../capture-package/capture-package";

export interface CapturePackageOutcome {
  bookmarkId: number;
  title: string;
  created: boolean;
}

export interface CapturePackageHttpClient {
  transfer(
    origin: string,
    accessToken: string,
    staged: StagedCapturePackage,
  ): Promise<CapturePackageOutcome>;
}

export function createCapturePackageHttpClient(
  fetcher: typeof fetch = fetch,
): CapturePackageHttpClient {
  return {
    async transfer(origin, accessToken, staged) {
      const body = new FormData();
      body.append(
        "manifest",
        new Blob([JSON.stringify(staged.manifest)], {
          type: "application/json",
        }),
      );
      body.append(
        "document",
        new Blob([staged.documentHtml], {
          type: "text/html;charset=utf-8",
        }),
      );
      for (const asset of staged.assetParts) {
        body.append(asset.id, asset.data);
      }
      const response = await fetcher(
        new URL("/api/browser-capture/captures", `${origin}/`).toString(),
        {
          method: "POST",
          credentials: "omit",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          body,
        },
      );
      if (response.status !== 200 && response.status !== 201) {
        throw await captureTransferFailure(response);
      }
      const value: unknown = await response.json();
      if (
        value === null ||
        typeof value !== "object" ||
        typeof (value as Record<string, unknown>).id !== "number"
      ) {
        throw new Error("Increader returned an invalid Bookmark outcome.");
      }
      const bookmark = value as Record<string, unknown>;
      return {
        bookmarkId: bookmark.id as number,
        created: response.status === 201,
        title: typeof bookmark.title === "string" ? bookmark.title : "",
      };
    },
  };
}

async function captureTransferFailure(response: Response): Promise<Error> {
  try {
    const problem: unknown = await response.json();
    if (
      problem !== null &&
      typeof problem === "object" &&
      typeof (problem as Record<string, unknown>).detail === "string"
    ) {
      return new Error((problem as Record<string, string>).detail);
    }
  } catch {
    // Use the stable fallback below for an absent or malformed problem body.
  }
  return new Error("Increader could not import this Capture Package.");
}
