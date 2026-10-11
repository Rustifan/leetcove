import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { formatDescription } from "../src/tui/format.ts";
import { openUrl } from "../src/utils/open-url.ts";
import { binaryWatchProblem, cleanPaths, problem, temporaryPaths } from "./fixtures.ts";

describe("description images", () => {
  test("makes Binary Watch's image visible as a numbered marker with an open shortcut", () => {
    const description = formatDescription(binaryWatchProblem);
    expect(description.images).toEqual([{ url: "https://assets.leetcode.com/uploads/2021/04/08/binarywatch.jpg", label: "binarywatch.jpg" }]);
    expect(description.markdown).toContain("**Image 1: binarywatch.jpg** — press i to open");
    expect(description.markdown).toContain("A binary watch has LEDs");
    expect(description.markdown).not.toContain("![");
  });

  test("resolves HTML-encoded and relative URLs, supports lazy images and hints, and deduplicates images", () => {
    const description = formatDescription({ ...problem,
      content: '<img alt="Tree &amp; roots" src="//assets.leetcode.com/tree.png?a=1&amp;b=2"><img alt="Same image" src="https://assets.leetcode.com/tree.png?a=1&amp;b=2"><img src="data:image/gif;base64,placeholder" data-src="/static/watch.svg"><img src="javascript:alert(1)">',
      hints: ['<p>Use this diagram: <img title="Hint diagram" src="hint.png"></p>'],
    });
    expect(description.images).toEqual([
      { url: "https://assets.leetcode.com/tree.png?a=1&b=2", label: "Tree & roots" },
      { url: "https://leetcode.com/static/watch.svg", label: "watch.svg" },
      { url: "https://leetcode.com/problems/two-sum-bsts/hint.png", label: "Hint diagram" },
    ]);
    expect(description.markdown.match(/Image 1:/g)).toHaveLength(2);
    expect(description.markdown).toContain("Image 3: Hint diagram");
    expect(description.markdown).toContain("Image unavailable");
  });

  test("does not retain images when formatting another problem or a locked description", () => {
    formatDescription(binaryWatchProblem);
    expect(formatDescription(problem).images).toEqual([]);
    const locked = formatDescription({ ...problem, content: null });
    expect(locked.images).toEqual([]);
    expect(locked.markdown).toContain("requires LeetCode Premium");
  });
});

describe("URL opener", () => {
  let previousOpener: string | undefined;
  beforeEach(() => {
    previousOpener = process.env.LEETCOVE_OPENER;
    delete process.env.LEETCOVE_OPENER;
  });
  afterEach(() => {
    if (previousOpener === undefined) delete process.env.LEETCOVE_OPENER;
    else process.env.LEETCOVE_OPENER = previousOpener;
  });

  test("passes an image URL as a single argument and respects quoted opener arguments", async () => {
    const paths = await temporaryPaths();
    try {
      const script = join(dirname(paths.workspace), "opener with spaces.ts");
      const captured = join(dirname(paths.workspace), "opened.json");
      await writeFile(script, 'await Bun.write(process.argv[2] || "", JSON.stringify(process.argv.slice(3)));');
      const url = "https://assets.leetcode.com/watch.png?size=2&label=hello%20world";
      await openUrl(url, { language: "python3", urlOpener: `${process.execPath} "${script}" "${captured}" --target tab` });
      const data: unknown = JSON.parse(await readFile(captured, "utf8"));
      expect(z.array(z.string()).parse(data)).toEqual(["--target", "tab", url]);
    } finally {
      await cleanPaths(paths);
    }
  });

  test("reports missing executables and unsuccessful open commands", async () => {
    const url = "https://assets.leetcode.com/watch.png";
    await expect(openUrl(url, { language: "python3", urlOpener: join(tmpdir(), `missing-opener-${crypto.randomUUID()}`) })).rejects.toThrow("Could not start URL opener");
    await expect(openUrl(url, { language: "python3", urlOpener: "false" })).rejects.toThrow("status 1");
  });

  test("allows the environment to override the configured opener", async () => {
    process.env.LEETCOVE_OPENER = "false";
    await expect(openUrl("https://assets.leetcode.com/watch.png", { language: "python3", urlOpener: "missing-configured-opener" })).rejects.toThrow("status 1");
  });

  test("rejects unsupported links and shell operators without launching a browser", async () => {
    await expect(openUrl("javascript:alert(1)", { language: "python3", urlOpener: "false" })).rejects.toThrow("HTTP or HTTPS");
    await expect(openUrl("https://assets.leetcode.com/watch.png", { language: "python3", urlOpener: "true; false" })).rejects.toThrow("without shell operators");
  });
});
