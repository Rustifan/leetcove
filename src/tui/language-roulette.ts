import { BoxRenderable, TextRenderable, bold, fg, t, type CliRenderer, type TextOptions } from "@opentui/core";
import { delay, isAbort } from "../utils/errors.ts";
import { createLanguageSpin, type LanguageSpin, type SolutionLanguage } from "../utils/random-language.ts";
import { terminalText } from "./format.ts";
import { colors } from "./theme.ts";

export class LanguageRoulette {
  readonly overlay: BoxRenderable;
  private readonly card: BoxRenderable;
  private readonly subtitle: TextRenderable;
  private readonly reel: BoxRenderable;
  private readonly previous: TextRenderable;
  private readonly current: TextRenderable;
  private readonly next: TextRenderable;
  private readonly status: TextRenderable;
  private readonly meter: TextRenderable;
  private readonly hint: TextRenderable;

  constructor(private readonly renderer: CliRenderer) {
    const text = (options: TextOptions) => new TextRenderable(renderer, {
      width: "100%", height: 1, flexShrink: 0, textAlign: "center", fg: colors.muted,
      wrapMode: "none", truncate: true, selectable: false, ...options,
    });
    this.overlay = new BoxRenderable(renderer, {
      id: "language-roulette", visible: false, position: "absolute", top: 0, left: 0,
      width: "100%", height: "100%", zIndex: 20, paddingX: 2,
      alignItems: "center", justifyContent: "center", backgroundColor: "#10141ce6",
    });
    this.card = new BoxRenderable(renderer, {
      width: 52, maxWidth: "100%", border: true, borderStyle: "rounded", borderColor: colors.accent,
      backgroundColor: colors.panel, paddingX: 2, paddingY: 1, flexDirection: "column",
      title: " SURPRISE ME ", titleAlignment: "center",
    });
    this.card.add(text({ content: t`${bold("L A N G U A G E   R O U L E T T E")}`, fg: colors.text }));
    this.subtitle = text({ marginBottom: 1 });
    this.reel = new BoxRenderable(renderer, {
      width: "100%", height: 5, flexShrink: 0, flexDirection: "column", border: ["top", "bottom"],
      borderColor: colors.accent, backgroundColor: colors.selected,
    });
    this.previous = text({});
    this.current = text({ fg: colors.accent });
    this.next = text({});
    this.reel.add(this.previous);
    this.reel.add(this.current);
    this.reel.add(this.next);
    this.status = text({ marginTop: 1 });
    this.meter = text({});
    this.hint = text({ content: "Esc cancel · switches automatically", marginTop: 1 });
    this.card.add(this.subtitle);
    this.card.add(this.reel);
    this.card.add(this.status);
    this.card.add(this.meter);
    this.card.add(this.hint);
    this.overlay.add(this.card);
  }

  get visible(): boolean {
    return this.overlay.visible;
  }

  async play(languages: readonly SolutionLanguage[], signal: AbortSignal): Promise<SolutionLanguage | undefined> {
    const spin = createLanguageSpin(languages);
    if (!spin) return;
    if (languages.length === 1) return spin.winner;
    signal.throwIfAborted();
    this.subtitle.content = `${languages.length} languages · leave your comfort zone`;
    this.overlay.visible = true;
    try {
      for (const [index, frame] of spin.frames.entries()) {
        this.renderFrame(spin, index);
        await delay(frame.duration, signal);
      }
      return spin.winner;
    } catch (error) {
      if (!isAbort(error)) throw error;
      return;
    } finally {
      if (!this.renderer.isDestroyed) this.overlay.visible = false;
    }
  }

  private renderFrame(spin: LanguageSpin, index: number): void {
    const frame = spin.frames[index];
    if (!frame || this.renderer.isDestroyed) return;
    const landed = index === spin.frames.length - 1;
    const slowing = index >= 12;
    const tint = landed ? colors.success : slowing ? "#efb77a" : colors.accent;
    this.card.borderColor = tint;
    this.card.titleColor = tint;
    this.reel.borderColor = tint;
    this.previous.content = landed ? "·   ✧   ·" : terminalText(spin.frames[index - 1]?.language.lang || "· · ·");
    this.current.content = t`${fg(tint)(bold(`${landed ? "✦" : "▸"}  ${terminalText(frame.language.lang)}  ${landed ? "✦" : "◂"}`))}`;
    this.next.content = landed ? "·   ✧   ·" : terminalText(spin.frames[index + 1]?.language.lang || "· · ·");
    this.status.content = landed ? "✦ YOUR NEXT CHALLENGE ✦" : `${["◜", "◠", "◝", "◞", "◡", "◟"][index % 6]}  ${slowing ? "SLOWING DOWN" : "SHUFFLING THE POSSIBILITIES"}`;
    this.status.fg = tint;
    const filled = Math.round((index + 1) / spin.frames.length * 24);
    this.meter.content = t`${fg(tint)("━".repeat(filled))}${fg(colors.border)("─".repeat(24 - filled))}`;
    this.hint.content = landed ? "Opening your saved solution…" : "Esc cancel · switches automatically";
  }
}
