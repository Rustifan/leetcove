import { expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ScrollBoxRenderable } from "@opentui/core";
import { createTestRenderer, type TestRendererSetup } from "@opentui/core/testing";
import { LeetCove } from "../src/tui/app.ts";
import type { LeetCodeClient } from "../src/api/client.ts";
import type { Problem } from "../src/api/schemas.ts";
import { loadSettings, type AppPaths } from "../src/storage.ts";
import { openWorkspace, saveResult } from "../src/workspace.ts";
import type { UrlOpener } from "../src/utils/open-url.ts";
import { binaryWatchProblem, cleanPaths, failedSubmissionResult, fixtureClient, problem, temporaryPaths, type RecordedRequest } from "./fixtures.ts";

async function waitForText(setup: TestRendererSetup, text: string): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    await setup.flush();
    if (setup.captureCharFrame().includes(text)) return;
    await Bun.sleep(10);
  }
  expect(setup.captureCharFrame()).toContain(text);
}

async function withTestUi(paths: AppPaths, client: LeetCodeClient, run: (setup: TestRendererSetup, app: LeetCove) => Promise<void>, slug?: string, opener?: UrlOpener): Promise<void> {
  const setup = await createTestRenderer({ width: 110, height: 32 });
  const app = new LeetCove(setup.renderer, client, paths, { language: "python3" }, opener);
  try {
    await app.initialize(slug);
    await setup.flush();
    await run(setup, app);
  } finally {
    app.close();
    await app.finish();
    await setup.dispose();
  }
}

test("keyboard navigation opens a problem, switches views, runs tests, and returns to the list", async () => {
  const paths = await temporaryPaths();
  const setup = await createTestRenderer({ width: 110, height: 32 });
  const requests: RecordedRequest[] = [];
  const app = new LeetCove(setup.renderer, fixtureClient(requests), paths, { language: "python3" });
  try {
    await app.initialize();
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("Two Sum BSTs");
    setup.mockInput.pressEnter();
    await waitForText(setup, "Find two values");
    setup.mockInput.pressKey("l");
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("class Solution");
    setup.mockInput.pressKey("t");
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("Custom test inputs");
    setup.mockInput.pressKey("r");
    await waitForText(setup, "Case 2  PASS");
    expect(setup.captureCharFrame()).not.toContain("Case 3");
    expect(requests.filter((request) => request.url.endsWith("/interpret_solution/"))).toHaveLength(1);
    setup.mockInput.pressEscape();
    await waitForText(setup, "Add Two Numbers");
  } finally {
    app.close();
    await app.finish();
    await setup.dispose();
    await cleanPaths(paths);
  }
});

test("search typing cannot run or submit code, and a small terminal remains navigable", async () => {
  const paths = await temporaryPaths();
  const setup = await createTestRenderer({ width: 60, height: 20 });
  const requests: RecordedRequest[] = [];
  const app = new LeetCove(setup.renderer, fixtureClient(requests), paths, { language: "python3" });
  try {
    await app.initialize();
    setup.mockInput.pressKey("/");
    await setup.mockInput.typeText("numbers");
    setup.mockInput.pressEnter();
    await waitForText(setup, "1 of 1");
    expect(requests.some((request) => /\/(submit|interpret_solution)\/$/.test(request.url))).toBe(false);
    setup.mockInput.pressEnter();
    await waitForText(setup, "Find two values");
    setup.mockInput.pressKey("l", { shift: true });
    await waitForText(setup, "Choose solution language");
    setup.mockInput.pressKey("j");
    setup.mockInput.pressEnter();
    await waitForText(setup, "impl Solution");
  } finally {
    app.close();
    await app.finish();
    await setup.dispose();
    await cleanPaths(paths);
  }
});

