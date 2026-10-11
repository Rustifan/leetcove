import { afterEach, beforeEach, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appPaths } from "../src/storage.ts";

let previousDataHome: string | undefined;
let previousWorkspace: string | undefined;

beforeEach(() => {
  previousDataHome = process.env.XDG_DATA_HOME;
  previousWorkspace = process.env.LEETCOVE_WORKSPACE;
  delete process.env.LEETCOVE_WORKSPACE;
});

afterEach(() => {
  if (previousDataHome === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = previousDataHome;
  if (previousWorkspace === undefined) delete process.env.LEETCOVE_WORKSPACE;
  else process.env.LEETCOVE_WORKSPACE = previousWorkspace;
});

test("solutions follow XDG_DATA_HOME unless an explicit workspace is provided", () => {
  const dataHome = join(tmpdir(), "leetcove-custom-data");
  const workspace = join(tmpdir(), "leetcove-custom-workspace");
  process.env.XDG_DATA_HOME = dataHome;
  expect(appPaths().workspace).toBe(join(dataHome, "leetcove/solutions"));
  process.env.LEETCOVE_WORKSPACE = workspace;
  expect(appPaths().workspace).toBe(workspace);
});
