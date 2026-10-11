import { LeetCodeClient } from "../src/api/client.ts";
import { Session } from "../src/auth/session.ts";
import { appPaths } from "../src/storage.ts";
import { verdict } from "../src/tui/format.ts";

const client = new LeetCodeClient(await Session.load(appPaths()));
const user = await client.user();
if (!user.isSignedIn) throw new Error("Sign in first with bun run login.");
console.log(`Live verification as ${user.username}`);
const problem = await client.problem("two-sum");
const tests = problem.exampleTestcaseList.join("\n");
const accepted = `class Solution:
    def twoSum(self, nums, target):
        seen = {}
        for i, value in enumerate(nums):
            if target - value in seen:
                return [seen[target - value], i]
            seen[value] = i
`;

async function run(code: string, expected: string, language = "python3"): Promise<void> {
  const job = await client.start("run", problem, language, code, tests);
  const result = await client.poll(job, () => {});
  const label = verdict(result, "run");
  console.log(`${label}: ${result.total_correct ?? "—"}/${result.total_testcases ?? "—"} tests, status ${result.status_code}`);
  if (label !== expected) throw new Error(`Expected ${expected}, received ${label}.`);
}

await run(accepted, "Accepted");
await Bun.sleep(20_000);
await run("class Solution:\n    def twoSum(self, nums, target):\n        return []\n", "Wrong Answer");
await Bun.sleep(20_000);
await run("class Solution:\n    def twoSum(self, nums, target)\n        return []\n", "Runtime Error");
await Bun.sleep(20_000);
await run("class Solution { definitely invalid C++; };", "Compile Error", "cpp");

if (process.argv.includes("--submit")) {
  await Bun.sleep(20_000);
  const job = await client.start("submit", problem, "python3", accepted);
  const result = await client.poll(job, () => {});
  console.log(`Submission ${job.id}: ${verdict(result, "submit")}, ${result.total_correct}/${result.total_testcases} tests`);
  if (verdict(result, "submit") !== "Accepted") throw new Error("Live submission was not accepted.");
  const recovered = await client.previousCode(problem.titleSlug, "python3");
  if (recovered.trim() !== accepted.trim()) throw new Error("Recovered submission did not match submitted code.");
  console.log("Previous submitted code recovered successfully.");
}
