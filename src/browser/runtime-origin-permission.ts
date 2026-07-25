interface ExtensionRuntime {
  getURL?(path: string): string;
}

export function runtimeOriginPermissionPattern(
  originOrPattern: string,
  runtime: ExtensionRuntime = chrome.runtime,
): string {
  const origin = originOrPattern.endsWith("/*")
    ? originOrPattern.slice(0, -2)
    : originOrPattern;
  const exactPattern = originOrPattern.endsWith("/*")
    ? originOrPattern
    : `${origin}/*`;
  if (!runtime.getURL?.("").startsWith("moz-extension://")) {
    return exactPattern;
  }
  const parsed = new URL(origin);
  return `${parsed.protocol}//${parsed.hostname}/*`;
}