test("z reveals a random language, restores its saved solution, and persists the normal language preference", async () => {
  const paths = await temporaryPaths();
  const requests: RecordedRequest[] = [];
  try {
    const python = await openWorkspace(problem, "python3", paths, { language: "python3" });
    const rust = await openWorkspace(problem, "rust", paths, { language: "python3" });
    const pythonCode = "# My saved Python solution\nclass Solution:\n    pass\n";
    const rustCode = "// My saved Rust solution\nimpl Solution {}\n";
    await writeFile(python.solution, pythonCode);
    await writeFile(rust.solution, rustCode);
    await withTestUi(paths, fixtureClient(requests), async (setup, app) => {
      const started = Date.now();
      setup.mockInput.pressKey("z");
      await waitForText(setup, "SURPRISE ME");
      expect(setup.captureCharFrame()).toContain("L A N G U A G E   R O U L E T T E");
      expect(setup.captureCharFrame()).toContain("Esc cancel");
      setup.mockInput.pressKey("z");
      setup.mockInput.pressKey("s");
      setup.mockInput.pressKey("r");
      setup.mockInput.pressKey("l", { shift: true });
      setup.resize(60, 20);
      await setup.flush();
      expect(setup.captureCharFrame()).toContain("SURPRISE ME");
      expect(setup.captureCharFrame()).toContain("Esc cancel");
      await waitForText(setup, "YOUR NEXT CHALLENGE");
      await Bun.sleep(700);
      await setup.flush();
      expect(setup.captureCharFrame()).toContain("YOUR NEXT CHALLENGE");
      await app.finish();
      await setup.flush();
      expect(Date.now() - started).toBeLessThan(4_500);
      const settings = await loadSettings(paths);
      expect(["python3", "rust"]).toContain(settings.language);
      const selectedCode = settings.language === "rust" ? "My saved Rust solution" : "My saved Python solution";
      const frame = setup.captureCharFrame();
      expect(frame).toContain(selectedCode);
      expect(frame).toContain("[SOLUTION]");
      expect(frame).toContain(`Using ${settings.language}`);
      expect(frame).not.toContain("R O U L E T T E");
      expect(await readFile(python.solution, "utf8")).toBe(pythonCode);
      expect(await readFile(rust.solution, "utf8")).toBe(rustCode);
      expect(requests.some((request) => /\/(submit|interpret_solution)\/$/.test(request.url))).toBe(false);
      setup.mockInput.pressKey("l", { shift: true });
      await waitForText(setup, "Choose solution language");
      setup.mockInput.pressEscape();
    }, problem.titleSlug);
    await withTestUi(paths, fixtureClient(), async (setup) => {
      expect(setup.captureCharFrame()).toContain("[SOLUTION]");
      expect(setup.captureCharFrame()).toContain((await loadSettings(paths)).language);
    });
  } finally {
    await cleanPaths(paths);
  }
});

test("roulette supports enhanced keyboard input and cancellation in a small terminal without changing files, language, or tab", async () => {
  const paths = await temporaryPaths();
  const setup = await createTestRenderer({ width: 60, height: 20, kittyKeyboard: true });
  const app = new LeetCove(setup.renderer, fixtureClient(), paths, { language: "python3" });
  try {
    await app.initialize(problem.titleSlug);
    setup.mockInput.pressKey("t");
    await setup.flush();
    const files = await openWorkspace(problem, "python3", paths, { language: "python3" });
    const original = await readFile(files.solution, "utf8");
    setup.mockInput.pressKey("z", { ctrl: true });
    await setup.flush();
    expect(setup.captureCharFrame()).not.toContain("SURPRISE ME");
    setup.mockInput.pressKey("z");
    await waitForText(setup, "SURPRISE ME");
    expect(setup.captureCharFrame()).toContain("Esc cancel");
    setup.mockInput.pressEscape();
    await app.finish();
    await waitForText(setup, "Language roulette cancelled.");
    expect(setup.captureCharFrame()).toContain("[TESTS]");
    expect(setup.captureCharFrame()).not.toContain("R O U L E T T E");
    expect(await loadSettings(paths)).toEqual({ language: "python3" });
    expect(await readFile(files.solution, "utf8")).toBe(original);
    expect(await Bun.file(join(files.directory, "solution.rust.rs")).exists()).toBe(false);
    setup.mockInput.pressKey("l", { shift: true });
    await waitForText(setup, "Choose solution language");
  } finally {
    app.close();
    await app.finish();
    await setup.dispose();
    await cleanPaths(paths);
  }
});

