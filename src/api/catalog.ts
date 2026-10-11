import { createHash } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { readOptionalJson, writeJson, type AppPaths } from "../storage.ts";
import { isAbort } from "../utils/errors.ts";
import { LeetCodeClient, type ListOptions } from "./client.ts";
import { problemPageSchema, type ProblemPage } from "./schemas.ts";

const cacheSchema = z.object({ savedAt: z.number(), page: problemPageSchema });

export class Catalog {
  constructor(private readonly client: LeetCodeClient, private readonly paths: AppPaths) {}

  private path(options: ListOptions): string {
    const key = JSON.stringify({ account: this.client.session.username || "anonymous", options });
    return join(this.paths.cache, `list-${createHash("sha256").update(key).digest("hex")}.json`);
  }

  async cached(options: ListOptions): Promise<ProblemPage | undefined> {
    const stored = cacheSchema.safeParse(await readOptionalJson(this.path(options)));
    return stored.success ? stored.data.page : undefined;
  }

  async load(options: ListOptions, signal?: AbortSignal): Promise<{ page: ProblemPage; offline: boolean }> {
    try {
      const page = await this.client.list(options, signal);
      await writeJson(this.path(options), { savedAt: Date.now(), page });
      return { page, offline: false };
    } catch (error) {
      if (isAbort(error)) throw error;
      const cached = await this.cached(options);
      if (!cached) throw error;
      return { page: cached, offline: true };
    }
  }
}
