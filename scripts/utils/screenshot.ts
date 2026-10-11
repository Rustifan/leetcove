import { TextAttributes, type CapturedFrame, type CapturedLine, type CapturedSpan, type RGBA } from "@opentui/core";

const cellWidth = 9;
const cellHeight = 20;
const inset = 16;
const titlebarHeight = 36;

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function color(rgba: RGBA): string {
  const [red, green, blue] = rgba.toInts();
  return `rgb(${red},${green},${blue})`;
}

function renderSpan(span: CapturedSpan, column: number, row: number): string {
  if (!span.width) return "";
  const x = inset + column * cellWidth;
  const y = titlebarHeight + inset + row * cellHeight;
  const width = span.width * cellWidth;
  const bold = span.attributes & TextAttributes.BOLD ? ' font-weight="bold"' : "";
  const italic = span.attributes & TextAttributes.ITALIC ? ' font-style="italic"' : "";
  const underline = span.attributes & TextAttributes.UNDERLINE ? ' text-decoration="underline"' : "";
  return `<rect x="${x}" y="${y}" width="${width}" height="${cellHeight}" fill="${color(span.bg)}"/>
<text x="${x}" y="${y + 15}" fill="${color(span.fg)}" textLength="${width}" lengthAdjust="spacingAndGlyphs" style="white-space:pre"${bold}${italic}${underline}>${escapeXml(span.text)}</text>`;
}

function renderLine(line: CapturedLine, row: number): string {
  let column = 0;
  return line.spans.map((span) => {
    const rendered = renderSpan(span, column, row);
    column += span.width;
    return rendered;
  }).join("\n");
}

export function screenshotSvg(frame: CapturedFrame, title: string): string {
  const width = frame.cols * cellWidth + inset * 2;
  const height = frame.rows * cellHeight + titlebarHeight + inset * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<title>${escapeXml(title)}</title>
<desc>LeetCove's native terminal renderer, captured with sample data.</desc>
<rect width="${width}" height="${height}" rx="12" fill="#10141c"/>
<path d="M12 0 H${width - 12} Q${width} 0 ${width} 12 V${titlebarHeight} H0 V12 Q0 0 12 0" fill="#1b2432"/>
<circle cx="20" cy="18" r="5" fill="#f49b9b"/>
<circle cx="38" cy="18" r="5" fill="#e5c07b"/>
<circle cx="56" cy="18" r="5" fill="#91d6a0"/>
<text x="${width / 2}" y="23" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#a8b7cd">${escapeXml(title)}</text>
<g font-family="'DejaVu Sans Mono', 'Liberation Mono', monospace" font-size="14">
${frame.lines.map(renderLine).join("\n")}
</g>
</svg>\n`;
}
