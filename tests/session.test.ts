import { expect, test } from "bun:test";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { Session, type BrowserCookie } from "../src/auth/session.ts";
import { cleanPaths, temporaryPaths } from "./fixtures.ts";

const cookie: BrowserCookie = {
  name: "LEETCODE_SESSION", value: "original-test-session", domain: ".leetcode.com",
  path: "/", expires: -1, secure: true, httpOnly: true, sameSite: "Lax",
};

test("browser import stores only LeetCode cookies, including valid subdomain metadata", async () => {
  const paths = await temporaryPaths();
  try {
    const session = Session.fromCookies([
      cookie,
      { ...cookie, name: "other_site", domain: ".example.com" },
      { ...cookie, name: "subdomain", domain: "discuss.leetcode.com" },
    ], paths);
    await session.save();
    const loaded = await Session.load(paths);
    expect(loaded.headers("https://leetcode.com").Cookie).toContain("original-test-session");
    expect(loaded.headers("https://example.com").Cookie).toBe("");
    expect(loaded.headers("https://discuss.leetcode.com").Cookie).toContain("subdomain=");
    expect((await stat(join(paths.state, "session.json"))).mode & 0o777).toBe(0o600);
  } finally {
    await cleanPaths(paths);
  }
});

test("an unvalidated login attempt does not overwrite the saved session through Set-Cookie", async () => {
  const paths = await temporaryPaths();
  try {
    await Session.fromCookies([cookie], paths).save();
    const pending = Session.fromCookies([{ ...cookie, value: "unvalidated-test-session" }], paths);
    await pending.update(new Response("{}", { headers: { "Set-Cookie": "csrftoken=changed; Secure; Path=/" } }), "https://leetcode.com/graphql/");
    const saved = await Session.load(paths);
    expect(saved.headers("https://leetcode.com").Cookie).toContain("original-test-session");
    expect(saved.headers("https://leetcode.com").Cookie).not.toContain("unvalidated-test-session");
  } finally {
    await cleanPaths(paths);
  }
});
