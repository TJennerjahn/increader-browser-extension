import type { Pairing } from "../pairing/pairing";

export const CLOUD_INSTANCE_ORIGIN = "https://app.increader.com";

export function mountPopup(root: HTMLElement, pairing: Pairing): () => void {
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
        Opening this popup does not read or send the current page.
      </p>
    </section>
  `;

  const cloudButton = requiredElement(
    root,
    "[data-cloud-connect]"
  ) as HTMLButtonElement;
  const selfHostedForm = requiredElement(
    root,
    "[data-self-hosted-form]"
  ) as HTMLFormElement;
  const originInput = requiredElement(
    root,
    "#self-hosted-origin"
  ) as HTMLInputElement;
  const status = requiredElement(root, "[data-status]") as HTMLElement;
  const detail = requiredElement(root, "[data-detail]") as HTMLElement;
  const destination = requiredElement(
    root,
    "[data-destination]"
  ) as HTMLElement;
  const disconnectButton = requiredElement(
    root,
    "[data-disconnect]"
  ) as HTMLButtonElement;
  let disposed = false;

  const showDisconnected = (message?: string): void => {
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
    destination.textContent = paired.displayName;
    status.textContent = "Paired";
    detail.textContent = `Browser Capture sends only to ${paired.origin}.`;
    cloudButton.hidden = true;
    disconnectButton.hidden = false;
  };

  const connect = async (origin: string): Promise<void> => {
    cloudButton.disabled = true;
    status.textContent = "Connecting…";
    detail.textContent = "Approve Browser Capture in the Increader window.";
    try {
      const result = await pairing.connect(origin);
      if (disposed) return;
      showPaired(result);
    } catch (error) {
      if (disposed) return;
      showDisconnected(
        error instanceof Error
          ? error.message
          : "Could not connect to a compatible Increader instance."
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
        if (disposed) return;
        status.textContent = "Could not disconnect";
        detail.textContent =
          "Increader could not revoke this installation. Try again.";
        disconnectButton.disabled = false;
      });
  };
  cloudButton.addEventListener("click", onCloudConnect);
  selfHostedForm.addEventListener("submit", onSelfHostedSubmit);
  disconnectButton.addEventListener("click", onDisconnect);

  void pairing.current().then((current) => {
    if (!disposed && current !== null) {
      showPaired(current);
    }
  });

  return () => {
    disposed = true;
    cloudButton.removeEventListener("click", onCloudConnect);
    selfHostedForm.removeEventListener("submit", onSelfHostedSubmit);
    disconnectButton.removeEventListener("click", onDisconnect);
  };
}

function requiredElement(
  root: HTMLElement,
  selector: string
): Element {
  const element = root.querySelector(selector);
  if (element === null) {
    throw new Error(`Popup template is missing ${selector}`);
  }
  return element;
}
