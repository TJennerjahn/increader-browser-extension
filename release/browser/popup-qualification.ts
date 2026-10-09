import { mountPopup } from "../../src/popup/popup";
import type { CaptureJobClient } from "../../src/browser/capture-job-runtime";
import type { CaptureJobState } from "../../src/capture-job/capture-job";

const page = {
  kind: "supported" as const,
  tabId: 42,
  sourceUrl: "https://publisher.example/a-readable-article",
  title: "A readable article",
};
let refresh: (() => void) | undefined;
let publish: ((state: CaptureJobState) => void) | undefined;
let lookupDone: ((result: { exists: boolean }) => void) | undefined;
const lookup = new Promise<{ exists: boolean }>((resolve) => {
  lookupDone = resolve;
});
const imports: Parameters<CaptureJobClient["startImport"]>[] = [];
const job: CaptureJobClient = {
  current: () => Promise.resolve({ phase: "ready" }),
  startImport(...args) {
    imports.push(args);
    publish?.({ phase: "sending", captureId: "synthetic-capture" });
    return Promise.resolve({ status: "started" });
  },
  cancel: () => Promise.resolve(),
  retry: () => Promise.resolve(),
  discard: () => Promise.resolve(),
  observe(listener) {
    publish = listener;
    return () => {
      publish = undefined;
    };
  },
};
const root = document.querySelector("main");
if (root === null) throw new Error("Missing popup root");
mountPopup(
  root,
  {
    current: () =>
      Promise.resolve({
        origin: "https://reader.example",
        email: "reader@example.com",
        displayName: "Reader",
      }),
    currentOrigin: () => Promise.resolve("https://reader.example"),
    accessToken: () => Promise.resolve("synthetic-token"),
    signIn: () => Promise.reject(new Error("Not used")),
    signInWithGoogle: () => Promise.reject(new Error("Not used")),
    signOut: () => Promise.resolve(),
  },
  {
    activePage: {
      inspect: () => Promise.resolve(page),
      observe(listener) {
        refresh = listener;
        return () => {
          refresh = undefined;
        };
      },
    },
    lookup: { lookup: () => lookup },
    captureJob: job,
    openReader: () => Promise.resolve(),
  },
);
Object.assign(globalThis, {
  popupQualification: {
    imports,
    refresh: () => {
      refresh?.();
    },
    finishLookup: () => {
      lookupDone?.({ exists: false });
    },
    complete: () => {
      publish?.({
        phase: "completed",
        captureId: "synthetic-capture",
        bookmarkId: 42,
        title: "My reading title",
        origin: "https://reader.example",
        outcome: "created",
        sourceUrl: page.sourceUrl,
      });
    },
  },
});