test("roulette does not intercept list search or other dialogs and handles unavailable/single languages", async () => {
  const paths = await temporaryPaths();
  const oneLanguage = { ...problem, codeSnippets: problem.codeSnippets?.slice(1) || [] };
  const unavailable = { ...problem, codeSnippets: null, content: null, titleSlug: "locked" };
  try {
    await withTestUi(paths, fixtureClient([], [oneLanguage, unavailable]), async (setup, app) => {
      setup.mockInput.pressKey("z");
      await setup.flush();
      expect(setup.captureCharFrame()).not.toContain("SURPRISE ME");
      setup.mockInput.pressKey("/");
      await setup.mockInput.typeText("z");
      await setup.flush();
      expect(setup.captureCharFrame()).not.toContain("SURPRISE ME");
      setup.mockInput.pressEscape();
      await waitForText(setup, "0 of 0");
      await app.openProblem(problem.titleSlug);
      setup.mockInput.pressKey("l", { shift: true });
      await waitForText(setup, "Choose solution language");
      setup.mockInput.pressKey("z");
      await setup.flush();
      expect(setup.captureCharFrame()).toContain("Choose solution language");
      setup.mockInput.pressEscape();
      await waitForText(setup, "[DESCRIPTION]");
      setup.mockInput.pressKey("z");
      await app.finish();
      await waitForText(setup, "Using rust");
      expect(setup.captureCharFrame()).toContain("impl Solution");
      expect(setup.captureCharFrame()).not.toContain("SURPRISE ME");
      await app.openProblem(unavailable.titleSlug);
      setup.mockInput.pressKey("z");
      await waitForText(setup, "No solution languages are available");
    });
  } finally {
    await cleanPaths(paths);
  }
});

test("closing during roulette aborts its animation and cannot persist a random choice afterward", async () => {
  const paths = await temporaryPaths();
  try {
    await withTestUi(paths, fixtureClient(), async (setup, app) => {
      setup.mockInput.pressKey("z");
      await waitForText(setup, "SURPRISE ME");
      setup.mockInput.pressKey("c", { ctrl: true });
      await app.finish();
      expect(setup.renderer.isDestroyed).toBe(true);
      expect(await loadSettings(paths)).toEqual({ language: "python3" });
      expect(await Bun.file(join(paths.workspace, "1214-two-sum-bsts", "solution.rust.rs")).exists()).toBe(false);
    }, problem.titleSlug);
  } finally {
    await cleanPaths(paths);
  }
});

test("i opens Binary Watch's single image directly and keeps the terminal usable", async () => {
  const paths = await temporaryPaths();
  const opened: string[] = [];
  const opener: UrlOpener = async (url) => { opened.push(url); };
  try {
    await withTestUi(paths, fixtureClient([], [binaryWatchProblem]), async (setup, app) => {
      expect(setup.captureCharFrame()).toContain("Image 1: binarywatch.jpg");
      expect(setup.captureCharFrame()).toContain("press i to open");
      setup.mockInput.pressKey("i");
      await waitForText(setup, "Opened image in your browser: binarywatch.jpg");
      await app.finish();
      expect(opened).toEqual(["https://assets.leetcode.com/uploads/2021/04/08/binarywatch.jpg"]);
      setup.mockInput.pressKey("v");
      await setup.flush();
      expect(setup.captureCharFrame()).toContain("[SOLUTION]");
      setup.mockInput.pressKey("i");
      await app.finish();
      expect(opened).toHaveLength(2);
      expect(setup.captureCharFrame()).toContain("[SOLUTION]");
    }, binaryWatchProblem.titleSlug, opener);
  } finally {
    await cleanPaths(paths);
  }
});

