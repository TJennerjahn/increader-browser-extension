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
  let disposed = false;

  const discover = async (origin: string): Promise<void> => {
    cloudButton.disabled = true;
    status.textContent = "Checking destination…";
    detail.textContent = "Confirming Browser Capture compatibility.";
    try {
      const result = await pairing.discover(origin);
      if (disposed) return;
      destination.textContent = result.displayName;
      status.textContent = result.pairingAvailable
        ? "Ready to pair"
        : "Pairing unavailable";
      detail.textContent = result.pairingAvailable
        ? "This Increader instance supports Browser Capture."
        : "This instance is compatible but is not accepting new pairings.";
      cloudButton.hidden = true;
    } catch (error) {
      if (disposed) return;
      status.textContent = "Not connected";
      detail.textContent =
        error instanceof Error
          ? error.message
          : "Could not connect to a compatible Increader instance.";
      cloudButton.disabled = false;
    }
  };

  const onCloudConnect = (): void => {
    void discover(CLOUD_INSTANCE_ORIGIN);
  };
  const onSelfHostedSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    void discover(originInput.value);
  };
  cloudButton.addEventListener("click", onCloudConnect);
  selfHostedForm.addEventListener("submit", onSelfHostedSubmit);

  void pairing.currentOrigin().then((origin) => {
    if (!disposed && origin !== null) {
      void discover(origin);
    }
  });

  return () => {
    disposed = true;
    cloudButton.removeEventListener("click", onCloudConnect);
    selfHostedForm.removeEventListener("submit", onSelfHostedSubmit);
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
