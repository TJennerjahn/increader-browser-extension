export interface OAuthWebAuthFlow {
  getRedirectUrl(): string;
  launch(url: string): Promise<string>;
}

export function createOAuthWebAuthFlow(
  api: typeof chrome.identity = chrome.identity,
  promiseApi: PromiseIdentityApi | undefined = firefoxIdentityApi(),
): OAuthWebAuthFlow {
  const identity = promiseApi ?? api;
  return {
    getRedirectUrl() {
      return identity.getRedirectURL("clerk");
    },
    async launch(url) {
      const details = { interactive: true, url };
      const callbackUrl =
        promiseApi === undefined
          ? await callbackResult<string | undefined>((done) => {
              api.launchWebAuthFlow(details, done);
            })
          : await promiseApi.launchWebAuthFlow(details);
      if (callbackUrl === undefined || callbackUrl.length === 0) {
        throw new Error("Google sign-in was canceled.");
      }
      return callbackUrl;
    },
  };
}

interface PromiseIdentityApi {
  getRedirectURL(path?: string): string;
  launchWebAuthFlow(
    details: chrome.identity.WebAuthFlowDetails,
  ): Promise<string | undefined>;
}

function firefoxIdentityApi(): PromiseIdentityApi | undefined {
  return (
    globalThis as typeof globalThis & {
      browser?: { identity?: PromiseIdentityApi };
    }
  ).browser?.identity;
}

function callbackResult<T>(
  invoke: (done: (value: T) => void) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    invoke((value) => {
      const error = chrome.runtime.lastError;
      if (error === undefined) resolve(value);
      else reject(new Error(error.message));
    });
  });
}
