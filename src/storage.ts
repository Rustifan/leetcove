import { mkdir, readFile, rename, writeFile, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { isMissingFile } from "./utils/errors.ts";

export interface AppPaths {
  config: string;
  state: string;
  cache: string;
  workspace: string;
}

export function appPaths(): AppPaths {
  const home = homedir();
  return {
    config: join(process.env.XDG_CONFIG_HOME || join(home, ".config"), "leetcove"),
    state: join(process.env.XDG_STATE_HOME || join(home, ".local/state"), "leetcove"),
    cache: join(process.env.XDG_CACHE_HOME || join(home, ".cache"), "leetcove"),
    workspace: resolve(process.env.LEETCOVE_WORKSPACE || join(process.env.XDG_DATA_HOME || join(home, ".local/share"), "leetcove/solutions")),
  };
}

export const settingsSchema = z.object({
  language: z.string().default("python3"),
  editor: z.string().optional(),
  workspace: z.string().optional(),
  browserExecutable: z.string().optional(),
  urlOpener: z.string().optional(),
});

export type Settings = z.infer<typeof settingsSchema>;

export async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function readOptionalJson(path: string): Promise<unknown> {
  try {
    return await readJson(path);
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    throw error;
  }
}

export async function writeJson(path: string, data: unknown, privateFile = false): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: privateFile ? 0o700 : 0o755 });
  if (privateFile) await chmod(dirname(path), 0o700);
  const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: privateFile ? 0o600 : 0o644 });
  await rename(temporary, path);
}

export async function loadSettings(paths: AppPaths): Promise<Settings> {
  const data = await readOptionalJson(join(paths.config, "config.json"));
  return settingsSchema.parse(data || {});
}

export async function saveSettings(paths: AppPaths, settings: Settings): Promise<void> {
  await writeJson(join(paths.config, "config.json"), settings);
}
