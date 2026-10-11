import { appPaths } from "../src/storage.ts";
import { startTui } from "../src/tui/app.ts";
import { demoClient, demoProblem } from "./fixtures.ts";

await startTui(demoClient(), appPaths(), { language: "python3" }, demoProblem.titleSlug);
