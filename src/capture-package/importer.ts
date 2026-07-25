import type {
  ActivePageInspection,
} from "../browser/active-page";
import type {
  CapturePackageAssembler,
} from "./capture-package";
import type {
  CapturePackageHttpClient,
  CapturePackageOutcome,
} from "../protocol/capture-package-http";

export interface BrowserCaptureImporter {
  importPage(
    page: Extract<ActivePageInspection, { kind: "supported" }>,
    origin: string,
    accessToken: string,
  ): Promise<CapturePackageOutcome>;
}

export function createBrowserCaptureImporter(
  assembler: CapturePackageAssembler,
  protocol: CapturePackageHttpClient,
): BrowserCaptureImporter {
  return {
    async importPage(page, origin, accessToken) {
      const staged = await assembler.capture(page);
      return protocol.transfer(origin, accessToken, staged);
    },
  };
}
