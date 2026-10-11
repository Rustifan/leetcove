import { BaseRenderable, CodeRenderable, type MarkdownOptions } from "@opentui/core";

function enableTextPreview(renderable: BaseRenderable): void {
  if (renderable instanceof CodeRenderable) renderable.drawUnstyledText = true;
  for (const child of renderable.getChildren()) enableTextPreview(child);
}

// Keep problem text visible while the asynchronous syntax parser initializes.
export const previewMarkdown: MarkdownOptions["renderNode"] = (_token, context) => {
  const block = context.defaultRender();
  if (!block) return undefined;
  enableTextPreview(block);
  return block;
};
