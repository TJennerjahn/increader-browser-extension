export interface ActivePageInspection {
  tabId: number;
  sourceUrl: string;
  title: string | null;
}

export type CaptureJobState =
  | { phase: "ready"; page: ActivePageInspection | null }
  | { phase: "capturing" }
  | { phase: "staged"; captureId: string }
  | { phase: "transferring"; captureId: string }
  | { phase: "completed"; captureId: string; bookmarkId: number }
  | { phase: "failed"; captureId: string | null; message: string };

export interface CaptureJob {
  inspectCurrentTab(): Promise<ActivePageInspection | null>;
  startImport(): Promise<void>;
  retry(): Promise<void>;
  discard(): Promise<void>;
  observe(listener: (state: CaptureJobState) => void): () => void;
}
