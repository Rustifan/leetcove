import { z } from "zod";

export const userSchema = z.object({
  username: z.string(),
  isSignedIn: z.boolean(),
  isPremium: z.boolean().nullable(),
  isVerified: z.boolean(),
});
export type User = z.infer<typeof userSchema>;

export const difficultySchema = z.enum(["Easy", "Medium", "Hard"]);
export const problemSummarySchema = z.object({
  questionId: z.string(),
  questionFrontendId: z.string(),
  title: z.string(),
  titleSlug: z.string(),
  difficulty: difficultySchema,
  isPaidOnly: z.boolean(),
  acRate: z.number(),
  status: z.string().nullable(),
  topicTags: z.array(z.object({ name: z.string(), slug: z.string() })),
});
export type ProblemSummary = z.infer<typeof problemSummarySchema>;

export const problemPageSchema = z.object({
  total: z.number(),
  questions: z.array(problemSummarySchema),
});
export type ProblemPage = z.infer<typeof problemPageSchema>;

const problemSummaryV2Schema = problemSummarySchema.omit({ questionId: true, difficulty: true, isPaidOnly: true, status: true }).extend({
  id: z.number().int(),
  difficulty: z.enum(["EASY", "MEDIUM", "HARD"]),
  paidOnly: z.boolean(),
  status: z.enum(["SOLVED", "ATTEMPTED", "TO_DO"]).nullable(),
}).transform(({ id, difficulty, paidOnly, status, acRate, ...problem }): ProblemSummary => ({
  ...problem,
  questionId: String(id),
  difficulty: difficulty === "EASY" ? "Easy" : difficulty === "MEDIUM" ? "Medium" : "Hard",
  isPaidOnly: paidOnly,
  status: status === "SOLVED" ? "ac" : status === "ATTEMPTED" ? "notac" : null,
  acRate: acRate * 100,
}));

export const problemPageV2Schema = z.object({ totalLength: z.number(), questions: z.array(problemSummaryV2Schema) })
  .transform(({ totalLength, questions }): ProblemPage => ({ total: totalLength, questions }));

export const snippetSchema = z.object({ lang: z.string(), langSlug: z.string(), code: z.string() });
export const problemSchema = z.object({
  questionId: z.string(),
  questionFrontendId: z.string(),
  title: z.string(),
  titleSlug: z.string().regex(/^[a-z0-9-]+$/),
  difficulty: difficultySchema,
  isPaidOnly: z.boolean(),
  content: z.string().nullable(),
  codeSnippets: z.array(snippetSchema).nullable(),
  exampleTestcaseList: z.array(z.string()),
  metaData: z.string(),
  hints: z.array(z.string()).default([]),
  topicTags: z.array(z.object({ name: z.string(), slug: z.string() })),
  enableRunCode: z.boolean(),
  enableSubmit: z.boolean(),
});
export type Problem = z.infer<typeof problemSchema>;

export const judgeResultSchema = z.object({
  state: z.string(),
  status_code: z.number().optional(),
  status_msg: z.string().optional(),
  run_success: z.boolean().optional(),
  correct_answer: z.boolean().optional(),
  compare_result: z.string().optional(),
  code_answer: z.array(z.string()).nullish(),
  expected_code_answer: z.array(z.string()).nullish(),
  std_output_list: z.array(z.string()).nullish(),
  std_output: z.string().nullish(),
  code_output: z.union([z.string(), z.array(z.string())]).nullish(),
  expected_output: z.string().nullish(),
  last_testcase: z.string().nullish(),
  compile_error: z.string().nullish(),
  full_compile_error: z.string().nullish(),
  runtime_error: z.string().nullish(),
  full_runtime_error: z.string().nullish(),
  invalid_testcase: z.boolean().optional(),
  status_runtime: z.string().nullish(),
  status_memory: z.string().nullish(),
  memory: z.number().nullish(),
  total_correct: z.number().nullish(),
  total_testcases: z.number().nullish(),
  runtime_percentile: z.number().nullish(),
  memory_percentile: z.number().nullish(),
  submission_id: z.union([z.string(), z.number()]).optional(),
}).passthrough();
export type JudgeResult = z.infer<typeof judgeResultSchema>;

export const jobSchema = z.object({
  interpret_id: z.union([z.string(), z.number()]).optional(),
  submission_id: z.union([z.string(), z.number()]).optional(),
  test_case: z.string().optional(),
});

export const submissionListSchema = z.object({
  hasNext: z.boolean().nullable(),
  submissions: z.array(z.object({
    id: z.string(),
    lang: z.string(),
    timestamp: z.string(),
    statusDisplay: z.string(),
  })).nullable(),
});

export const previousCodeSchema = z.object({ code: z.string(), lang: z.object({ name: z.string() }) });
