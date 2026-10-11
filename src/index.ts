#!/usr/bin/env bun
import { appPaths, loadSettings, type AppPaths, type Settings } from "./storage.ts";
import { LeetCodeClient } from "./api/client.ts";
import { loginWithBrowser } from "./auth/login.ts";
import { logout, Session } from "./auth/session.ts";
import { helpText, parseCommand, versionText } from "./cli.ts";
import { errorMessage, isAbort } from "./utils/errors.ts";

async function browserLogin(paths: AppPaths, settings: Settings): Promise<Session> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
  for (const signal of signals) process.on(signal, cancel);
  try {
    return await loginWithBrowser(paths, settings, controller.signal);
  } finally {
    for (const signal of signals) process.off(signal, cancel);
  }
}

async function main(): Promise<void> {
  const command = parseCommand(process.argv.slice(2));
  if (command.kind === "help") {
    console.log(helpText);
    return;
  }
  if (command.kind === "version") {
    console.log(versionText);
    return;
  }
  const paths = appPaths();
  if (command.kind === "logout") {
    await logout(paths);
    console.log("LeetCove session removed.");
    return;
  }
  if (command.kind === "login") {
    console.log("Sign in in the browser window. Your LeetCode session will be saved automatically.");
    const session = await browserLogin(paths, await loadSettings(paths));
    console.log(`Signed in as ${session.username}. Session saved privately.`);
    return;
  }
  if (command.kind === "tui" && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    throw new Error("The TUI needs an interactive terminal. Run leetcove --help for usage.");
  }
  const client = new LeetCodeClient(await Session.load(paths));
  if (command.kind === "whoami") {
    const user = await client.user();
    console.log(user.isSignedIn ? `Signed in as ${user.username}${user.isPremium ? " (Premium)" : ""}.` : "Not signed in.");
    return;
  }
  if (command.kind !== "tui") return;
  const { startTui } = await import("./tui/app.ts");
  await startTui(client, paths, await loadSettings(paths), command.slug);
}

try {
  await main();
} catch (error) {
  console.error(`leetcove: ${errorMessage(error)}`);
  process.exitCode = isAbort(error) ? 130 : 1;
}
