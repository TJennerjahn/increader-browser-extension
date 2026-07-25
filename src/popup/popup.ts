import {
  CLOUD_INSTANCE_ORIGIN,
  type Authentication,
} from "../auth/authentication";
import type {
  ActivePageInspection,
  ActivePageInspector,
} from "../browser/active-page";
import type { BookmarkLookupClient } from "../protocol/bookmark-lookup-http";
import type { CaptureJobClient } from "../browser/capture-job-runtime";
import type { CaptureJobState } from "../capture-job/capture-job";
import { normalizeInstanceOrigin } from "../auth/instance-origin";

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
  authentication: Authentication,
  pageDependencies?: PopupPageDependencies,
  connectionOriginPreference?: ConnectionOriginPreference,
): () => void {
  root.innerHTML = `
    <section class="popup-shell" aria-label="Increader Browser Capture">
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
        <button
          class="header-action btn btn-ghost"
          type="button"
          data-view-toggle
          aria-label="Open instance settings"
        >
          <svg data-back-icon viewBox="0 0 24 24" aria-hidden="true" hidden>
            <path d="m15 18-6-6 6-6"></path>
          </svg>
          <svg data-settings-icon viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"></path>
            <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06-.06A1.7 1.7 0 0 0 19.4 9c.14.37.35.7.6 1 .3.25.68.4 1.1.4H21a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15z"></path>
          </svg>
        </button>
      </header>

      <section class="popup-view login-view" data-login-view>
        <div class="auth-heading">
          <p class="auth-eyebrow">Welcome back</p>
          <h2>Sign in to Increader</h2>
        </div>

        <p class="auth-feedback" data-auth-feedback role="status" hidden></p>

        <button
          class="google-action btn btn-outline btn-block"
          type="button"
          data-google-sign-in
        >
          <svg class="google-mark" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285f4" d="M23.49 12.27c0-.78-.07-1.53-.2-2.27H12v4.3h6.46c-.28 1.45-1.12 2.68-2.38 3.51v2.9h3.85c2.25-2.07 3.56-5.12 3.56-8.44z"></path>
            <path fill="#34a853" d="M12 24c3.24 0 5.96-1.07 7.95-2.89l-3.85-2.9c-1.08.72-2.46 1.15-4.1 1.15-3.15 0-5.82-2.13-6.78-4.99H1.24v3.05A11.99 11.99 0 0 0 12 24z"></path>
            <path fill="#fbbc05" d="M5.22 14.37A7.2 7.2 0 0 1 4.85 12c0-.82.15-1.62.37-2.37V6.58H1.24A12 12 0 0 0 0 12c0 1.93.46 3.75 1.24 5.42l3.98-3.05z"></path>
            <path fill="#ea4335" d="M12 4.75c1.76 0 3.33.6 4.58 1.78L20 3.11C17.94 1.17 15.22 0 12 0A11.99 11.99 0 0 0 1.24 6.58l3.98 3.05C6.18 6.88 8.85 4.75 12 4.75z"></path>
          </svg>
          Continue with Google
        </button>

        <div class="auth-divider" data-cloud-divider>
          <span></span>
          <span>or</span>
          <span></span>
        </div>

        <form class="login-form" data-login-form>
          <label class="label" for="login-email">
            <span class="label-text">Email</span>
          </label>
          <input
            class="input input-bordered"
            id="login-email"
            name="email"
            type="email"
            autocomplete="email"
            placeholder="you@example.com"
            required
          />
          <div class="label">
            <label class="label-text" for="login-password">Password</label>
            <button class="forgot-action" type="button" data-forgot-password>
              Forgot?
            </button>
          </div>
          <input
            class="input input-bordered"
            id="login-password"
            name="password"
            type="password"
            autocomplete="current-password"
            required
          />
          <button
            class="primary-action btn btn-primary btn-block"
            type="submit"
            data-sign-in
          >
            Sign in
          </button>
        </form>
        <p class="instance-hint">
          Connecting to <span data-login-origin>Increader Cloud</span>
        </p>
      </section>

      <section class="popup-view settings-view" data-settings-view hidden>
        <div class="view-heading">
          <p class="eyebrow">Settings</p>
          <h2>Increader instance</h2>
        </div>

        <form class="settings-form card card-surface" data-origin-form>
          <label class="label" for="self-hosted-origin">
            <span class="label-text">Instance URL</span>
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
            class="primary-action btn btn-primary btn-block"
            type="submit"
            data-save-origin
          >
            Save
          </button>
        </form>

        <section
          class="connection-card card card-surface"
          data-connection-card
          data-state="disconnected"
          aria-live="polite"
        >
          <div class="card-body">
            <div class="section-heading">
              <div class="section-copy">
                <p class="eyebrow">Account</p>
                <p class="connection-status" data-status>Signed out</p>
              </div>
              <button
                class="disconnect-action btn btn-ghost"
                type="button"
                data-sign-out
                hidden
              >
                Sign out
              </button>
            </div>
            <p class="connection-detail" data-detail>
              Sign in before importing the current page.
            </p>
          </div>
        </section>
      </section>

      <section class="popup-view main-view" data-main-view hidden>
      <section
        class="page-card card card-surface"
        data-page-card
        aria-live="polite"
        hidden
      >
        <div class="card-body">
          <div class="page-heading">
            <span class="page-icon" aria-hidden="true">
              <img class="page-favicon" data-page-favicon alt="" hidden />
              <svg data-page-favicon-fallback viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="9"></circle>
                <path d="M3 12h18"></path>
                <path d="M12 3a15 15 0 0 1 0 18"></path>
                <path d="M12 3a15 15 0 0 0 0 18"></path>
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
        </div>
      </section>

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

      </section>
    </section>
  `;

  const loginView = requiredElement(root, "[data-login-view]") as HTMLElement;
  const mainView = requiredElement(root, "[data-main-view]") as HTMLElement;
  const settingsView = requiredElement(
    root,
    "[data-settings-view]",
  ) as HTMLElement;
  const viewToggle = requiredElement(
    root,
    "[data-view-toggle]",
  ) as HTMLButtonElement;
  const backIcon = requiredElement(root, "[data-back-icon]") as SVGElement;
  const settingsIcon = requiredElement(
    root,
    "[data-settings-icon]",
  ) as SVGElement;
  const loginForm = requiredElement(
    root,
    "[data-login-form]",
  ) as HTMLFormElement;
  const originForm = requiredElement(
    root,
    "[data-origin-form]",
  ) as HTMLFormElement;
  const originInput = requiredElement(
    root,
    "#self-hosted-origin",
  ) as HTMLInputElement;
  const emailInput = requiredElement(root, "#login-email") as HTMLInputElement;
  const passwordInput = requiredElement(
    root,
    "#login-password",
  ) as HTMLInputElement;
  const signInButton = requiredElement(
    root,
    "[data-sign-in]",
  ) as HTMLButtonElement;
  const googleSignInButton = requiredElement(
    root,
    "[data-google-sign-in]",
  ) as HTMLButtonElement;
  const cloudDivider = requiredElement(
    root,
    "[data-cloud-divider]",
  ) as HTMLElement;
  const forgotPasswordButton = requiredElement(
    root,
    "[data-forgot-password]",
  ) as HTMLButtonElement;
  const authFeedback = requiredElement(
    root,
    "[data-auth-feedback]",
  ) as HTMLElement;
  const loginOrigin = requiredElement(
    root,
    "[data-login-origin]",
  ) as HTMLElement;
  const connectionCard = requiredElement(
    root,
    "[data-connection-card]",
  ) as HTMLElement;
  const status = requiredElement(root, "[data-status]") as HTMLElement;
  const detail = requiredElement(root, "[data-detail]") as HTMLElement;
  const signOutButton = requiredElement(
    root,
    "[data-sign-out]",
  ) as HTMLButtonElement;
  const pageCard = requiredElement(root, "[data-page-card]") as HTMLElement;
  const pageFavicon = requiredElement(
    root,
    "[data-page-favicon]",
  ) as HTMLImageElement;
  const pageFaviconFallback = requiredElement(
    root,
    "[data-page-favicon-fallback]",
  ) as SVGElement;
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
  let authenticatedDestination: {
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

  const showSettingsView = (): void => {
    loginView.hidden = true;
    mainView.hidden = true;
    settingsView.hidden = false;
    backIcon.removeAttribute("hidden");
    settingsIcon.setAttribute("hidden", "");
    viewToggle.ariaLabel =
      authenticatedDestination === null ? "Back to sign in" : "Back to import";
  };

  const showLoginView = (): void => {
    settingsView.hidden = true;
    mainView.hidden = true;
    loginView.hidden = false;
    backIcon.setAttribute("hidden", "");
    settingsIcon.removeAttribute("hidden");
    viewToggle.ariaLabel = "Open instance settings";
  };

  const showMainView = (): void => {
    loginView.hidden = true;
    settingsView.hidden = true;
    mainView.hidden = false;
    backIcon.setAttribute("hidden", "");
    settingsIcon.removeAttribute("hidden");
    viewToggle.ariaLabel = "Open instance settings";
  };

  const renderConfiguredOrigin = (): void => {
    originInput.value = configuredOrigin;
    const cloud = configuredOrigin === CLOUD_INSTANCE_ORIGIN;
    loginOrigin.textContent = cloud ? "Increader Cloud" : configuredOrigin;
    googleSignInButton.hidden = !cloud;
    cloudDivider.hidden = !cloud;
    forgotPasswordButton.hidden = !cloud;
  };

  const showFaviconFallback = (): void => {
    pageFavicon.hidden = true;
    pageFaviconFallback.removeAttribute("hidden");
  };

  const renderPageFavicon = (faviconUrl?: string): void => {
    pageFavicon.removeAttribute("src");
    if (faviconUrl === undefined) {
      showFaviconFallback();
      return;
    }
    pageFaviconFallback.setAttribute("hidden", "");
    pageFavicon.hidden = false;
    pageFavicon.src = faviconUrl;
  };

  const showDisconnected = (message?: string): void => {
    connectionCard.dataset.state = "disconnected";
    authenticatedDestination = null;
    currentPage = null;
    existingBookmarkId = null;
    readerOrigin = null;
    pageGeneration += 1;
    importActive = false;
    pageCard.hidden = true;
    renderConfiguredOrigin();
    status.textContent = "Signed out";
    detail.textContent = "Sign in before importing the current page.";
    authFeedback.textContent = message ?? "";
    authFeedback.hidden = message === undefined;
    signInButton.disabled = false;
    googleSignInButton.disabled = false;
    signOutButton.hidden = true;
    showLoginView();
  };

  const showAuthenticated = (destination: {
    displayName: string;
    origin: string;
  }): void => {
    connectionCard.dataset.state = "authenticated";
    authenticatedDestination = destination;
    configuredOrigin = destination.origin;
    renderConfiguredOrigin();
    status.textContent = "Signed in";
    detail.textContent = destination.displayName;
    authFeedback.hidden = true;
    signInButton.disabled = false;
    googleSignInButton.disabled = false;
    signOutButton.hidden = false;
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
      authenticatedDestination === null
    ) {
      return;
    }
    pageCard.hidden = false;
    renderPageFavicon(inspected.faviconUrl);
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
      const accessToken = await authentication.accessToken();
      const result = await pageDependencies?.lookup.lookup(
        authenticatedDestination.origin,
        accessToken,
        inspected.sourceUrl,
      );
      if (isDisposed() || generation !== pageGeneration) {
        return;
      }
      importButton.disabled = false;
      if (result?.exists === true && result.bookmarkId !== undefined) {
        existingBookmarkId = result.bookmarkId;
        readerOrigin = authenticatedDestination.origin;
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
          : "Sign in again and try once more.";
      importButton.disabled = true;
      renderJobState(currentJobState);
    }
  };

  async function refreshPage(): Promise<void> {
    if (
      pageDependencies === undefined ||
      authenticatedDestination === null ||
      importActive
    ) {
      return;
    }
    const generation = ++pageGeneration;
    pageCard.hidden = false;
    renderPageFavicon();
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

  const signIn = async (
    origin: string,
    email: string,
    password: string,
  ): Promise<void> => {
    connectionCard.dataset.state = "connecting";
    signInButton.disabled = true;
    googleSignInButton.disabled = true;
    authFeedback.textContent = "Checking your Increader account…";
    authFeedback.hidden = false;
    status.textContent = "Signing in…";
    detail.textContent = "Checking your Increader account.";
    try {
      const result = await authentication.signIn(origin, email, password);
      if (isDisposed()) return;
      configuredOrigin = result.origin;
      void connectionOriginPreference
        ?.save(result.origin)
        .catch(() => undefined);
      passwordInput.value = "";
      showAuthenticated(result);
      showMainView();
    } catch (error) {
      if (disposed) return;
      const message =
        error instanceof Error
          ? error.message
          : "Increader could not sign you in.";
      if (authenticatedDestination === null) {
        showDisconnected(message);
      } else {
        showAuthenticated(authenticatedDestination);
        status.textContent = "Could not sign in";
        detail.textContent = message;
      }
    }
  };

  const onLoginSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    connectionInteractionGeneration += 1;
    void signIn(configuredOrigin, emailInput.value, passwordInput.value);
  };
  const onGoogleSignIn = (): void => {
    if (configuredOrigin !== CLOUD_INSTANCE_ORIGIN) return;
    connectionInteractionGeneration += 1;
    signInButton.disabled = true;
    googleSignInButton.disabled = true;
    authFeedback.textContent = "Finish Google sign-in in the tab that opens.";
    authFeedback.hidden = false;
    void authentication
      .signInWithGoogle()
      .then((result) => {
        if (isDisposed()) return;
        configuredOrigin = result.origin;
        void connectionOriginPreference
          ?.save(result.origin)
          .catch(() => undefined);
        showAuthenticated(result);
        showMainView();
      })
      .catch((error: unknown) => {
        if (isDisposed()) return;
        showDisconnected(
          error instanceof Error
            ? error.message
            : "Increader could not complete Google sign-in.",
        );
      });
  };
  const onOriginSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    connectionInteractionGeneration += 1;
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
    const changed =
      authenticatedDestination !== null &&
      authenticatedDestination.origin !== normalized;
    configuredOrigin = normalized;
    renderConfiguredOrigin();
    void (async () => {
      await connectionOriginPreference?.save(normalized);
      if (changed) await authentication.signOut();
      if (isDisposed()) return;
      if (changed || authenticatedDestination === null) {
        showDisconnected();
      } else {
        showMainView();
      }
    })().catch((error: unknown) => {
      if (isDisposed()) return;
      status.textContent = "Could not save instance";
      detail.textContent =
        error instanceof Error ? error.message : "Try saving the URL again.";
    });
  };
  const onForgotPassword = (): void => {
    void pageDependencies?.openReader(
      `${CLOUD_INSTANCE_ORIGIN}/forgot-password`,
    );
  };
  const onSignOut = (): void => {
    connectionInteractionGeneration += 1;
    connectionCard.dataset.state = "connecting";
    signOutButton.disabled = true;
    status.textContent = "Signing out…";
    void authentication
      .signOut()
      .then(() => {
        if (!disposed) showDisconnected();
      })
      .catch(() => {
        if (isDisposed()) return;
        connectionCard.dataset.state = "authenticated";
        status.textContent = "Could not sign out";
        detail.textContent = "Try signing out again.";
        signOutButton.disabled = false;
      });
  };
  const onViewToggle = (): void => {
    connectionInteractionGeneration += 1;
    if (settingsView.hidden) {
      showSettingsView();
    } else if (authenticatedDestination === null) {
      showLoginView();
    } else {
      showMainView();
    }
  };
  const onImport = (): void => {
    if (
      pageDependencies === undefined ||
      currentPage === null ||
      authenticatedDestination === null ||
      importActive
    ) {
      return;
    }
    const expectedPage = currentPage;
    const destinationOrigin = authenticatedDestination.origin;
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

  viewToggle.addEventListener("click", onViewToggle);
  pageFavicon.addEventListener("error", showFaviconFallback);
  loginForm.addEventListener("submit", onLoginSubmit);
  originForm.addEventListener("submit", onOriginSubmit);
  googleSignInButton.addEventListener("click", onGoogleSignIn);
  forgotPasswordButton.addEventListener("click", onForgotPassword);
  signOutButton.addEventListener("click", onSignOut);
  importButton.addEventListener("click", onImport);
  openReaderButton.addEventListener("click", onOpenReader);
  cancelButton.addEventListener("click", onCancel);
  retryButton.addEventListener("click", onRetry);
  discardButton.addEventListener("click", onDiscard);
  const stopObserving = pageDependencies?.activePage.observe(() => {
    if (authenticatedDestination !== null && !importActive) {
      void refreshPage();
    }
  });
  const stopObservingJob =
    pageDependencies?.captureJob?.observe(renderJobState);
  void pageDependencies?.captureJob
    ?.current()
    .then((state) => {
      if (state.phase !== "completed") renderJobState(state);
    })
    .catch(() => undefined);

  const initialConnectionGeneration = connectionInteractionGeneration;
  const initializeConnection = Promise.all([
    authentication.current(),
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
      const candidate =
        preferredOrigin ?? current?.origin ?? CLOUD_INSTANCE_ORIGIN;
      try {
        configuredOrigin = normalizeInstanceOrigin(candidate);
      } catch {
        configuredOrigin = current?.origin ?? CLOUD_INSTANCE_ORIGIN;
      }
      if (current === null) {
        showDisconnected();
      } else {
        emailInput.value = current.email;
        showAuthenticated(current);
        showMainView();
      }
    })
    .catch(() => undefined);
  void initializeConnection;

  return () => {
    disposed = true;
    if (retryRevealTimeout !== null) {
      globalThis.clearTimeout(retryRevealTimeout);
    }
    viewToggle.removeEventListener("click", onViewToggle);
    pageFavicon.removeEventListener("error", showFaviconFallback);
    loginForm.removeEventListener("submit", onLoginSubmit);
    originForm.removeEventListener("submit", onOriginSubmit);
    googleSignInButton.removeEventListener("click", onGoogleSignIn);
    forgotPasswordButton.removeEventListener("click", onForgotPassword);
    signOutButton.removeEventListener("click", onSignOut);
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
