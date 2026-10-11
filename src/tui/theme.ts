import { SyntaxStyle, type CliRenderer } from "@opentui/core";

export const colors = {
  background: "#10141c",
  panel: "#161c26",
  border: "#303b4e",
  text: "#d7e0ee",
  muted: "#8392ab",
  accent: "#80b7ff",
  selected: "#253a56",
  success: "#91d6a0",
  error: "#f49b9b",
};

export function syntaxStyle(renderer: CliRenderer): SyntaxStyle {
  return SyntaxStyle.fromStyles({
    default: { fg: colors.text },
    keyword: { fg: "#bd9df2" },
    string: { fg: colors.success },
    comment: { fg: colors.muted, italic: true },
    number: { fg: "#efb77a" },
    function: { fg: colors.accent },
    type: { fg: "#8bd5ca" },
    variable: { fg: colors.text },
    operator: { fg: "#b7c4db" },
    punctuation: { fg: colors.muted },
    "markup.heading": { fg: colors.accent, bold: true },
    "markup.strong": { fg: colors.text, bold: true },
    "markup.italic": { fg: colors.text, italic: true },
    "markup.raw": { fg: "#efb77a" },
    "markup.link": { fg: colors.accent, underline: true },
  }, renderer.nativeScene);
}