test("the image picker supports selection/cancellation and shares its dialog cleanly with language selection", async () => {
  const paths = await temporaryPaths();
  const opened: string[] = [];
  const requests: RecordedRequest[] = [];
  const opener: UrlOpener = async (url) => { opened.push(url); };
  const illustrated = { ...problem, content: '<p>Diagrams:</p><img alt="First diagram" src="https://assets.leetcode.com/first.png"><img alt="Second diagram" src="https://assets.leetcode.com/second.png">' };
  try {
    await withTestUi(paths, fixtureClient(requests, [illustrated]), async (setup, app) => {
      setup.mockInput.pressKey("i");
      await waitForText(setup, "Problem images");
      setup.mockInput.pressKey("s");
      setup.mockInput.pressEscape();
      await waitForText(setup, "[DESCRIPTION]");
      expect(opened).toEqual([]);
      expect(setup.captureCharFrame()).toContain("[DESCRIPTION]");
      setup.mockInput.pressKey("i");
      await waitForText(setup, "Problem images");
      setup.mockInput.pressKey("j");
      setup.mockInput.pressEnter();
      await waitForText(setup, "Opened image in your browser: Second diagram");
      await app.finish();
      expect(opened).toEqual(["https://assets.leetcode.com/second.png"]);
      setup.mockInput.pressKey("l", { shift: true });
      await waitForText(setup, "Choose solution language");
      setup.mockInput.pressKey("j");
      setup.mockInput.pressEnter();
      await waitForText(setup, "impl Solution");
      expect(requests.some((request) => /\/(submit|interpret_solution)\/$/.test(request.url))).toBe(false);
    }, illustrated.titleSlug, opener);
  } finally {
    await cleanPaths(paths);
  }
});

test("missing images and opener errors show feedback without breaking navigation", async () => {
  const paths = await temporaryPaths();
  const opener: UrlOpener = async () => { throw new Error("Browser could not open the image."); };
  try {
    await withTestUi(paths, fixtureClient([], [problem, binaryWatchProblem]), async (setup, app) => {
      setup.mockInput.pressKey("i");
      await waitForText(setup, "No images in this problem description.");
      await app.openProblem(binaryWatchProblem.titleSlug);
      setup.mockInput.pressKey("i");
      await waitForText(setup, "Browser could not open the image.");
      await app.finish();
      setup.mockInput.pressKey("v");
      await setup.flush();
      expect(setup.captureCharFrame()).toContain("[SOLUTION]");
    }, problem.titleSlug, opener);
  } finally {
    await cleanPaths(paths);
  }
});

test("f captures a failed submission, avoids duplicates, and sends the added input on the next run", async () => {
  const paths = await temporaryPaths();
  const requests: RecordedRequest[] = [];
  const testsPath = join(paths.workspace, "1214-two-sum-bsts", "tests.txt");
  try {
    await withTestUi(paths, fixtureClient(requests, [problem], failedSubmissionResult), async (setup, app) => {
      const original = await readFile(testsPath, "utf8");
      setup.mockInput.pressKey("f");
      await waitForText(setup, "No failing submission input");
      expect(await readFile(testsPath, "utf8")).toBe(original);
      setup.mockInput.pressKey("s");
      await waitForText(setup, "f saves this input to tests.txt.");
      await app.finish();
      expect(setup.captureCharFrame()).toContain("f saves failing input to tests.txt");
      setup.mockInput.pressKey("f");
      await waitForText(setup, "Added failing test to");
      await app.finish();
      expect(setup.captureCharFrame()).toContain("[TESTS]");
      const appended = `${original}\n[9,9]\n18\n`;
      expect(await readFile(testsPath, "utf8")).toBe(appended);
      setup.mockInput.pressKey("f");
      await waitForText(setup, "Failing test is already in");
      await app.finish();
      expect(await readFile(testsPath, "utf8")).toBe(appended);
      setup.mockInput.pressKey("r");
      await waitForText(setup, "Wrong Answer · Custom tests");
      await app.finish();
      expect(requests.find((request) => request.url.endsWith("/interpret_solution/"))?.body).toEqual(expect.objectContaining({ data_input: "[1,2]\n3\n[2,4]\n6\n[9,9]\n18" }));
      expect(requests.filter((request) => request.url.endsWith("/submit/"))).toHaveLength(1);
    }, problem.titleSlug);
  } finally {
    await cleanPaths(paths);
  }
});

