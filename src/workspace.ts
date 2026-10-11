import { mkdir, readFile, writeFile, copyFile, appendFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { type Problem, judgeResultSchema, type JudgeResult } from "./api/schemas.ts";
import { type AppPaths, type Settings, readOptionalJson, writeJson } from "./storage.ts";

const languageExtensions: Record<string, string> = {
  python3: "py", python: "py", javascript: "js", typescript: "ts", cpp: "cpp", c: "c",
  java: "java", csharp: "cs", golang: "go", rust: "rs", kotlin: "kt", swift: "swift",
  ruby: "rb", php: "php", dart: "dart", scala: "scala", elixir: "ex", erlang: "erl",
  racket: "rkt", bash: "sh", mysql: "sql", mssql: "sql", oraclesql: "sql", postgresql: "sql",
};

const testMetadataSchema = z.object({
  database: z.boolean().optional(),
  manual: z.boolean().optional(),
  params: z.array(z.unknown()).optional(),
});

export function languageFiletype(language: string): string {
  const overrides: Record<string, string> = { python3: "python", golang: "go", csharp: "c_sharp" };
  return overrides[language] || language;
}

export interface SolutionFiles {
  directory: string;
  solution: string;
  tests: string;
  result: string;
}

export const savedResultSchema = z.object({
  kind: z.enum(["run", "submit"]),
  jobId: z.string(),
  savedAt: z.string(),
  tests: z.string().optional(),
  result: judgeResultSchema,
});
export type SavedResult = z.infer<typeof savedResultSchema>;

async function createIfMissing(path: string, content: string): Promise<void> {
  try {
    await writeFile(path, content, { flag: "wx" });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") return;
    throw error;
  }
}

export async function openWorkspace(problem: Problem, language: string, paths: AppPaths, settings: Settings): Promise<SolutionFiles> {
  const snippet = problem.codeSnippets?.find((candidate) => candidate.langSlug === language);
  if (!snippet) throw new Error(`No ${language} starter code for this problem. Choose another language with L.`);
  if (!/^[a-z0-9]+$/.test(language)) throw new Error("Invalid language identifier.");
  const base = resolve(settings.workspace || paths.workspace);
  const directory = join(base, `${problem.questionFrontendId.replace(/[^a-zA-Z0-9-]/g, "_")}-${problem.titleSlug}`);
  const files = {
    directory,
    solution: join(directory, `solution.${language}.${languageExtensions[language] || "txt"}`),
    tests: join(directory, "tests.txt"),
    result: join(directory, `result.${language}.json`),
  };
  await mkdir(directory, { recursive: true });
  await createIfMissing(files.solution, snippet.code.replace(/\r\n/g, "\n") + "\n");
  await createIfMissing(files.tests, problem.exampleTestcaseList.join("\n\n") + "\n");
  return files;
}

export async function readSolution(files: SolutionFiles): Promise<string> {
  return readFile(files.solution, "utf8");
}

export async function readTests(files: SolutionFiles): Promise<string> {
  return readFile(files.tests, "utf8");
}

export function failingSubmissionInput(saved?: SavedResult): string | undefined {
  if (!saved || saved.kind !== "submit") return;
  const result = saved.result;
  if (result.status_code === undefined || result.status_code === 10 || result.status_msg === "Accepted" || result.invalid_testcase) return;
  return result.last_testcase?.trim() || undefined;
}

export async function appendFailingTest(files: SolutionFiles, problem: Problem, saved?: SavedResult): Promise<boolean> {
  const failingInput = failingSubmissionInput(saved);
  if (!failingInput) throw new Error("No failing submission input is available. LeetCode must report a failing test case first.");
  const input = prepareTestInput(failingInput, problem);
  const current = await readTests(files);
  if (containsTestCase(current, input, problem)) return false;
  const separator = !current || /\n\s*\n$/.test(current) ? "" : current.endsWith("\n") ? "\n" : "\n\n";
  await appendFile(files.tests, `${separator}${input}\n`);
  return true;
}

function containsTestCase(raw: string, input: string, problem: Problem): boolean {
  const candidate = testInputLines(input).map((line) => line.trim());
  const cases = raw.replace(/\r\n/g, "\n").split(/\n\s*\n/);
  if (cases.some((test) => testInputLines(test).map((line) => line.trim()).join("\n") === candidate.join("\n"))) return true;
  const metadata = parseTestMetadata(problem);
  if (!metadata.success || metadata.data.database || metadata.data.manual) return false;
  const count = metadata.data.params?.length;
  if (!count) return false;
  const existing = testInputLines(raw).map((line) => line.trim());
  return existing.some((_, index) => index % count === 0 && candidate.every((line, offset) => existing[index + offset] === line));
}

export async function saveResult(files: SolutionFiles, kind: SavedResult["kind"], jobId: string, result: JudgeResult, tests?: string): Promise<SavedResult> {
  const saved = { kind, jobId, result, tests, savedAt: new Date().toISOString() };
  await writeJson(files.result, saved);
  return saved;
}

export async function loadResult(files: SolutionFiles): Promise<SavedResult | undefined> {
  const data = await readOptionalJson(files.result);
  return data ? savedResultSchema.parse(data) : undefined;
}

export async function replaceSolution(files: SolutionFiles, code: string): Promise<string> {
  const backup = `${files.solution}.${Date.now()}.${crypto.randomUUID()}.bak`;
  await copyFile(files.solution, backup);
  await writeFile(files.solution, code);
  return backup;
}

export function prepareTestInput(raw: string, problem: Problem): string {
  const lines = testInputLines(raw);
  if (!lines.length) throw new Error("No test inputs. Press t to view tests, then Ctrl+E to edit them.");
  const parsed = parseTestMetadata(problem);
  if (!parsed.success || parsed.data.database || parsed.data.manual) return lines.join("\n");
  for (const [index, line] of lines.entries()) validateTestLine(line, index);
  const count = parsed.data.params?.length;
  if (count && lines.length % count !== 0) throw new Error(`Each test needs ${count} input lines; found ${lines.length}. Use one JSON argument per line.`);
  return lines.join("\n");
}

function testInputLines(raw: string): string[] {
  return raw.replace(/\r\n/g, "\n").split("\n").filter((line) => line.trim().length > 0);
}

function parseTestMetadata(problem: Problem) {
  const metadata: unknown = JSON.parse(problem.metaData);
  return testMetadataSchema.safeParse(metadata);
}

function validateTestLine(line: string, index: number): void {
  try {
    JSON.parse(line);
  } catch {
    throw new Error(`Test input line ${index + 1} is not JSON. Use one compact JSON argument per line (quote strings).`);
  }
}
