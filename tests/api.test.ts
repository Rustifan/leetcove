import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { LeetCodeClient, type ListOptions } from "../src/api/client.ts";
import { verdict, formatResult } from "../src/tui/format.ts";
import { fixtureClient, problem, signedInSession, summary, type RecordedRequest } from "./fixtures.ts";

describe("LeetCode judging protocol", () => {
  test("uses the internal ID and CSRF cookie; submit does not send custom tests", async () => {
    const requests: RecordedRequest[] = [];
    const client = fixtureClient(requests);
    const job = await client.start("submit", problem, "python3", "my saved code", "custom test");
    expect(job.id).toBe("12345");
    const request = requests[0];
    expect(request?.url).toEndWith("/problems/two-sum-bsts/submit/");
    expect(request?.body).toEqual({ lang: "python3", question_id: "1150", typed_code: "my saved code" });
    expect(request?.headers.get("x-csrftoken")).toBe("test-csrf");
    expect(request?.headers.get("referer")).toBe("https://leetcode.com/problems/two-sum-bsts/");
  });

  test("completed execution with a failing comparison is Wrong Answer, not Accepted", () => {
    const result = { state: "SUCCESS", status_code: 10, status_msg: "Accepted", compare_result: "10", code_answer: ["true", "false", ""], expected_code_answer: ["true", "true", ""], total_testcases: 2 };
    expect(verdict(result, "run")).toBe("Wrong Answer");
    const formatted = formatResult({ kind: "run", jobId: "runcode_test", savedAt: new Date().toISOString(), result });
    expect(formatted).toContain("Case 2  FAIL");
    expect(formatted).not.toContain("Case 3");
  });

  test("polling is cancellable and preserves the original remote job", async () => {
    const client = new LeetCodeClient(signedInSession(), async () => Response.json({ state: "PENDING" }));
    const controller = new AbortController();
    await expect(client.poll({ id: "original", kind: "run" }, () => controller.abort(), controller.signal)).rejects.toThrow();
  });

  test("never retries submission after an ambiguous transport failure", async () => {
    let calls = 0;
    const client = new LeetCodeClient(signedInSession(), async () => {
      calls++;
      throw new Error("Connection reset after sending request");
    });
    await expect(client.start("submit", problem, "python3", "code")).rejects.toThrow("Connection reset");
    expect(calls).toBe(1);
  });

  test("surfaces GraphQL errors even on HTTP 200", async () => {
    const client = new LeetCodeClient(signedInSession(), async () => Response.json({ errors: [{ message: "Not authorized" }] }));
    await expect(client.list()).rejects.toThrow("Not authorized");
  });

  test("reports Cloudflare HTML without dumping the response body or deleting the session", async () => {
    const session = signedInSession();
    const client = new LeetCodeClient(session, async () => new Response("<html>challenge-private-data</html>", { status: 403 }));
    await expect(client.user()).rejects.toThrow("browser verification");
    expect(session.signedIn).toBe(true);
  });

  test("validates API output before exposing it to the UI", async () => {
    const client = new LeetCodeClient(signedInSession(), async () => Response.json({ data: { userStatus: { isSignedIn: "yes" } } }));
    await expect(client.user()).rejects.toThrow("response changed");
  });

  test("finds the selected language beyond the first history page", async () => {
    const requestSchema = z.object({ query: z.string(), variables: z.object({ id: z.number().optional(), offset: z.number().optional() }) });
    let selectedId: number | undefined;
    const client = new LeetCodeClient(signedInSession(), async (_url, options) => {
      const request = requestSchema.parse(JSON.parse(String(options.body)));
      if (request.query.includes("submissionList") && request.variables.offset === 0) return Response.json({ data: { submissionList: { hasNext: true, submissions: [{ id: "10", lang: "rust", timestamp: "1", statusDisplay: "Accepted" }] } } });
      if (request.query.includes("submissionList")) return Response.json({ data: { submissionList: { hasNext: false, submissions: [{ id: "9", lang: "python3", timestamp: "1", statusDisplay: "Accepted" }] } } });
      selectedId = request.variables.id;
      return Response.json({ data: { submissionDetails: { code: "restored code", lang: { name: "python3" } } } });
    });
    expect(await client.previousCode(problem.titleSlug, "python3")).toBe("restored code");
    expect(selectedId).toBe(9);
  });
});

describe("Premium problem filtering", () => {
  test("filters free and Premium problems before pagination and combines existing filters", async () => {
    const requests: RecordedRequest[] = [];
    const premium = { ...problem, questionId: "1151", questionFrontendId: "1215", titleSlug: "premium-sum", isPaidOnly: true };
    const free = { ...problem, questionId: "1152", questionFrontendId: "1216", titleSlug: "another-sum" };
    const client = fixtureClient(requests, [problem, premium, free,
      { ...problem, difficulty: "Hard" },
      { ...problem, title: "Unrelated problem" },
      { ...problem, topicTags: [{ name: "Tree", slug: "tree" }] },
    ]);
    const options: ListOptions = { premium: false, skip: 1, limit: 1, search: "sum", difficulty: "MEDIUM", tags: ["array"], status: "NOT_STARTED" };
    const freePage = await client.list(options);
    expect(freePage.total).toBe(2);
    expect(freePage.questions).toEqual([summary(free)]);
    expect(requests[0]?.body).toEqual(expect.objectContaining({ variables: {
      skip: 1, limit: 1, searchKeyword: "sum",
      filters: {
        filterCombineType: "ALL",
        premiumFilter: { premiumStatus: ["NOT_PREMIUM"] },
        difficultyFilter: { difficulties: ["MEDIUM"] },
        topicFilter: { topicSlugs: ["array"], operator: "IS" },
        statusFilter: { questionStatuses: ["TO_DO"], operator: "IS" },
      },
    } }));
    const premiumPage = await client.list({ ...options, premium: true, skip: 0 });
    expect(premiumPage.total).toBe(1);
    expect(premiumPage.questions).toEqual([summary(premium)]);
    expect(requests[1]?.body).toEqual(expect.objectContaining({ variables: expect.objectContaining({ filters: expect.objectContaining({ premiumFilter: { premiumStatus: ["PREMIUM"] } }) }) }));
  });

  test("normalizes native IDs, difficulty, acceptance rate, and solved/attempted status", async () => {
    const questions = ["SOLVED", "ATTEMPTED", "TO_DO"].map((status) => ({
      ...summary(problem), id: 1150, paidOnly: true, difficulty: "MEDIUM", status, acRate: 0.42,
    }));
    const client = new LeetCodeClient(signedInSession(), async () => Response.json({ data: { problemsetQuestionListV2: { totalLength: 3, questions } } }));
    const page = await client.list({ premium: true });
    expect(page.questions.map((question) => question.status)).toEqual(["ac", "notac", null]);
    expect(page.questions[0]).toEqual(expect.objectContaining({ questionId: "1150", questionFrontendId: "1214", difficulty: "Medium", acRate: 42, isPaidOnly: true }));
  });
});
