import { join } from "node:path";
import { z } from "zod";
import { readOptionalJson, writeJson, type AppPaths } from "../storage.ts";

export const tabSchema = z.enum(["description", "solution", "tests", "results"]);
export type Tab = z.infer<typeof tabSchema>;

const listOptionsSchema = z.object({
  search: z.string().optional(),
  skip: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(200).default(50),
  difficulty: z.enum(["EASY", "MEDIUM", "HARD"]).optional(),
  status: z.enum(["AC", "TRIED", "NOT_STARTED"]).optional(),
  premium: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
});

export const viewStateSchema = z.object({
  version: z.literal(1),
  language: z.string().regex(/^[a-z0-9]+$/),
  list: z.object({
    options: listOptionsSchema,
    selectedIndex: z.number().int().nonnegative(),
    selectedSlug: z.string().regex(/^[a-z0-9-]+$/).optional(),
  }),
  view: z.discriminatedUnion("screen", [
    z.object({ screen: z.literal("list") }),
    z.object({
      screen: z.literal("problem"),
      slug: z.string().regex(/^[a-z0-9-]+$/),
      tab: tabSchema,
      scroll: z.object({ x: z.number().nonnegative(), y: z.number().nonnegative() }),
    }),
  ]),
});
export type SavedViewState = z.infer<typeof viewStateSchema>;

export class ViewStateStore {
  private readonly path: string;
  private latest?: SavedViewState;
  private signature?: string;
  private timer?: ReturnType<typeof setTimeout>;
  private pending = Promise.resolve();

  constructor(paths: AppPaths, private readonly onError: (error: unknown) => void) {
    this.path = join(paths.state, "view.json");
  }

  async load(): Promise<SavedViewState | undefined> {
    try {
      const parsed = viewStateSchema.safeParse(await readOptionalJson(this.path));
      return parsed.success ? parsed.data : undefined;
    } catch (error) {
      if (error instanceof SyntaxError) return undefined;
      throw error;
    }
  }

  remember(state: SavedViewState): void {
    const signature = JSON.stringify(state);
    if (signature === this.signature) return;
    this.signature = signature;
    this.latest = state;
    this.pause();
    this.timer = setTimeout(() => void this.flush().catch(this.onError), 200);
  }

  pause(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  flush(): Promise<void> {
    this.pause();
    const snapshot = this.latest;
    this.latest = undefined;
    if (!snapshot) return this.pending;
    this.pending = this.pending.catch(() => {}).then(() => this.persist(snapshot));
    return this.pending;
  }

  private async persist(snapshot: SavedViewState): Promise<void> {
    try {
      await writeJson(this.path, snapshot, true);
    } catch (error) {
      this.signature = undefined;
      this.latest ??= snapshot;
      throw error;
    }
  }
}
