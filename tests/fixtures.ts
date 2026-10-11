import { CookieJar } from "tough-cookie";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { LeetCodeClient, type Fetcher } from "../src/api/client.ts";
import type { JudgeResult, Problem, ProblemSummary, User } from "../src/api/schemas.ts";
import { Session } from "../src/auth/session.ts";
import type { AppPaths } from "../src/storage.ts";

export async function temporaryPaths(): Promise<AppPaths> {
  const root = await mkdtemp(join(tmpdir(), "leetcove-test-"));
  return { config: join(root, "config"), state: join(root, "state"), cache: join(root, "cache"), workspace: join(root, "solutions") };
}

export async function cleanPaths(paths: AppPaths): Promise<void> {
  await rm(dirname(paths.workspace), { recursive: true, force: true });
}

export const problem: Problem = {
  questionId: "1150", questionFrontendId: "1214", title: "Two Sum BSTs", titleSlug: "two-sum-bsts",
  difficulty: "Medium", isPaidOnly: false,
  content: "<p>Find two values with the given sum.</p><pre>Input: [1,2]\nOutput: true</pre><p>Constraints: 1 &lt;= n &lt;= 10<sup>4</sup></p>",
  codeSnippets: [
    { lang: "Python3", langSlug: "python3", code: "class Solution:\n    def solve(self, nums, target):\n        pass" },
    { lang: "Rust", langSlug: "rust", code: "impl Solution {\n    pub fn solve() {}\n}" },
  ],
  exampleTestcaseList: ["[1,2]\n3", "[2,4]\n6"],
  metaData: JSON.stringify({ params: [{ name: "nums", type: "integer[]" }, { name: "target", type: "integer" }] }),
  topicTags: [{ name: "Array", slug: "array" }], hints: [], enableRunCode: true, enableSubmit: true,
};

export const secondProblem: Problem = { ...problem, questionId: "2", questionFrontendId: "2", title: "Add Two Numbers", titleSlug: "add-two-numbers" };
export const binaryWatchProblem: Problem = {
  ...problem, questionId: "401", questionFrontendId: "401", title: "Binary Watch", titleSlug: "binary-watch",
  content: '<p>A binary watch has LEDs representing hours and minutes.</p><p><img alt="" src="https://assets.leetcode.com/uploads/2021/04/08/binarywatch.jpg" /></p>',
};

export function summary(item: Problem): ProblemSummary {
  return { questionId: item.questionId, questionFrontendId: item.questionFrontendId, title: item.title, titleSlug: item.titleSlug, difficulty: item.difficulty, isPaidOnly: item.isPaidOnly, acRate: 50, status: null, topicTags: item.topicTags };
}

export function signedInSession(): Session {
  const jar = new CookieJar();
  jar.setCookieSync("LEETCODE_SESSION=test-session; Secure; Path=/", "https://leetcode.com");
  jar.setCookieSync("csrftoken=test-csrf; Secure; Path=/", "https://leetcode.com");
  return new Session(jar);
}

export interface RecordedRequest {
  url: string;
  body: unknown;
  headers: Headers;
}

const querySchema = z.object({ query: z.string(), variables: z.record(z.string(), z.unknown()).default({}) });
const premiumListVariablesSchema = z.object({
  skip: z.number(),
  limit: z.number(),
  searchKeyword: z.string(),
  filters: z.object({
    filterCombineType: z.literal("ALL"),
    premiumFilter: z.object({ premiumStatus: z.array(z.enum(["PREMIUM", "NOT_PREMIUM"])) }),
    difficultyFilter: z.object({ difficulties: z.array(z.string()) }).optional(),
    topicFilter: z.object({ topicSlugs: z.array(z.string()), operator: z.literal("IS") }).optional(),
    statusFilter: z.object({ questionStatuses: z.array(z.enum(["SOLVED", "ATTEMPTED", "TO_DO"])), operator: z.literal("IS") }).optional(),
  }),
});

function fixturePremiumPage(variables: unknown, catalog: Problem[]): Response {
  const { skip, limit, searchKeyword, filters } = premiumListVariablesSchema.parse(variables);
  const matches = catalog.filter((item) => item.isPaidOnly === (filters.premiumFilter.premiumStatus[0] === "PREMIUM"))
    .filter((item) => !searchKeyword || item.title.toLowerCase().includes(searchKeyword.toLowerCase()))
    .filter((item) => !filters.difficultyFilter || filters.difficultyFilter.difficulties.includes(item.difficulty.toUpperCase()))
    .filter((item) => !filters.topicFilter || item.topicTags.some((tag) => filters.topicFilter?.topicSlugs.includes(tag.slug)))
    .filter(() => !filters.statusFilter || filters.statusFilter.questionStatuses.includes("TO_DO"));
  const questions = matches.slice(skip, skip + limit).map((item) => {
    const { questionId, isPaidOnly, ...question } = summary(item);
    return { ...question, id: Number(questionId), paidOnly: isPaidOnly, difficulty: item.difficulty.toUpperCase(), status: "TO_DO", acRate: question.acRate / 100 };
  });
  return Response.json({ data: { problemsetQuestionListV2: { totalLength: matches.length, questions } } });
}

const acceptedResult: JudgeResult = { state: "SUCCESS", status_code: 10, status_msg: "Accepted", compare_result: "11", code_answer: ["true", "true", ""], expected_code_answer: ["true", "true", ""], total_correct: 2, total_testcases: 2 };
export const failedSubmissionResult: JudgeResult = { state: "SUCCESS", status_code: 11, status_msg: "Wrong Answer", last_testcase: "[9,9]\n18", code_output: "false", expected_output: "true", total_correct: 1, total_testcases: 10 };

const defaultUser: User = { username: "tester", isSignedIn: true, isPremium: false, isVerified: true };

export function fixtureClient(requests: RecordedRequest[] = [], catalog: Problem[] = [problem, secondProblem], result: JudgeResult = acceptedResult, user: User = defaultUser): LeetCodeClient {
  const fetcher: Fetcher = async (url, options) => {
    const body: unknown = typeof options.body === "string" ? JSON.parse(options.body) : undefined;
    requests.push({ url, body, headers: new Headers(options.headers) });
    if (url.endsWith("/interpret_solution/")) return Response.json({ interpret_id: "runcode_test" });
    if (url.endsWith("/submit/")) return Response.json({ submission_id: 12345 });
    if (url.endsWith("/check/")) return Response.json(result);
    const query = querySchema.parse(body);
    if (query.query.includes("userStatus")) return Response.json({ data: { userStatus: user } });
    if (query.query.includes("problemsetQuestionListV2(")) return fixturePremiumPage(query.variables, catalog);
    if (query.query.includes("questionList(")) {
      const filters = z.object({ searchKeywords: z.string().optional(), difficulty: z.string().optional() }).parse(query.variables.filters);
      const pagination = z.object({ skip: z.number(), limit: z.number() }).parse(query.variables);
      const matches = catalog.filter((item) => !filters.searchKeywords || item.title.toLowerCase().includes(filters.searchKeywords.toLowerCase()))
        .filter((item) => !filters.difficulty || item.difficulty.toUpperCase() === filters.difficulty);
      const questions = matches.slice(pagination.skip, pagination.skip + pagination.limit).map(summary);
      return Response.json({ data: { problemsetQuestionList: { total: matches.length, questions } } });
    }
    return Response.json({ data: { question: catalog.find((item) => item.titleSlug === query.variables.titleSlug) || problem } });
  };
  return new LeetCodeClient(signedInSession(), fetcher);
}
