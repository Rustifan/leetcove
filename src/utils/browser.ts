import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Settings } from "../storage.ts";

const browserNames = ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable", "chrome", "brave-browser", "msedge"];

function applicationPaths(): string[] {
  if (process.platform === "darwin") {
    const applications = ["Google Chrome.app/Contents/MacOS/Google Chrome", "Chromium.app/Contents/MacOS/Chromium", "Brave Browser.app/Contents/MacOS/Brave Browser", "Microsoft Edge.app/Contents/MacOS/Microsoft Edge"];
    return ["/Applications", join(homedir(), "Applications")].flatMap((base) => applications.map((app) => join(base, app)));
  }
  if (process.platform !== "win32") return [];
  const roots = [process.env.LOCALAPPDATA, process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"]]
    .filter((root): root is string => Boolean(root));
  const applications = ["Google/Chrome/Application/chrome.exe", "Chromium/Application/chrome.exe", "Microsoft/Edge/Application/msedge.exe"];
  return roots.flatMap((root) => applications.map((app) => join(root, app)));
}

export async function browserExecutable(settings: Settings): Promise<string> {
  const configured = process.env.LEETCOVE_BROWSER || settings.browserExecutable;
  if (configured) return validateExecutable(Bun.which(configured) || resolve(configured));
  const onPath = browserNames.map((name) => Bun.which(name)).find((path) => path !== null);
  if (onPath) return onPath;
  for (const path of applicationPaths()) {
    if (await Bun.file(path).exists()) return path;
  }
  throw new Error("No Chromium-compatible browser found. Install Chromium or Google Chrome, or set LEETCOVE_BROWSER to its executable path.");
}

async function validateExecutable(path: string): Promise<string> {
  if (!await Bun.file(path).exists()) throw new Error(`Browser executable not found: ${path}. Check LEETCOVE_BROWSER or browserExecutable in your configuration.`);
  return path;
}
