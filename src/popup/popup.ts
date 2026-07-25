import type { Pairing } from "../pairing/pairing";
import type {
  ActivePageInspection,
  ActivePageInspector,
} from "../browser/active-page";
import type { BookmarkLookupClient } from "../protocol/bookmark-lookup-http";
import type { CaptureJobClient } from "../browser/capture-job-runtime";
import type { CaptureJobState } from "../capture-job/capture-job";

export const CLOUD_INSTANCE_ORIGIN = "https://app.increader.com";

export interface PopupPageDependencies {
  activePage: ActivePageInspector;
  captureJob?: CaptureJobClient;
  confirmReplacement?(): boolean;
  lookup: BookmarkLookupClient;
  openReader(url: string): Promise<void>;
}

export function mountPopup(
  root: HTMLElement,
  pairing: Pairing,
  pageDependencies?: PopupPageDependencies,
): () => void {
  root.innerHTML = `
    <section class="popup-shell" aria-labelledby="popup-title">
      <header class="popup-header">
        <div>
          <h1 id="popup-title">Browser Capture</h1>
          <p class="destination" data-destination>Increader Cloud</p>
        </div>
        <span class="status-dot" aria-hidden="true"></span>
      </header>

      <section class="connection-card" aria-live="polite">
        <p class="eyebrow">Connection</p>
        <p class="connection-status" data-status>Not connected</p>
        <p class="connection-detail" data-detail>
          Connect this browser before importing the current page.
        </p>
        <button class="primary-action" type="button" data-cloud-connect>
          Connect to Increader Cloud
        </button>
        <button class="secondary-action" type="button" data-disconnect hidden>
          Disconnect
        </button>
      </section>

      <section class="page-card" data-page-card aria-live="polite" hidden>
        <p class="eyebrow">Current page</p>
        <h2 class="page-title" data-page-title>Inspecting…</h2>
        <p class="page-source" data-page-source></p>
        <p class="page-status" data-page-status>Inspecting…</p>
        <p class="page-detail" data-page-detail></p>
        <div class="page-actions">
          <button class="primary-action" type="button" data-import disabled>
            Import
          </button>
          <button class="secondary-action" type="button" data-open-reader hidden>
            Open Reader
          </button>
          <button class="secondary-action" type="button" data-cancel hidden>
            Cancel
          </button>
          <button class="primary-action" type="button" data-retry hidden>
            Retry
          </button>
          <button class="secondary-action" type="button" data-discard hidden>
            Discard
          </button>
        </div>
      </section>

      <details class="settings">
        <summary>Connection settings</summary>
        <form data-self-hosted-form>
          <label for="self-hosted-origin">Self-hosted Increader origin</label>
          <input
            id="self-hosted-origin"
            name="origin"
            type="url"
            inputmode="url"
            autocomplete="url"
            placeholder="https://reader.example"
            required
          />
          <button class="secondary-action" type="submit">
            Use self-hosted instance
          </button>
        </form>
      </details>

      <p class="privacy-note">
        Before Import, only the active page title, URL, and document type are
        read. Only the URL is sent to your paired Increader for Bookmark Lookup;
        page content is not read or sent. Import reads the rendered page and
        sends it only to that paired Increader instance.
      </p>
    </section>
  `;

  const cloudButton = requiredElement(
    root,
    "[data-cloud-connect]",
  ) as HTMLButtonElement;
  const selfHostedForm = requiredElement(
    root,
    "[data-self-hosted-form]",
  ) as HTMLFormElement;
  const originInput = requiredElement(
    root,
    "#self-hosted-origin",
  ) as HTMLInputElement;
  const status = requiredElement(root, "[data-status]") as HTMLElement;
  const detail = requiredElement(root, "[data-detail]") as HTMLElement;
  const destination = requiredElement(
    root,
    "[data-destination]",
  ) as HTMLElement;
  const disconnectButton = requiredElement(
    root,
    "[data-disconnect]",
  ) as HTMLButtonElement;
  const pageCard = requiredElement(root, "[data-page-card]") as HTMLElement;
  const pageTitle = requiredElement(root, "[data-page-title]") as HTMLElement;
  const pageSource = requiredElement(root, "[data-page-source]") as HTMLElement;
  const pageStatus = requiredElement(root, "[data-page-status]") as HTMLElement;
  const pageDetail = requiredElement(root, "[data-page-detail]") as HTMLElement;
  const importButton = requiredElement(
    root,
    "[data-import]",
  ) as HTMLButtonElement;
  const openReaderButton = requiredElement(
    root,
    "[data-open-reader]",
  ) as HTMLButtonElement;
  const cancelButton = requiredElement(
    root,
    "[data-cancel]",
  ) as HTMLButtonElement;
  const retryButton = requiredElement(
    root,
    "[data-retry]",
  ) as HTMLButtonElement;
  const discardButton = requiredElement(
    root,
    "[data-discard]",
  ) as HTMLButtonElement;
  let disposed = false;
  let pairedDestination: {
    displayName: string;
    origin: string;
  } | null = null;
  let currentPage: Extract<ActivePageInspection, { kind: "supported" }> | null =
    null;
  let existingBookmarkId: number | null = null;
  let readerOrigin: string | null = null;
  let pageGeneration = 0;
  let importActive = false;
  let currentJobState: CaptureJobState = { phase: "ready" };
  let retryRevealTimeout: ReturnType<typeof globalThis.setTimeout> | null =
    null;
  const isDisposed = (): boolean => disposed;

  const showDisconnected = (message?: string): void => {
    pairedDestination = null;
    currentPage = null;
    existingBookmarkId = null;
    readerOrigin = null;
    pageGeneration += 1;
    importActive = false;
    pageCard.hidden = true;
    destination.textContent = "Increader Cloud";
    status.textContent = "Not connected";
    detail.textContent =
      message ?? "Connect this browser before importing the current page.";
    cloudButton.hidden = false;
    cloudButton.disabled = false;
    disconnectButton.hidden = true;
  };

  const showPaired = (paired: {
    displayName: string;
    origin: string;
  }): void => {
    pairedDestination = paired;
    destination.textContent = paired.displayName;
    status.textContent = "Paired";
    detail.textContent = `Browser Capture sends only to ${paired.origin}.`;
    cloudButton.hidden = true;
    disconnectButton.hidden = false;
    if (pageDependencies !== undefined) {
      void refreshPage();
    }
  };

  const showInspection = async (
    inspected: ActivePageInspection,
    generation: number,
  ): Promise<void> => {
    if (
      isDisposed() ||
      generation !== pageGeneration ||
      pairedDestination === null
    ) {
      return;
    }
    pageCard.hidden = false;
    existingBookmarkId = null;
    readerOrigin = null;
    openReaderButton.hidden = true;
    if (inspected.kind === "unsupported") {
      currentPage = null;
      pageTitle.textContent = "Unsupported page";
      pageSource.textContent = "";
      pageStatus.textContent = "Unsupported";
      pageDetail.textContent = inspected.reason;
      importButton.disabled = true;
      renderJobState(currentJobState);
      return;
    }

    currentPage = inspected;
    pageTitle.textContent = inspected.title || "Untitled page";
    pageSource.textContent = inspected.sourceUrl;
    pageStatus.textContent = "Checking Increader…";
    pageDetail.textContent = "";
    importButton.disabled = true;
    try {
      const accessToken = await pairing.accessToken();
      const result = await pageDependencies?.lookup.lookup(
        pairedDestination.origin,
        accessToken,
        inspected.sourceUrl,
      );
      if (isDisposed() || generation !== pageGeneration) {
        return;
      }
      importButton.disabled = false;
      if (result?.exists === true && result.bookmarkId !== undefined) {
        existingBookmarkId = result.bookmarkId;
        readerOrigin = pairedDestination.origin;
        pageStatus.textContent = "Already in Increader";
        pageDetail.textContent = result.title ?? "";
        openReaderButton.hidden = false;
      } else {
        pageStatus.textContent = "Ready";
        pageDetail.textContent = "Choose Import to capture this exact page.";
      }
      renderJobState(currentJobState);
    } catch (error) {
      if (isDisposed() || generation !== pageGeneration) return;
      currentPage = null;
      pageStatus.textContent = "Could not check Increader";
      pageDetail.textContent =
        error instanceof Error
          ? error.message
          : "Reconnect this browser and try again.";
      importButton.disabled = true;
      renderJobState(currentJobState);
    }
  };

  async function refreshPage(): Promise<void> {
    if (
      pageDependencies === undefined ||
      pairedDestination === null ||
      importActive
    ) {
      return;
    }
    const generation = ++pageGeneration;
    pageCard.hidden = false;
    pageTitle.textContent = "Inspecting…";
    pageSource.textContent = "";
    pageStatus.textContent = "Inspecting…";
    pageDetail.textContent = "";
    importButton.disabled = true;
    openReaderButton.hidden = true;
    if (currentJobState.phase !== "ready") {
      renderJobState(currentJobState);
    }
    let inspected: ActivePageInspection;
    try {
      inspected = await pageDependencies.activePage.inspect();
    } catch {
      inspected = {
        kind: "unsupported",
        reason: "This page cannot be inspected for import.",
      };
    }
    await showInspection(inspected, generation);
  }

  const connect = async (origin: string): Promise<void> => {
    cloudButton.disabled = true;
    status.textContent = "Connecting…";
    detail.textContent = "Approve Browser Capture in the Increader window.";
    try {
      const result = await pairing.connect(origin);
      if (isDisposed()) return;
      showPaired(result);
    } catch (error) {
      if (disposed) return;
      showDisconnected(
        error instanceof Error
          ? error.message
          : "Could not connect to a compatible Increader instance.",
      );
    }
  };

  const onCloudConnect = (): void => {
    void connect(CLOUD_INSTANCE_ORIGIN);
  };
  const onSelfHostedSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    void connect(originInput.value);
  };
  const onDisconnect = (): void => {
    disconnectButton.disabled = true;
    status.textContent = "Disconnecting…";
    void pairing
      .disconnect()
      .then(() => {
        if (!disposed) showDisconnected();
      })
      .catch(() => {
        if (isDisposed()) return;
        status.textContent = "Could not disconnect";
        detail.textContent =
          "Increader could not revoke this installation. Try again.";
        disconnectButton.disabled = false;
      });
  };
  const onImport = (): void => {
    if (
      pageDependencies === undefined ||
      currentPage === null ||
      pairedDestination === null ||
      importActive
    ) {
      return;
    }
    const expectedPage = currentPage;
    const destinationOrigin = pairedDestination.origin;
    importButton.disabled = true;
    void pageDependencies.activePage
      .inspect()
      .then(async (freshPage) => {
        if (disposed) return;
        if (
          freshPage.kind !== "supported" ||
          freshPage.tabId !== expectedPage.tabId ||
          freshPage.sourceUrl !== expectedPage.sourceUrl
        ) {
          const generation = ++pageGeneration;
          await showInspection(freshPage, generation);
          if (
            !isDisposed() &&
            generation === pageGeneration &&
            freshPage.kind === "supported"
          ) {
            pageStatus.textContent = "Page changed";
            pageDetail.textContent =
              "Review this page and choose Import again.";
          }
          return;
        }
        importActive = true;
        pageStatus.textContent = "Import authorized";
        pageDetail.textContent = "Preparing this page for Increader…";
        root.dispatchEvent(
          new CustomEvent<ActivePageInspection>("browser-capture-import", {
            detail: freshPage,
          }),
        );
        if (pageDependencies.captureJob === undefined) {
          return;
        }
        let started = await pageDependencies.captureJob.startImport(
          freshPage,
          destinationOrigin,
          false,
        );
        if (started.status === "replacement-required") {
          const confirmed =
            pageDependencies.confirmReplacement?.() ??
            globalThis.confirm(
              "Discard the Capture Package waiting for Retry and import this page instead?",
            );
          if (!confirmed) {
            importActive = false;
            renderJobState(currentJobState);
            return;
          }
          started = await pageDependencies.captureJob.startImport(
            freshPage,
            destinationOrigin,
            true,
          );
        }
        if (started.status !== "started") {
          importActive = false;
        }
      })
      .catch((error: unknown) => {
        if (isDisposed()) return;
        importActive = false;
        pageStatus.textContent = "Needs attention";
        pageDetail.textContent =
          error instanceof Error
            ? error.message
            : "Inspect the current page and choose Import again.";
        importButton.disabled = false;
      });
  };
  const onOpenReader = (): void => {
    if (
      pageDependencies === undefined ||
      readerOrigin === null ||
      existingBookmarkId === null
    ) {
      return;
    }
    const readerUrl = new URL(
      `/bookmarks/${String(existingBookmarkId)}`,
      `${readerOrigin}/`,
    ).toString();
    openReaderButton.disabled = true;
    void pageDependencies
      .openReader(readerUrl)
      .catch(() => {
        if (isDisposed()) return;
        pageStatus.textContent = "Could not open Reader";
        pageDetail.textContent = "Try opening this Bookmark again.";
      })
      .finally(() => {
        if (!isDisposed()) {
          openReaderButton.disabled = false;
        }
      });
  };
  const onCancel = (): void => {
    void pageDependencies?.captureJob?.cancel();
  };
  const onRetry = (): void => {
    void pageDependencies?.captureJob?.retry();
  };
  const onDiscard = (): void => {
    void pageDependencies?.captureJob?.discard();
  };

  function renderJobState(next: CaptureJobState): void {
    currentJobState = next;
    if (retryRevealTimeout !== null) {
      globalThis.clearTimeout(retryRevealTimeout);
      retryRevealTimeout = null;
    }
    cancelButton.hidden = true;
    retryButton.hidden = true;
    discardButton.hidden = true;
    if (next.phase === "ready") {
      importActive = false;
      if (next.notice !== undefined) {
        pageStatus.textContent = "Ready";
        pageDetail.textContent = next.notice;
      }
      importButton.disabled = currentPage === null;
      return;
    }
    pageCard.hidden = false;
    openReaderButton.hidden = true;
    if (next.phase === "capturing") {
      importActive = true;
      pageStatus.textContent = "Capturing page";
      pageDetail.textContent =
        next.totalAssets === undefined
          ? "Preparing the page and finding images…"
          : `Capturing images ${String(next.completedAssets)} of ${String(next.totalAssets)}…`;
      importButton.disabled = true;
      cancelButton.hidden = false;
      return;
    }
    if (next.phase === "sending") {
      importActive = true;
      pageStatus.textContent = "Sending to Increader";
      pageDetail.textContent = "Waiting for Increader to finish importing…";
      importButton.disabled = true;
      return;
    }
    if (next.phase === "completed") {
      importActive = false;
      existingBookmarkId = next.bookmarkId;
      readerOrigin = next.origin;
      pageStatus.textContent =
        next.outcome === "created" ? "Imported" : "Already in Increader";
      pageDetail.textContent = next.title;
      openReaderButton.hidden = false;
      importButton.disabled = currentPage === null;
      return;
    }
    importActive = false;
    pageStatus.textContent = "Needs attention";
    pageDetail.textContent = next.message;
    importButton.disabled = currentPage === null;
    const retryDelay =
      next.retryNotBeforeEpochMs === undefined
        ? 0
        : next.retryNotBeforeEpochMs - Date.now();
    if (next.retryable && retryDelay <= 0) {
      retryButton.hidden = false;
    } else if (next.retryable) {
      const expectedCaptureId = next.captureId;
      const expectedRetryTime = next.retryNotBeforeEpochMs;
      retryRevealTimeout = globalThis.setTimeout(() => {
        retryRevealTimeout = null;
        if (
          !isDisposed() &&
          currentJobState.phase === "failed" &&
          currentJobState.captureId === expectedCaptureId &&
          currentJobState.retryNotBeforeEpochMs === expectedRetryTime &&
          expectedRetryTime !== undefined &&
          Date.now() >= expectedRetryTime
        ) {
          retryButton.hidden = false;
        }
      }, retryDelay);
    }
    if (next.captureId !== null) {
      discardButton.hidden = false;
    }
  }

  cloudButton.addEventListener("click", onCloudConnect);
  selfHostedForm.addEventListener("submit", onSelfHostedSubmit);
  disconnectButton.addEventListener("click", onDisconnect);
  importButton.addEventListener("click", onImport);
  openReaderButton.addEventListener("click", onOpenReader);
  cancelButton.addEventListener("click", onCancel);
  retryButton.addEventListener("click", onRetry);
  discardButton.addEventListener("click", onDiscard);
  const stopObserving = pageDependencies?.activePage.observe(() => {
    if (pairedDestination !== null && !importActive) {
      void refreshPage();
    }
  });
  const stopObservingJob = pageDependencies?.captureJob?.observe(
    renderJobState,
  );
  void pageDependencies?.captureJob
    ?.current()
    .then(renderJobState)
    .catch(() => undefined);

  void pairing.current().then((current) => {
    if (!disposed && current !== null) {
      showPaired(current);
    }
  });

  return () => {
    disposed = true;
    if (retryRevealTimeout !== null) {
      globalThis.clearTimeout(retryRevealTimeout);
    }
    cloudButton.removeEventListener("click", onCloudConnect);
    selfHostedForm.removeEventListener("submit", onSelfHostedSubmit);
    disconnectButton.removeEventListener("click", onDisconnect);
    importButton.removeEventListener("click", onImport);
    openReaderButton.removeEventListener("click", onOpenReader);
    cancelButton.removeEventListener("click", onCancel);
    retryButton.removeEventListener("click", onRetry);
    discardButton.removeEventListener("click", onDiscard);
    stopObserving?.();
    stopObservingJob?.();
  };
}

function requiredElement(root: HTMLElement, selector: string): Element {
  const element = root.querySelector(selector);
  if (element === null) {
    throw new Error(`Popup template is missing ${selector}`);
  }
  return element;
}
