import { describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { appendFailingTest, openWorkspace, prepareTestInput, replaceSolution, type SavedResult } from "../src/workspace.ts";
import { editorArguments, openEditor } from "../src/editor.ts";
import { cleanPaths, failedSubmissionResult, problem, temporaryPaths } from "./fixtures.ts";

const failedSubmission: SavedResult = { kind: "submit", jobId: "12345", savedAt: new Date().toISOString(), result: failedSubmissionResult };

describe("saved solutions and test inputs", () => {
  test("reopening preserves user code and language switching uses separate files", async () => {
    const paths = await temporaryPaths();
    try {
      const python = await openWorkspace(problem, "python3", paths, { language: "python3" });
      await writeFile(python.solution, "my edited solution");
      await writeFile(python.tests, "[9,9]\n18\n");
      const reopened = await openWorkspace(problem, "python3", paths, { language: "python3" });
      const rust = await openWorkspace(problem, "rust", paths, { language: "rust" });
      expect(await readFile(reopened.solution, "utf8")).toBe("my edited solution");
      expect(rust.solution).not.toBe(python.solution);
      expect(rust.tests).toBe(python.tests);
      expect(await readFile(rust.tests, "utf8")).toBe("[9,9]\n18\n");
      const backup = await replaceSolution(python, "previous submission");
      expect(await readFile(backup, "utf8")).toBe("my edited solution");
    } finally {
      await cleanPaths(paths);
    }
  });

  test("normalizes blank case separators and checks argument count", () => {
    expect(prepareTestInput("[1,2]\r\n3\r\n\r\n[2,4]\r\n6\r\n", problem)).toBe("[1,2]\n3\n[2,4]\n6");
    expect(() => prepareTestInput("[1,2]\n", problem)).toThrow("Each test needs 2");
    expect(() => prepareTestInput("hello\n3", problem)).toThrow("not JSON");
    expect(() => prepareTestInput("\n", problem)).toThrow("No test inputs");
  });

  test("keeps operation/argument arrays intact for design problems", () => {
    const design = { ...problem, metaData: JSON.stringify({ systemdesign: true, params: [{}, {}] }) };
    expect(prepareTestInput('["LRUCache","get"]\n[[2],[1]]', design)).toBe('["LRUCache","get"]\n[[2],[1]]');
  });

  test("appends a failed submission's input without rewriting existing tests and skips repeated additions", async () => {
    const paths = await temporaryPaths();
    try {
      const files = await openWorkspace(problem, "python3", paths, { language: "python3" });
      const original = "[1,2]\r\n3\r\n\r\n[2,4]\r\n6";
      await writeFile(files.tests, original);
      const saved = { ...failedSubmission, result: { ...failedSubmissionResult, last_testcase: "\r\n[9,9]\r\n18\r\n" } };
      expect(await appendFailingTest(files, problem, saved)).toBe(true);
      const appended = `${original}\n\n[9,9]\n18\n`;
      expect(await readFile(files.tests, "utf8")).toBe(appended);
      expect(prepareTestInput(appended, problem)).toBe("[1,2]\n3\n[2,4]\n6\n[9,9]\n18");
      expect(await appendFailingTest(files, problem, saved)).toBe(false);
      expect(await readFile(files.tests, "utf8")).toBe(appended);
    } finally {
      await cleanPaths(paths);
    }
  });

  test("finds existing cases without blank separators and preserves their whitespace", async () => {
    const paths = await temporaryPaths();
    try {
      const files = await openWorkspace(problem, "python3", paths, { language: "python3" });
      const original = "[1,2]\n3\n  [9,9]  \n18\n";
      await writeFile(files.tests, original);
      expect(await appendFailingTest(files, problem, failedSubmission)).toBe(false);
      expect(await readFile(files.tests, "utf8")).toBe(original);
    } finally {
      await cleanPaths(paths);
    }
  });

  test("does not mistake arguments spanning two different cases for an existing test", async () => {
    const paths = await temporaryPaths();
    try {
      const files = await openWorkspace(problem, "python3", paths, { language: "python3" });
      await writeFile(files.tests, "1\n2\n3\n4\n");
      const saved = { ...failedSubmission, result: { ...failedSubmissionResult, last_testcase: "2\n3" } };
      expect(await appendFailingTest(files, problem, saved)).toBe(true);
      expect(await readFile(files.tests, "utf8")).toBe("1\n2\n3\n4\n\n2\n3\n");
    } finally {
      await cleanPaths(paths);
    }
  });

  test("supports native-format cases with different numbers of input lines", async () => {
    const paths = await temporaryPaths();
    try {
      const manual = { ...problem, metaData: JSON.stringify({ manual: true }) };
      const files = await openWorkspace(manual, "python3", paths, { language: "python3" });
      await writeFile(files.tests, "existing\ncase\nwith\nfour lines\n");
      const saved = { ...failedSubmission, result: { ...failedSubmissionResult, last_testcase: "failing\ninput" } };
      expect(await appendFailingTest(files, manual, saved)).toBe(true);
      const appended = await readFile(files.tests, "utf8");
      expect(appended).toBe("existing\ncase\nwith\nfour lines\n\nfailing\ninput\n");
      expect(await appendFailingTest(files, manual, saved)).toBe(false);
      expect(await readFile(files.tests, "utf8")).toBe(appended);
    } finally {
      await cleanPaths(paths);
    }
  });

  test("leaves tests untouched for accepted submissions, unavailable input, and custom runs", async () => {
    const paths = await temporaryPaths();
    try {
      const files = await openWorkspace(problem, "python3", paths, { language: "python3" });
      const original = await readFile(files.tests, "utf8");
      const unavailable: (SavedResult | undefined)[] = [
        undefined,
        { ...failedSubmission, result: { ...failedSubmissionResult, status_code: 10, status_msg: "Accepted" } },
        { ...failedSubmission, result: { state: "SUCCESS", status_code: 20, status_msg: "Compile Error" } },
        { ...failedSubmission, result: { ...failedSubmissionResult, last_testcase: " \n " } },
        { ...failedSubmission, result: { ...failedSubmissionResult, status_code: undefined, state: "PENDING" } },
        { ...failedSubmission, kind: "run" },
      ];
      for (const saved of unavailable) {
        await expect(appendFailingTest(files, problem, saved)).rejects.toThrow("No failing submission input");
        expect(await readFile(files.tests, "utf8")).toBe(original);
      }
    } finally {
      await cleanPaths(paths);
    }
  });

  test("validates a reported input before appending it", async () => {
    const paths = await temporaryPaths();
    try {
      const files = await openWorkspace(problem, "python3", paths, { language: "python3" });
      const original = await readFile(files.tests, "utf8");
      const invalidJson = { ...failedSubmission, result: { ...failedSubmissionResult, last_testcase: "broken\n18" } };
      await expect(appendFailingTest(files, problem, invalidJson)).rejects.toThrow("not JSON");
      const incomplete = { ...failedSubmission, result: { ...failedSubmissionResult, last_testcase: "[9,9]" } };
      await expect(appendFailingTest(files, problem, incomplete)).rejects.toThrow("Each test needs 2");
      expect(await readFile(files.tests, "utf8")).toBe(original);
    } finally {
      await cleanPaths(paths);
    }
  });
});

describe("external editor", () => {
  test("preserves quoted editor arguments and treats the file path as one argument", () => {
    expect(editorArguments('nvim -c "set number"', "/path with spaces/test.py")).toEqual(["nvim", "-c", "set number", "/path with spaces/test.py"]);
    expect(() => editorArguments("vi; touch bad", "file")).toThrow("without shell operators");
  });

  test("resumes the terminal even when the editor fails", async () => {
    const calls: string[] = [];
    const terminal = { isDestroyed: false, suspend: async () => { calls.push("suspend"); }, resume: async () => { calls.push("resume"); } };
    await expect(openEditor("file", { language: "python3", editor: "false" }, terminal)).rejects.toThrow("status 1");
    expect(calls).toEqual(["suspend", "resume"]);
  });
});