test("f can capture the saved failed submission from another view after reopening a problem", async () => {
  const paths = await temporaryPaths();
  const requests: RecordedRequest[] = [];
  try {
    const files = await openWorkspace(problem, "python3", paths, { language: "python3" });
    await saveResult(files, "submit", "12345", failedSubmissionResult);
    await withTestUi(paths, fixtureClient(requests), async (setup) => {
      setup.mockInput.pressKey("v");
      await setup.flush();
      expect(setup.captureCharFrame()).toContain("[SOLUTION]");
      setup.mockInput.pressKey("f");
      await waitForText(setup, "Added failing test to");
      expect(setup.captureCharFrame()).toContain("[TESTS]");
      expect(await readFile(files.tests, "utf8")).toEndWith("\n\n[9,9]\n18\n");
      expect(requests.some((request) => request.url.endsWith("/submit/"))).toBe(false);
    }, problem.titleSlug);
  } finally {
    await cleanPaths(paths);
  }
});

test("P cycles all/free/Premium problems, resets pagination, and combines with search including empty results", async () => {
  const paths = await temporaryPaths();
  const catalog = Array.from({ length: 80 }, (_, index): Problem => ({
    ...problem, questionId: String(index + 100), questionFrontendId: String(index + 100),
    title: `Sample ${index + 100}`, titleSlug: `sample-${index + 100}`, isPaidOnly: index % 2 === 0,
  }));
  try {
    await withTestUi(paths, fixtureClient([], catalog), async (setup) => {
      setup.mockInput.pressKey("l");
      await waitForText(setup, "51–80 of 80");
      setup.mockInput.pressKey("p", { shift: true });
      await waitForText(setup, "Free only");
      expect(setup.captureCharFrame()).toContain("1–40 of 40");
      expect(setup.captureCharFrame()).toContain("Sample 101");
      expect(setup.captureCharFrame()).not.toContain("Sample 100");
      setup.mockInput.pressKey("p", { shift: true });
      await waitForText(setup, "Premium only");
      expect(setup.captureCharFrame()).toMatch(/▶[^\n]*Sample 100\s*\[Premium\]/);
      expect(setup.captureCharFrame()).not.toContain("Sample 101");
      setup.mockInput.pressKey("p", { shift: true });
      await waitForText(setup, "All problems");
      expect(setup.captureCharFrame()).toContain("1–50 of 80");
      setup.mockInput.pressKey("/");
      await setup.mockInput.typeText("Sample 101");
      setup.mockInput.pressEnter();
      await waitForText(setup, "1–1 of 1");
      setup.mockInput.pressKey("p", { shift: true });
      await waitForText(setup, "Free only");
      expect(setup.captureCharFrame()).toContain("1–1 of 1");
      setup.mockInput.pressKey("p", { shift: true });
      await waitForText(setup, "0 of 0");
      expect(setup.captureCharFrame()).toContain("Premium only");
      setup.mockInput.pressKey("p", { shift: true });
      await waitForText(setup, "All problems");
      expect(setup.captureCharFrame()).toContain("1–1 of 1");
    });
  } finally {
    await cleanPaths(paths);
  }
});

