import type { Settings } from "./storage.ts";
import { commandArguments } from "./utils/commands.ts";

export interface EditorTerminal {
  suspend(): Promise<void>;
  resume(): Promise<void>;
  readonly isDestroyed: boolean;
}

export function editorArguments(command: string, path: string): string[] {
  return commandArguments(command, path, "EDITOR");
}

export async function openEditor(path: string, settings: Settings, terminal: EditorTerminal): Promise<void> {
  const command = settings.editor || process.env.VISUAL || process.env.EDITOR || "vi";
  const arguments_ = editorArguments(command, path);
  await terminal.suspend();
  try {
    const child = Bun.spawn(arguments_, { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
    const exitCode = await child.exited;
    if (exitCode !== 0) throw new Error(`Editor exited with status ${exitCode}. Your file is preserved.`);
  } finally {
    if (!terminal.isDestroyed) await terminal.resume();
  }
}
