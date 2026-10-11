import { version } from "../package.json";

export type Command =
  | { kind: "help" | "version" | "login" | "whoami" | "logout" }
  | { kind: "tui"; slug?: string };

export const helpText = `LeetCove — LeetCode in your terminal

Usage: leetcove [command | problem-slug]

Commands:
  login            Sign in using a Chromium-compatible browser
  whoami           Check your saved LeetCode session
  logout           Remove your saved session and browser profile

Options:
  -h, --help       Show this help
  -v, --version    Show the installed version

Examples:
  leetcove                 Browse problems or resume your last view
  leetcove two-sum          Open a problem directly
  EDITOR=nvim leetcove      Use your preferred editor

Configuration: ~/.config/leetcove/config.json (or $XDG_CONFIG_HOME/leetcove/)
Environment: EDITOR, VISUAL, LEETCOVE_WORKSPACE, LEETCOVE_BROWSER, LEETCOVE_OPENER

From a source checkout, use bun start -- <command | problem-slug>.`;

export const versionText = `leetcove ${version}`;

export function parseCommand(arguments_: string[]): Command {
  if (arguments_.includes("--help") || arguments_.includes("-h")) return { kind: "help" };
  if (arguments_.length > 1) throw new Error("Expected one command or problem slug. Run leetcove --help for usage.");
  const argument = arguments_[0];
  if (!argument) return { kind: "tui" };
  if (argument === "help") return { kind: "help" };
  if (argument === "--version" || argument === "-v") return { kind: "version" };
  if (argument === "login" || argument === "whoami" || argument === "logout") return { kind: argument };
  if (argument.startsWith("-")) throw new Error(`Unknown option: ${argument}. Run leetcove --help for usage.`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(argument)) throw new Error("Use a problem slug, such as two-sum. Run leetcove --help for usage.");
  return { kind: "tui", slug: argument };
}
