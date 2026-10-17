import type { Problem } from "../api/schemas.ts";

export type SolutionLanguage = Pick<NonNullable<Problem["codeSnippets"]>[number], "lang" | "langSlug">;

export interface LanguageSpin {
  winner: SolutionLanguage;
  frames: { language: SolutionLanguage; duration: number }[];
}

function pickLanguage(languages: readonly SolutionLanguage[], random: () => number): SolutionLanguage | undefined {
  return languages[Math.floor(random() * languages.length)];
}

export function createLanguageSpin(languages: readonly SolutionLanguage[], random: () => number = Math.random): LanguageSpin | undefined {
  const winner = pickLanguage(languages, random);
  if (!winner) return;
  const previewCount = 18;
  const reel = Array.from({ length: previewCount }).reduce<SolutionLanguage[]>((next) => {
    const candidates = languages.filter((language) => language.langSlug !== next[0]?.langSlug);
    return [pickLanguage(candidates, random) || winner, ...next];
  }, [winner]);
  const frames = reel.map((language, index) => ({
    language,
    duration: index === previewCount ? 1_200 : 28 + Math.round(420 * (index / (previewCount - 1)) ** 5),
  }));
  return { winner, frames };
}
