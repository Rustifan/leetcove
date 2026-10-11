import { spawn } from "node:child_process";
import type { Settings } from "../storage.ts";
import { commandArguments } from "./commands.ts";

export type UrlOpener = (url: string, settings: Settings) => Promise<void>;

function defaultOpener(): string {
  const executable = Bun.which("qutebrowser") || Bun.which("xdg-open") || Bun.which("open");
  if (!executable) throw new Error("No URL opener found. Install qutebrowser or set LEETCOVE_OPENER to your browser or system opener.");
  return executable;
}

export async function openUrl(url: string, settings: Settings): Promise<void> {
  const target = new URL(url);
  if (target.protocol !== "https:" && target.protocol !== "http:") throw new Error("Image links must use HTTP or HTTPS.");
  const command = process.env.LEETCOVE_OPENER || settings.urlOpener || defaultOpener();
  await startOpener(commandArguments(command, target.href, "URL opener"));
}

function startOpener(arguments_: string[]): Promise<void> {
  const executable = arguments_[0];
  if (!executable) return Promise.reject(new Error("No URL opener configured."));
  return new Promise((resolve, reject) => {
    const child = spawn(executable, arguments_.slice(1), { detached: true, stdio: "ignore" });
    let timer: ReturnType<typeof setTimeout> | undefined;
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`Could not start URL opener: ${error.message}`));
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      reject(new Error(`URL opener exited with ${signal || `status ${code}`}. Check LEETCOVE_OPENER or the urlOpener setting.`));
    });
    child.once("spawn", () => {
      child.unref();
      // An existing browser exits after forwarding the URL; a new browser stays open.
      timer = setTimeout(resolve, 300);
    });
  });
}
