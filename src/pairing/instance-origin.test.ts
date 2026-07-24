import { describe, expect, it } from "vitest";

import { normalizeInstanceOrigin } from "./instance-origin";

describe("Browser Capture Instance Origin", () => {
  it.each([
    ["https://app.increader.com", "https://app.increader.com"],
    ["HTTPS://Reader.Example:8443/", "https://reader.example:8443"],
    ["http://localhost:8080", "http://localhost:8080"],
    ["http://127.0.0.1", "http://127.0.0.1"],
    ["http://[::1]:18080", "http://[::1]:18080"]
  ])("accepts %s as %s", (candidate, expected) => {
    expect(normalizeInstanceOrigin(candidate)).toBe(expected);
  });

  it.each([
    "http://reader.example",
    "https://user:secret@reader.example",
    "https://reader.example/increader",
    "https://reader.example/?mode=capture",
    "https://reader.example/#capture",
    "ftp://reader.example",
    "not a URL"
  ])("rejects unsafe destination %s", (candidate) => {
    expect(() => normalizeInstanceOrigin(candidate)).toThrow(
      "Enter an HTTPS Increader origin, or loopback HTTP for local development."
    );
  });
});
