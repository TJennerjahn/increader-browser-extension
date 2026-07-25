import type { Pairing } from "../pairing/pairing";
import type {
  PairingClient,
  PairingOperationState,
} from "../browser/pairing-runtime";
import type {
  ActivePageInspection,
  ActivePageInspector,
} from "../browser/active-page";
import type { BookmarkLookupClient } from "../protocol/bookmark-lookup-http";
import type { CaptureJobClient } from "../browser/capture-job-runtime";
import type { CaptureJobState } from "../capture-job/capture-job";
import { normalizeInstanceOrigin } from "../pairing/instance-origin";

export const CLOUD_INSTANCE_ORIGIN = "https://app.increader.com";

export interface ConnectionOriginPreference {
  load(): Promise<string | null>;
  save(origin: string): Promise<void>;
}

export interface PopupPageDependencies {
  activePage: ActivePageInspector;
  captureJob?: CaptureJobClient;
  confirmReplacement?(): boolean;
  lookup: BookmarkLookupClient;
  openReader(url: string): Promise<void>;
}

export function mountPopup(
  root: HTMLElement,
  pairing: Pairing & Partial<Pick<PairingClient, "observe" | "operation">>,
  pageDependencies?: PopupPageDependencies,
  connectionOriginPreference?: ConnectionOriginPreference,
): () => void {
  root.innerHTML = `
    <section class="popup-shell" aria-labelledby="popup-title">
      <header class="popup-header">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32">
              <rect width="32" height="32" rx="8" fill="currentColor"></rect>
              <g transform="translate(7, 7) scale(0.75)">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>
              </g>
            </svg>
          </span>
          <div class="brand-copy">
            <h1 id="popup-title">Increader</h1>
            <p>Browser Capture</p>
          </div>
        </div>
        <span class="badge destination" data-destination>Increader Cloud</span>
      </header>

      <section
        class="connection-card card card-surface"
        data-connection-card
        data-state="disconnected"
        aria-live="polite"
      >
        <div class="card-body">
          <div class="section-heading">
            <span class="section-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
              </svg>
            </span>
            <div class="section-copy">
              <p class="eyebrow">Connection</p>
              <p class="connection-status" data-status>Not connected</p>
            </div>
            <span class="status-dot" aria-hidden="true"></span>
          </div>
          <p class="connection-detail" data-detail>
            Connect this browser before importing the current page.
          </p>
          <div class="connection-actions">
            <button
              class="primary-action btn btn-primary btn-block"
              type="button"
              data-cloud-connect
            >
              Connect to Increader Cloud
            </button>
            <button
              class="secondary-action btn btn-ghost btn-sm btn-block"
              type="button"
              data-disconnect
              hidden
            >
              Disconnect
            </button>
          </div>
        </div>
      </section>

      <section
        class="page-card card card-surface"
        data-page-card
        aria-live="polite"
        hidden
      >
        <div class="card-body">
          <div class="page-heading">
            <span class="section-icon page-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
              </svg>
            </span>
            <div class="page-copy">
              <p class="eyebrow">Current page</p>
              <h2 class="page-title" data-page-title>Inspecting…</h2>
            </div>
          </div>
          <p class="page-source" data-page-source></p>
          <div class="page-feedback">
            <span class="feedback-dot" aria-hidden="true"></span>
            <div>
              <p class="page-status" data-page-status>Inspecting…</p>
              <p class="page-detail" data-page-detail></p>
            </div>
          </div>
          <div class="page-actions">
            <button
              class="primary-action btn btn-primary"
              type="button"
              data-import
              disabled
            >
              Import
            </button>
            <button
              class="secondary-action btn btn-outline"
              type="button"
              data-open-reader
              hidden
            >
              Open Reader
            </button>
            <button
              class="secondary-action btn btn-ghost"
              type="button"
              data-cancel
              hidden
            >
              Cancel
            </button>
            <button
              class="primary-action btn btn-primary"
              type="button"
              data-retry
              hidden
            >
              Retry
            </button>
            <button
              class="secondary-action btn btn-ghost"
              type="button"
              data-discard
              hidden
            >
              Discard
            </button>
          </div>
        </div>
      </section>

      <details class="settings collapse">
        <summary class="settings-summary">
          <span class="settings-label">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"></path>
              <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.14.37.35.7.6 1 .3.25.68.4 1.1.4H21a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15z"></path>
            </svg>
            Connection settings
          </span>
          <svg class="chevron" viewBox="0 0 24 24" aria-hidden="true">
            <path d="m9 18 6-6-6-6"></path>
          </svg>
        </summary>
        <form class="settings-content" data-self-hosted-form>
          <label class="label" for="self-hosted-origin">
            <span class="label-text">Increader instance origin</span>
          </label>
          <input
            class="input input-bordered"
            id="self-hosted-origin"
            name="origin"
            type="url"
            inputmode="url"
            autocomplete="url"
            placeholder="https://reader.example"
            value="https://app.increader.com"
            required
          />
          <button
            class="secondary-action btn btn-outline btn-block"
            type="submit"
          >
            Save connection
          </button>
        </form>
      </details>
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
  const connectionCard = requiredElement(
    root,
    "[data-connection-card]",
  ) as HTMLElement;
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
  let configuredOrigin = CLOUD_INSTANCE_ORIGIN;
  let connectionInteractionGeneration = 0;
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

  const configuredDestinationLabel = (): string =>
    configuredOrigin === CLOUD_INSTANCE_ORIGIN
      ? "Increader Cloud"
      : new URL(configuredOrigin).host;

  const renderConfiguredOrigin = (): void => {
    originInput.value = configuredOrigin;
    cloudButton.textContent =
      configuredOrigin === CLOUD_INSTANCE_ORIGIN
        ? "Connect to Increader Cloud"
        : `Connect to ${configuredDestinationLabel()}`;
  };

  const showDisconnected = (message?: string): void => {
    connectionCard.dataset.state = "disconnected";
    pairedDestination = null;
    currentPage = null;
    existingBookmarkId = null;
    readerOrigin = null;
    pageGeneration += 1;
    importActive = false;
    pageCard.hidden = true;
    renderConfiguredOrigin();
    destination.textContent = configuredDestinationLabel();
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
    connectionCard.dataset.state = "paired";
    pairedDestination = paired;
    renderConfiguredOrigin();
    const configuredPairing = paired.origin === configuredOrigin;
    destination.textContent = configuredPairing
      ? paired.displayName
      : configuredDestinationLabel();
    status.textContent = "Paired";
    detail.textContent = configuredPairing
      ? ""
      : `Currently paired with ${paired.displayName}. Connect to replace it.`;
    cloudButton.hidden = configuredPairing;
    cloudButton.disabled = false;
    disconnectButton.hidden = false;
    if (pageDependencies !== undefined) {
      void refreshPage();
    }
  };

  const renderPairingOperation = (operation: PairingOperationState): void => {
    if (operation.phase === "waiting-permission") {
      connectionCard.dataset.state = "connecting";
      status.textContent = "Connecting…";
      detail.textContent =
        "Allow access to this Increader instance in the browser prompt.";
      cloudButton.disabled = true;
      disconnectButton.hidden = true;
      return;
    }
    if (operation.phase === "connecting") {
      connectionCard.dataset.state = "connecting";
      status.textContent = "Connecting…";
      detail.textContent = "Approve Browser Capture in the Increader window.";
      cloudButton.disabled = true;
      disconnectButton.hidden = true;
      return;
    }
    if (operation.phase === "failed") {
      if (pairedDestination === null) {
        showDisconnected(operation.message);
      } else {
        showPaired(pairedDestination);
        status.textContent = "Could not connect";
        detail.textContent = operation.message;
      }
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
    connectionCard.dataset.state = "connecting";
    cloudButton.disabled = true;
    status.textContent = "Connecting…";
    detail.textContent = "Approve Browser Capture in the Increader window.";
    try {
      const result = await pairing.connect(origin);
      if (isDisposed()) return;
      configuredOrigin = result.origin;
      void connectionOriginPreference?.save(result.origin).catch(() => undefined);
      showPaired(result);
    } catch (error) {
      if (disposed) return;
      const message =
        error instanceof Error
          ? error.message
          : "Could not connect to a compatible Increader instance.";
      if (pairedDestination === null) {
        showDisconnected(message);
      } else {
        showPaired(pairedDestination);
        status.textContent = "Could not connect";
        detail.textContent = message;
      }
    }
  };

  const onCloudConnect = (): void => {
    connectionInteractionGeneration += 1;
    void connect(configuredOrigin);
  };
  const onSelfHostedSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    const interactionGeneration = ++connectionInteractionGeneration;
    let normalized: string;
    try {
      normalized = normalizeInstanceOrigin(originInput.value);
    } catch (error) {
      status.textContent = "Invalid connection";
      detail.textContent =
        error instanceof Error
          ? error.message
          : "Enter a valid Increader instance origin.";
      return;
    }
    void (async () => {
      try {
        await connectionOriginPreference?.save(normalized);
        if (
          isDisposed() ||
          interactionGeneration !== connectionInteractionGeneration
        ) {
          return;
        }
        configuredOrigin = normalized;
        if (pairedDestination === null) {
          showDisconnected(
            "Connection updated. Choose Connect to pair this browser.",
          );
        } else {
          showPaired(pairedDestination);
        }
        selfHostedForm.closest("details")?.removeAttribute("open");
      } catch {
        if (isDisposed()) return;
        status.textContent = "Could not save connection";
        detail.textContent = "Try saving the Increader instance again.";
      }
    })();
  };
  const onDisconnect = (): void => {
    connectionInteractionGeneration += 1;
    connectionCard.dataset.state = "connecting";
    disconnectButton.disabled = true;
    status.textContent = "Disconnecting…";
    void pairing
      .disconnect()
      .then(() => {
        if (!disposed) showDisconnected();
      })
      .catch(() => {
        if (isDisposed()) return;
        connectionCard.dataset.state = "paired";
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
  const stopObservingJob =
    pageDependencies?.captureJob?.observe(renderJobState);
  const stopObservingPairing = pairing.observe?.(renderPairingOperation);
  void pageDependencies?.captureJob
    ?.current()
    .then((state) => {
      if (state.phase !== "completed") renderJobState(state);
    })
    .catch(() => undefined);

  const initialConnectionGeneration = connectionInteractionGeneration;
  const initializeConnection = Promise.all([
    pairing.current(),
    connectionOriginPreference?.load().catch(() => null) ??
      Promise.resolve(null),
  ])
    .then(([current, preferredOrigin]) => {
      if (
        disposed ||
        initialConnectionGeneration !== connectionInteractionGeneration
      ) {
        return;
      }
      const candidate = preferredOrigin ?? current?.origin ?? CLOUD_INSTANCE_ORIGIN;
      try {
        configuredOrigin = normalizeInstanceOrigin(candidate);
      } catch {
        configuredOrigin = current?.origin ?? CLOUD_INSTANCE_ORIGIN;
      }
      if (current === null) {
        showDisconnected();
      } else {
        showPaired(current);
      }
    })
    .catch(() => undefined);
  void initializeConnection.then(() =>
    pairing
      .operation?.()
      .then((operation) => {
        if (!disposed) renderPairingOperation(operation);
      })
      .catch(() => undefined),
  );

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
    stopObservingPairing?.();
  };
}

function requiredElement(root: HTMLElement, selector: string): Element {
  const element = root.querySelector(selector);
  if (element === null) {
    throw new Error(`Popup template is missing ${selector}`);
  }
  return element;
}
