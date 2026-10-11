import { expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { version } from "../package.json";
import { cleanPaths, temporaryPaths } from "./fixtures.ts";
import type { AppPaths } from "../src/storage.ts";

async function runCli(paths: AppPaths, arguments_: string[]) {
  const child = Bun.spawn([process.execPath, resolve(import.meta.dir, "../src/index.ts"), ...arguments_], {
    cwd: paths.workspace,
    env: {
      ...process.env,
      XDG_CONFIG_HOME: paths.config,
      XDG_STATE_HOME: paths.state,
      XDG_CACHE_HOME: paths.cache,
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  return { stdout, stderr, code };
}

test("help, version, and logout work outside the checkout with malformed configuration and session data", async () => {
  const paths = await temporaryPaths();
  const config = join(paths.config, "leetcove", "config.json");
  const session = join(paths.state, "leetcove", "session.json");
  try {
    await Promise.all([mkdir(join(paths.config, "leetcove"), { recursive: true }), mkdir(join(paths.state, "leetcove"), { recursive: true }), mkdir(paths.workspace)]);
    await writeFile(config, "invalid config");
    await writeFile(session, "invalid session");
    const help = await runCli(paths, ["--help"]);
    expect(help.code).toBe(0);
    expect(help.stderr).toBe("");
    expect(help.stdout).toContain("Usage: leetcove");
    const release = await runCli(paths, ["--version"]);
    expect(release.code).toBe(0);
    expect(release.stdout.trim()).toBe(`leetcove ${version}`);
    const logout = await runCli(paths, ["logout"]);
    expect(logout.code).toBe(0);
    expect(await Bun.file(session).exists()).toBe(false);
    expect(await readFile(config, "utf8")).toBe("invalid config");
  } finally {
    await cleanPaths(paths);
  }
});

test("invalid arguments and noninteractive startup fail before creating application state", async () => {
  const paths = await temporaryPaths();
  try {
    await mkdir(paths.workspace);
    const option = await runCli(paths, ["--unknown"]);
    expect(option.code).toBe(1);
    expect(option.stderr).toContain("Unknown option");
    const arguments_ = await runCli(paths, ["login", "unexpected"]);
    expect(arguments_.code).toBe(1);
    expect(arguments_.stderr).toContain("Expected one command");
    const tui = await runCli(paths, []);
    expect(tui.code).toBe(1);
    expect(tui.stderr).toContain("interactive terminal");
    expect(await Bun.file(join(paths.state, "leetcove", "session.json")).exists()).toBe(false);
  } finally {
    await cleanPaths(paths);
  }
});
