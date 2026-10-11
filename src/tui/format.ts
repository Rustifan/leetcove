import TurndownService from "turndown";
import type { JudgeResult, Problem, ProblemSummary, User } from "../api/schemas.ts";
import { failingSubmissionInput, type SavedResult } from "../workspace.ts";

export interface DescriptionImage {
  url: string;
  label: string;
}

export interface ProblemDescription {
  markdown: string;
  images: DescriptionImage[];
}

function imageUrl(source: string | null, base: string): string | undefined {
  if (!source?.trim()) return;
  try {
    const url = new URL(source, base);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return;
  }
}

function imageMarkdown(node: HTMLElement, images: DescriptionImage[], base: string, turndown: TurndownService): string {
  const url = imageUrl(node.getAttribute("src"), base) || imageUrl(node.getAttribute("data-src"), base);
  if (!url) return "\n\n(Image unavailable)\n\n";
  const label = terminalText(node.getAttribute("alt") || node.getAttribute("title") || new URL(url).pathname.split("/").pop() || "Image").replace(/\s+/g, " ").trim() || "Image";
  const existing = images.findIndex((image) => image.url === url);
  const index = existing >= 0 ? existing : images.push({ url, label }) - 1;
  return `\n\n**Image ${index + 1}: ${turndown.escape(images[index]?.label || label)}** — press i to open\n\n`;
}

function descriptionConverter(images: DescriptionImage[], base: string): TurndownService {
  const turndown = new TurndownService({ codeBlockStyle: "fenced", headingStyle: "atx" });
  turndown.addRule("superscript", { filter: "sup", replacement: (content) => `^${content}` });
  turndown.addRule("subscript", { filter: "sub", replacement: (content) => `_${content}` });
  turndown.addRule("examples", { filter: "pre", replacement: (_content, node) => `\n\n\`\`\`\n${(node.textContent || "").trimEnd()}\n\`\`\`\n\n` });
  turndown.addRule("images", { filter: "img", replacement: (_content, node) => imageMarkdown(node, images, base, turndown) });
  return turndown;
}

export function terminalText(value: string): string {
  return value.replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
}

export function formatDescription(problem: Problem): ProblemDescription {
  if (!problem.content) return { markdown: "This description requires LeetCode Premium. Sign in with an account that has access.", images: [] };
  const images: DescriptionImage[] = [];
  const turndown = descriptionConverter(images, `https://leetcode.com/problems/${problem.titleSlug}/`);
  const tags = problem.topicTags.map((tag) => tag.name).join(" · ");
  const content = turndown.turndown(problem.content);
  const hints = problem.hints.length ? `\n\n## Hints\n\n${problem.hints.map((hint, index) => `${index + 1}. ${turndown.turndown(hint)}`).join("\n")}` : "";
  return { markdown: terminalText(`# ${problem.questionFrontendId}. ${problem.title}\n\n${problem.difficulty}${tags ? ` · ${tags}` : ""}\n\n${content}${hints}`), images };
}

export function problemLabel(problem: ProblemSummary): string {
  const solved = problem.status === "ac" ? "✓" : problem.status ? "·" : " ";
  const number = problem.questionFrontendId.padStart(4);
  return terminalText(`${solved} ${number}  ${problem.difficulty.padEnd(6)}  ${problem.title}${problem.isPaidOnly ? "  [Premium]" : ""}`);
}

export function accountLabel(user?: User, savedUsername?: string): string {
  if (user?.isSignedIn) return `${user.username}${user.isPremium ? " · Premium" : ""}`;
  if (user) return "Guest · a to log in";
  if (savedUsername) return `${savedUsername} · checking login`;
  return "Guest";
}

export function premiumFilterLabel(premium?: boolean): string {
  if (premium === undefined) return "All problems";
  return premium ? "Premium only" : "Free only";
}

export function verdict(result: JudgeResult, kind: SavedResult["kind"]): string {
  if (result.invalid_testcase) return "Invalid testcase";
  if (kind === "submit") return result.status_msg || "Judging finished";
  if (result.status_code !== 10) return result.status_msg || "Execution failed";
  if (result.compare_result) return /^1+$/.test(result.compare_result) ? "Accepted" : "Wrong Answer";
  if (result.correct_answer === true) return "Accepted";
  if (result.correct_answer === false) return "Wrong Answer";
  return "Execution finished (comparison unavailable)";
}

function present(value: string | null | undefined): boolean {
  return typeof value === "string" && value.length > 0;
}

function resultErrors(result: JudgeResult): string[] {
  const compile = result.full_compile_error || result.compile_error;
  const runtime = result.full_runtime_error || result.runtime_error;
  return [compile, runtime].filter((value): value is string => present(value));
}

function testResults(result: JudgeResult): string[] {
  const actual = result.code_answer || [];
  const expected = result.expected_code_answer || [];
  const output = result.std_output_list || [];
  const count = result.compare_result?.length ?? result.total_testcases ?? actual.length;
  return actual.slice(0, count).flatMap((answer, index) => {
    const comparison = result.compare_result?.[index];
    const label = comparison === "1" ? "PASS" : comparison === "0" ? "FAIL" : "DONE";
    return [
      `Case ${index + 1}  ${label}`,
      `  Actual:   ${answer}`,
      expected[index] !== undefined ? `  Expected: ${expected[index]}` : "",
      output[index] ? `  Stdout:   ${output[index]}` : "",
      "",
    ];
  });
}

export function formatResult(saved?: SavedResult): string {
  if (!saved) return "No results yet.\n\nr runs your custom tests.\ns submits the saved solution to LeetCode's full judge.\n\nEdit the solution with Ctrl+E, and view/edit test inputs with t.";
  const result = saved.result;
  const lines = [
    `${verdict(result, saved.kind)}  ·  ${saved.kind === "run" ? "Test run" : "Submission"}`,
    `Job ${saved.jobId}  ·  ${new Date(saved.savedAt).toLocaleString()}`,
    "",
    `Runtime: ${result.status_runtime || "—"}    Memory: ${result.status_memory || "—"}`,
    result.total_testcases != null ? `Tests passed: ${result.total_correct ?? "—"}/${result.total_testcases}` : "",
    result.runtime_percentile != null ? `Runtime percentile: ${result.runtime_percentile.toFixed(1)}%` : "",
    result.memory_percentile != null ? `Memory percentile: ${result.memory_percentile.toFixed(1)}%` : "",
    "",
    ...resultErrors(result),
    ...testResults(result),
    result.last_testcase ? `Failing input:\n${result.last_testcase}\n` : "",
    failingSubmissionInput(saved) ? "f saves this input to tests.txt.\n" : "",
    typeof result.code_output === "string" && result.code_output ? `Actual output:\n${result.code_output}\n` : "",
    result.expected_output ? `Expected output:\n${result.expected_output}\n` : "",
    result.std_output ? `Stdout:\n${result.std_output}` : "",
    saved.kind === "submit" ? `\nhttps://leetcode.com/submissions/detail/${saved.jobId}/` : "",
  ];
  return terminalText(lines.filter((line) => line !== "").join("\n"));
}