test("restart restores the problem, language, tab, and scroll position; an explicit slug overrides it", async () => {
  const paths = await temporaryPaths();
  let savedScroll = 0;
  try {
    await withTestUi(paths, fixtureClient(), async (setup, app) => {
      await app.openProblem("add-two-numbers");
      setup.mockInput.pressKey("l", { shift: true });
      await waitForText(setup, "Choose solution language");
      setup.mockInput.pressKey("j");
      setup.mockInput.pressEnter();
      await waitForText(setup, "impl Solution");
      await app.finish();
      await writeFile(join(paths.workspace, "2-add-two-numbers", "tests.txt"), Array.from({ length: 100 }, (_, index) => `${1000 + index}`).join("\n"));
      setup.mockInput.pressKey("r", { shift: true });
      await waitForText(setup, "Local files reloaded.");
      setup.mockInput.pressKey("t");
      await setup.flush();
      for (let index = 0; index < 12; index++) setup.mockInput.pressKey("j");
      await setup.flush();
      const scroll = setup.renderer.root.findDescendantById("view-tests");
      if (!(scroll instanceof ScrollBoxRenderable)) throw new Error("Tests view missing.");
      savedScroll = scroll.scrollTop;
      expect(savedScroll).toBeGreaterThan(0);
      setup.renderer.destroy();
    });

    await withTestUi(paths, fixtureClient(), async (setup) => {
      const frame = setup.captureCharFrame();
      expect(frame).toContain("Add Two Numbers");
      expect(frame).toContain("rust");
      expect(frame).toContain("[TESTS]");
      const scroll = setup.renderer.root.findDescendantById("view-tests");
      if (!(scroll instanceof ScrollBoxRenderable)) throw new Error("Tests view missing.");
      expect(scroll.scrollTop).toBe(savedScroll);
    });

    await withTestUi(paths, fixtureClient(), async (setup) => {
      expect(setup.captureCharFrame()).toContain("Two Sum BSTs");
      expect(setup.captureCharFrame()).toContain("[DESCRIPTION]");
    }, "two-sum-bsts");
  } finally {
    await cleanPaths(paths);
  }
});

test("restart restores list pagination, search, filters, and the selected problem", async () => {
  const paths = await temporaryPaths();
  const catalog = Array.from({ length: 80 }, (_, index): Problem => ({
    ...problem,
    questionId: String(index + 100),
    questionFrontendId: String(index + 100),
    title: `Sample ${index + 100}`,
    titleSlug: `sample-${index + 100}`,
    difficulty: "Easy",
  }));
  const requests: RecordedRequest[] = [];
  try {
    await withTestUi(paths, fixtureClient([], catalog), async (setup) => {
      setup.mockInput.pressKey("/");
      await setup.mockInput.typeText("sample");
      setup.mockInput.pressEnter();
      await waitForText(setup, "Search: sample");
      setup.mockInput.pressKey("d");
      await waitForText(setup, "EASY");
      setup.mockInput.pressKey("f");
      await waitForText(setup, "NOT_STARTED");
      setup.mockInput.pressKey("p", { shift: true });
      await waitForText(setup, "Free only");
      setup.mockInput.pressKey("l");
      await waitForText(setup, "51–80 of 80");
      setup.mockInput.pressKey("j");
      setup.mockInput.pressKey("j");
      await setup.flush();
      expect(setup.captureCharFrame()).toMatch(/▶[^\n]*Sample 152/);
    });

    await withTestUi(paths, fixtureClient(requests, catalog), async (setup) => {
      const frame = setup.captureCharFrame();
      expect(frame).toContain("Search: sample");
      expect(frame).toContain("51–80 of 80");
      expect(frame).toContain("EASY");
      expect(frame).toContain("NOT_STARTED");
      expect(frame).toContain("Free only");
      expect(frame).toMatch(/▶[^\n]*Sample 152/);
      expect(requests.map((request) => request.body)).toContainEqual(expect.objectContaining({
        variables: { skip: 50, limit: 50, searchKeyword: "sample", filters: {
          filterCombineType: "ALL", premiumFilter: { premiumStatus: ["NOT_PREMIUM"] },
          difficultyFilter: { difficulties: ["EASY"] }, statusFilter: { questionStatuses: ["TO_DO"], operator: "IS" },
        } },
      }));
    });
  } finally {
    await cleanPaths(paths);
  }
});
