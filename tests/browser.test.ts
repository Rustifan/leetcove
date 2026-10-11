import { afterEach, beforeEach, expect, test } from "bun:test";
import { browserExecutable } from "../src/utils/browser.ts";

let previousBrowser: string | undefined;

beforeEach(() => {
  previousBrowser = process.env.LEETCOVE_BROWSER;
  delete process.env.LEETCOVE_BROWSER;
});

afterEach(() => {
  if (previousBrowser === undefined) delete process.env.LEETCOVE_BROWSER;
  else process.env.LEETCOVE_BROWSER = previousBrowser;
});

test("an explicit browser path overrides a configured browser without launching it", async () => {
  process.env.LEETCOVE_BROWSER = process.execPath;
  expect(await browserExecutable({ language: "python3", browserExecutable: "missing-browser" })).toBe(process.execPath);
});

test("a missing configured browser gives an actionable error instead of selecting another browser", async () => {
  await expect(browserExecutable({ language: "python3", browserExecutable: `missing-browser-${crypto.randomUUID()}` })).rejects.toThrow("Browser executable not found");
});
