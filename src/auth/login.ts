import { LeetCodeClient } from "../api/client.ts";
import { type AppPaths, type Settings } from "../storage.ts";
import { delay } from "../utils/errors.ts";
import { openLoginBrowser, type LoginBrowser } from "./browser.ts";
import { Session } from "./session.ts";

async function waitForLogin(browser: LoginBrowser, paths: AppPaths, signal?: AbortSignal): Promise<Session> {
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    if (browser.isClosed()) throw new Error("Login window was closed before sign-in completed. Run leetcove login to try again.");
    const session = Session.fromCookies(await browser.cookies(signal), paths, browser.userAgent);
    if (session.signedIn && await validateSession(session, signal)) return session;
    await delay(1_000, signal);
  }
  throw new Error("Login timed out after ten minutes. Complete browser verification and sign-in, or set LEETCOVE_BROWSER to another Chromium-compatible browser.");
}

async function validateSession(session: Session, signal?: AbortSignal): Promise<boolean> {
  const user = await new LeetCodeClient(session).user(signal);
  if (!user.isSignedIn) return false;
  session.username = user.username;
  return true;
}

export async function loginWithBrowser(paths: AppPaths, settings: Settings, signal?: AbortSignal): Promise<Session> {
  const browser = await openLoginBrowser(paths, settings, signal);
  try {
    const session = await waitForLogin(browser, paths, signal);
    await session.save();
    return session;
  } finally {
    await browser.close();
  }
}
