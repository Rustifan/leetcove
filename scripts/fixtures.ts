import type { JudgeResult, Problem } from "../src/api/schemas.ts";
import { fixtureClient } from "../tests/fixtures.ts";

export const demoProblem: Problem = {
  questionId: "1",
  questionFrontendId: "1",
  title: "Two Sum",
  titleSlug: "two-sum",
  difficulty: "Easy",
  isPaidOnly: false,
  content: `<p>Given an integer array <code>nums</code> and an integer <code>target</code>, return the indices of the two numbers whose sum equals the target.</p>
<p>Each input has exactly one solution. You cannot use the same element twice. Return the indices in any order.</p>
<h3>Example 1</h3><pre>Input: nums = [2,7,11,15], target = 9
Output: [0,1]
Explanation: nums[0] + nums[1] = 9.</pre>
<h3>Example 2</h3><pre>Input: nums = [3,2,4], target = 6
Output: [1,2]</pre>
<h3>Constraints</h3><ul><li><code>2 &lt;= nums.length &lt;= 10^4</code></li><li><code>-10^9 &lt;= nums[i], target &lt;= 10^9</code></li><li>Exactly one valid answer exists.</li></ul>
<p><strong>Follow-up:</strong> Can you solve this in linear time?</p>`,
  codeSnippets: [{ lang: "Python3", langSlug: "python3", code: "class Solution:\n    def twoSum(self, nums: List[int], target: int) -> List[int]:\n        pass" }],
  exampleTestcaseList: ["[2,7,11,15]\n9", "[3,2,4]\n6", "[3,3]\n6"],
  metaData: JSON.stringify({ params: [{ name: "nums", type: "integer[]" }, { name: "target", type: "integer" }] }),
  hints: [],
  topicTags: [{ name: "Array", slug: "array" }, { name: "Hash Table", slug: "hash-table" }],
  enableRunCode: true,
  enableSubmit: true,
};

interface CatalogEntry {
  number: number;
  title: string;
  slug: string;
  difficulty: Problem["difficulty"];
}

const catalog: CatalogEntry[] = [
  { number: 1, title: "Two Sum", slug: "two-sum", difficulty: "Easy" },
  { number: 2, title: "Add Two Numbers", slug: "add-two-numbers", difficulty: "Medium" },
  { number: 3, title: "Longest Substring Without Repeating Characters", slug: "longest-substring-without-repeating-characters", difficulty: "Medium" },
  { number: 4, title: "Median of Two Sorted Arrays", slug: "median-of-two-sorted-arrays", difficulty: "Hard" },
  { number: 5, title: "Longest Palindromic Substring", slug: "longest-palindromic-substring", difficulty: "Medium" },
  { number: 11, title: "Container With Most Water", slug: "container-with-most-water", difficulty: "Medium" },
  { number: 15, title: "3Sum", slug: "3sum", difficulty: "Medium" },
  { number: 20, title: "Valid Parentheses", slug: "valid-parentheses", difficulty: "Easy" },
  { number: 21, title: "Merge Two Sorted Lists", slug: "merge-two-sorted-lists", difficulty: "Easy" },
  { number: 33, title: "Search in Rotated Sorted Array", slug: "search-in-rotated-sorted-array", difficulty: "Medium" },
  { number: 42, title: "Trapping Rain Water", slug: "trapping-rain-water", difficulty: "Hard" },
  { number: 49, title: "Group Anagrams", slug: "group-anagrams", difficulty: "Medium" },
  { number: 53, title: "Maximum Subarray", slug: "maximum-subarray", difficulty: "Medium" },
  { number: 70, title: "Climbing Stairs", slug: "climbing-stairs", difficulty: "Easy" },
  { number: 104, title: "Maximum Depth of Binary Tree", slug: "maximum-depth-of-binary-tree", difficulty: "Easy" },
  { number: 121, title: "Best Time to Buy and Sell Stock", slug: "best-time-to-buy-and-sell-stock", difficulty: "Easy" },
  { number: 146, title: "LRU Cache", slug: "lru-cache", difficulty: "Medium" },
  { number: 200, title: "Number of Islands", slug: "number-of-islands", difficulty: "Medium" },
  { number: 206, title: "Reverse Linked List", slug: "reverse-linked-list", difficulty: "Easy" },
  { number: 217, title: "Contains Duplicate", slug: "contains-duplicate", difficulty: "Easy" },
  { number: 238, title: "Product of Array Except Self", slug: "product-of-array-except-self", difficulty: "Medium" },
  { number: 242, title: "Valid Anagram", slug: "valid-anagram", difficulty: "Easy" },
  { number: 347, title: "Top K Frequent Elements", slug: "top-k-frequent-elements", difficulty: "Medium" },
  { number: 704, title: "Binary Search", slug: "binary-search", difficulty: "Easy" },
];

export const demoSolution = `class Solution:
    def twoSum(self, nums: List[int], target: int) -> List[int]:
        seen = {}

        for index, value in enumerate(nums):
            complement = target - value
            if complement in seen:
                return [seen[complement], index]
            seen[value] = index
`;

export function demoClient() {
  const problems = catalog.map((entry): Problem => ({
    ...demoProblem,
    questionId: String(entry.number),
    questionFrontendId: String(entry.number),
    title: entry.title,
    titleSlug: entry.slug,
    difficulty: entry.difficulty,
  }));
  const result: JudgeResult = {
    state: "SUCCESS", status_code: 10, status_msg: "Accepted", compare_result: "111",
    code_answer: ["[0,1]", "[1,2]", "[0,1]"], expected_code_answer: ["[0,1]", "[1,2]", "[0,1]"],
    total_correct: 3, total_testcases: 3, status_runtime: "0 ms", status_memory: "18.4 MB",
  };
  return fixtureClient([], problems, result, { username: "demo", isSignedIn: true, isPremium: false, isVerified: true });
}
