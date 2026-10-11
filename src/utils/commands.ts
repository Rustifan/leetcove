import { parse } from "shell-quote";

export function commandArguments(command: string, argument: string, name: string): string[] {
  const arguments_ = parse(command, process.env);
  if (!arguments_.length || arguments_.some((value) => typeof value !== "string")) {
    throw new Error(`${name} must be an executable with optional arguments, without shell operators.`);
  }
  const strings = arguments_.filter((value): value is string => typeof value === "string");
  return [...strings, argument];
}
