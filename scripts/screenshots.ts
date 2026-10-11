import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CodeRenderable } from "@opentui/core";
import { createTestRenderer, type TestRendererSetup } from "@opentui/core/testing";
import { LeetCove } from "../src/tui/app.ts";
import { cleanPaths, temporaryPaths } from "../tests/fixtures.ts";
import { demoClient, demoProblem, demoSolution } from "./fixtures.ts";
import { screenshotSvg } from "./utils/screenshot.ts";

const output = resolve(import.meta.dir, "../docs/screenshots");

function pendingHighlights(setup: TestRendererSetup): Promise<void>[] {
  return Array.from(setup.renderer.nativeScene.getRenderables()).flatMap((renderable) =>
    renderable instanceof CodeRenderable && renderable.isHighlighting ? [renderable.highlightingDone] : []);
}

async function capture(setup: TestRendererSetup, name: string, title: string): Promise<void> {
  await setup.waitForVisualIdle();
  await Promise.all(pendingHighlights(setup));
  await setup.waitForVisualIdle();
  await writeFile(resolve(output, `${name}.svg`), screenshotSvg(setup.captureSpans(), title));
}

async function screenshots(): Promise<void> {
  const paths = await temporaryPaths();
  const setup = await createTestRenderer({ width: 128, height: 34 });
  const app = new LeetCove(setup.renderer, demoClient(), paths, { language: "python3" });
  try {
    await mkdir(output, { recursive: true });
    await app.initialize();
    await capture(setup, "problems", "leetcove · problem browser");
    await app.openProblem(demoProblem.titleSlug);
    await capture(setup, "problem", "leetcove · problem description");
    await writeFile(resolve(paths.workspace, "1-two-sum/solution.python3.py"), demoSolution);
    setup.mockInput.pressKey("r", { shift: true });
    await app.finish();
    setup.mockInput.pressKey("v");
    await capture(setup, "solution", "leetcove · solution preview");
    console.log("Screenshots saved to docs/screenshots/.");
  } finally {
    app.close();
    await app.finish();
    await setup.dispose();
    await cleanPaths(paths);
  }
}

await screenshots();
