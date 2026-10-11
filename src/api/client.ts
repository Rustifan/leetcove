import { z } from "zod";
import { Session, LEETCODE_URL } from "../auth/session.ts";
import { delay } from "../utils/errors.ts";
import {
  jobSchema, judgeResultSchema, previousCodeSchema, problemPageSchema, problemPageV2Schema, problemSchema,
  submissionListSchema, userSchema, type JudgeResult, type Problem, type ProblemPage, type User,
} from "./schemas.ts";
import { LIST_QUERY, PREMIUM_LIST_QUERY, PROBLEM_QUERY, SUBMISSIONS_QUERY, SUBMISSION_CODE_QUERY, USER_QUERY } from "./queries.ts";

const graphErrorSchema = z.object({ errors: z.array(z.object({ message: z.string() })).optional() });

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ListOptions {
  search?: string;
  skip?: number;
  limit?: number;
  difficulty?: "EASY" | "MEDIUM" | "HARD";
  tags?: string[];
  status?: "AC" | "TRIED" | "NOT_STARTED";
  premium?: boolean;
}

export interface JudgeJob {
  id: string;
  kind: "run" | "submit";
  testInput?: string;
}

export type Fetcher = (url: string, options: RequestInit) => Promise<Response>;

export class LeetCodeClient {
  constructor(public session: Session, private readonly fetcher: Fetcher = fetch) {}

