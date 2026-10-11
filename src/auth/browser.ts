import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { AppPaths, Settings } from "../storage.ts";
import { browserCommand } from "../utils/devtools.ts";
import { browserExecutable } from "../utils/browser.ts";
import { delay } from "../utils/errors.ts";
import { browserCookieSchema, isLeetCodeDomain, LEETCODE_URL, type BrowserCookie } from "./session.ts";

const versionSchema = z.object({ "User-Agent": z.string(), webSocketDebuggerUrl: z.string().url() });
const cookiesSchema = z.object({ cookies: z.array(browserCookieSchema) });

export interface LoginBrowser {
  readonly endpoint: string;
  readonly userAgent: string;
  cookies(signal?: AbortSignal): Promise<BrowserCookie[]>;
  isClosed(): boolean;
  close(): Promise<void>;
}

function availablePort(): number {
  const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data(socket) { socket.end(); } } });
  const port = listener.port;
  listener.stop(true);
  if (!port) throw new Error("Could not allocate a local port for browser login.");
  return port;
}

async function inspectVersion(endpoint: string, signal?: AbortSignal): Promise<z.infer<typeof versionSchema> | undefined> {
  try {
    const timeout = AbortSignal.timeout(1_000);
    const response = await fetch(`${endpoint}/json/version`, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!response.ok) return undefined;
    const data: unknown = await response.json();
    return versionSchema.parse(data);
  } catch {
    signal?.throwIfAborted();
    return undefined;
  }
}

async function waitForBrowser(endpoint: string, child: Bun.Subprocess, signal?: AbortSignal): Promise<z.infer<typeof versionSchema>> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    if (child.exitCode !== null) throw new Error("The login browser could not start. Close any earlier LeetCove login window and try again.");
    const version = await inspectVersion(endpoint, signal);
    if (version) return version;
    await delay(100, signal);
  }
  throw new Error("The login browser did not start within thirty seconds. Set LEETCOVE_BROWSER to an installed Chromium-compatible browser.");
}

async function stopBrowser(child: Bun.Subprocess, socketUrl?: string): Promise<void> {
  if (child.exitCode !== null) return;
  if (socketUrl) await browserCommand(socketUrl, "Browser.close").catch(() => child.kill("SIGTERM"));
  if (!socketUrl) child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 3_000);
  try {
    await child.exited;
  } finally {
    clearTimeout(timer);
  }
}

export async function openLoginBrowser(paths: AppPaths, settings: Settings, signal?: AbortSignal): Promise<LoginBrowser> {
  signal?.throwIfAborted();
  const path = await browserExecutable(settings);
  const profile = join(paths.state, "browser");
  await mkdir(profile, { recursive: true, mode: 0o700 });
  await chmod(profile, 0o700);
  const port = availablePort();
  const endpoint = `http://127.0.0.1:${port}`;
  // A nonzero debugging port and a normal launch leave navigator.webdriver disabled.
  const child = Bun.spawn([
    path, `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
    "--remote-debugging-address=127.0.0.1", "--no-first-run", "--no-default-browser-check",
    `${LEETCODE_URL}/accounts/login/`,
  ], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  try {
    const version = await waitForBrowser(endpoint, child, signal);
    return {
      endpoint,
      userAgent: version["User-Agent"],
      isClosed: () => child.exitCode !== null,
      cookies: async (cookieSignal) => {
        const result = await browserCommand(version.webSocketDebuggerUrl, "Storage.getCookies", cookieSignal);
        return cookiesSchema.parse(result).cookies.filter((cookie) => isLeetCodeDomain(cookie.domain));
      },
      close: () => stopBrowser(child, version.webSocketDebuggerUrl),
    };
  } catch (error) {
    await stopBrowser(child);
    throw error;
  }
}