  private async request(path: string, body?: unknown, signal?: AbortSignal, slug?: string): Promise<unknown> {
    const url = `${LEETCODE_URL}${path}`;
    const response = await this.fetcher(url, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Origin: LEETCODE_URL,
        Referer: slug ? `${LEETCODE_URL}/problems/${slug}/` : `${LEETCODE_URL}/`,
        ...this.session.headers(url),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]),
    });
    await this.session.update(response, url);
    if (response.status === 429) throw new ApiError("LeetCode rate limit: wait a moment before trying again.", 429);
    if (response.status === 401) throw new ApiError("Login expired. Press a to sign in again.", 401);
    if (response.status === 403) throw new ApiError("LeetCode denied this request. Complete browser verification or sign in again.", 403);
    if (!response.ok) throw new ApiError(`LeetCode request failed (HTTP ${response.status}).`, response.status);
    const text = await response.text();
    if (text.trimStart().startsWith("<")) throw new ApiError("LeetCode returned a browser verification page. Sign in with a browser.");
    try {
      const data: unknown = JSON.parse(text);
      return data;
    } catch {
      throw new ApiError("LeetCode returned an invalid JSON response.");
    }
  }

  private async graphql<T>(query: string, variables: unknown, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
    const data = await this.request("/graphql/", { query, variables }, signal);
    const envelope = graphErrorSchema.parse(data);
    if (envelope.errors?.length) throw new ApiError(envelope.errors.map((error) => error.message).join("; "));
    return this.validate(schema, data);
  }

  private validate<T>(schema: z.ZodType<T>, data: unknown): T {
    const parsed = schema.safeParse(data);
    if (!parsed.success) throw new ApiError(`LeetCode response changed (${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}).`);
    return parsed.data;
  }

  async user(signal?: AbortSignal): Promise<User> {
    const result = await this.graphql(USER_QUERY, {}, z.object({ data: z.object({ userStatus: userSchema }) }), signal);
    return result.data.userStatus;
  }

  async list(options: ListOptions = {}, signal?: AbortSignal): Promise<ProblemPage> {
    if (options.premium !== undefined) return this.listByPremium(options, signal);
    const variables = {
      limit: options.limit ?? 50,
      skip: options.skip ?? 0,
      filters: {
        ...(options.search ? { searchKeywords: options.search } : {}),
        ...(options.difficulty ? { difficulty: options.difficulty } : {}),
        ...(options.tags?.length ? { tags: options.tags } : {}),
        ...(options.status ? { status: options.status } : {}),
      },
    };
    const result = await this.graphql(LIST_QUERY, variables, z.object({ data: z.object({ problemsetQuestionList: problemPageSchema }) }), signal);
    return result.data.problemsetQuestionList;
  }

  private async listByPremium(options: ListOptions, signal?: AbortSignal): Promise<ProblemPage> {
    const statuses = { AC: "SOLVED", TRIED: "ATTEMPTED", NOT_STARTED: "TO_DO" };
    const variables = {
      limit: options.limit ?? 50,
      skip: options.skip ?? 0,
      searchKeyword: options.search || "",
      filters: {
        filterCombineType: "ALL",
        premiumFilter: { premiumStatus: [options.premium ? "PREMIUM" : "NOT_PREMIUM"] },
        ...(options.difficulty ? { difficultyFilter: { difficulties: [options.difficulty] } } : {}),
        ...(options.tags?.length ? { topicFilter: { topicSlugs: options.tags, operator: "IS" } } : {}),
        ...(options.status ? { statusFilter: { questionStatuses: [statuses[options.status]], operator: "IS" } } : {}),
      },
    };
    const result = await this.graphql(PREMIUM_LIST_QUERY, variables, z.object({ data: z.object({ problemsetQuestionListV2: problemPageV2Schema }) }), signal);
    return result.data.problemsetQuestionListV2;
  }

  async problem(slug: string, signal?: AbortSignal): Promise<Problem> {
    const result = await this.graphql(PROBLEM_QUERY, { titleSlug: slug }, z.object({ data: z.object({ question: problemSchema.nullable() }) }), signal);
    if (!result.data.question) throw new ApiError("Problem not found.");
    return result.data.question;
  }

  private requireLogin(): void {
    if (!this.session.signedIn) throw new ApiError("Sign in first: press a, or run leetcove login.", 401);
  }

  async start(kind: JudgeJob["kind"], problem: Problem, language: string, code: string, tests?: string, signal?: AbortSignal): Promise<JudgeJob> {
    this.requireLogin();
    if (kind === "run" && !problem.enableRunCode) throw new ApiError("This problem does not support running tests.");
    if (kind === "submit" && !problem.enableSubmit) throw new ApiError("This problem does not support submission.");
    const path = `/problems/${encodeURIComponent(problem.titleSlug)}/${kind === "run" ? "interpret_solution" : "submit"}/`;
    const result = this.validate(jobSchema, await this.request(path, {
      lang: language,
      question_id: problem.questionId,
      typed_code: code,
      ...(kind === "run" ? { data_input: tests } : {}),
    }, signal, problem.titleSlug));
    const id = kind === "run" ? result.interpret_id : result.submission_id;
    if (id === undefined) throw new ApiError("LeetCode did not return a judging ID.");
    return { id: String(id), kind, testInput: result.test_case || tests };
  }

  async check(job: JudgeJob, signal?: AbortSignal): Promise<JudgeResult> {
    return this.validate(judgeResultSchema, await this.request(`/submissions/detail/${encodeURIComponent(job.id)}/check/`, undefined, signal));
  }

  async poll(job: JudgeJob, onProgress: (state: string) => void, signal?: AbortSignal): Promise<JudgeResult> {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      const result = await this.check(job, signal);
      if (result.status_code !== undefined) return result;
      if (result.state === "FAILURE") throw new ApiError("LeetCode could not judge the solution.");
      onProgress(result.state);
      await delay(1_000, signal);
    }
    throw new ApiError(`Judging timed out. Job ${job.id} may still be running; do not resubmit automatically.`);
  }

  async previousCode(slug: string, language: string, signal?: AbortSignal): Promise<string> {
    this.requireLogin();
    const id = Number(await this.previousSubmissionId(slug, language, signal));
    if (!Number.isSafeInteger(id)) throw new ApiError("Invalid submission ID.");
    const details = await this.graphql(SUBMISSION_CODE_QUERY, { id }, z.object({ data: z.object({ submissionDetails: previousCodeSchema.nullable() }) }), signal);
    if (!details.data.submissionDetails) throw new ApiError("Previous submission code is unavailable.");
    return details.data.submissionDetails.code;
  }

  private async previousSubmissionId(slug: string, language: string, signal?: AbortSignal): Promise<string> {
    let offset = 0;
    while (true) {
      const result = await this.graphql(SUBMISSIONS_QUERY, { slug, offset }, z.object({ data: z.object({ submissionList: submissionListSchema }) }), signal);
      const history = result.data.submissionList;
      const submissions = history.submissions || [];
      const previous = submissions.find((submission) => submission.lang === language);
      if (previous) return previous.id;
      if (!history.hasNext || !submissions.length) throw new ApiError(`No ${language} submission found for this problem.`);
      offset += submissions.length;
    }
  }
}
