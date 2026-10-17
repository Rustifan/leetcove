import { expect, test } from "bun:test";
import { createLanguageSpin, type SolutionLanguage } from "../src/utils/random-language.ts";

const languages: SolutionLanguage[] = [
  { lang: "Python3", langSlug: "python3" },
  { lang: "Rust", langSlug: "rust" },
  { lang: "TypeScript", langSlug: "typescript" },
  { lang: "Go", langSlug: "golang" },
];

test("every supported language has an equal random interval, including the current language", () => {
  for (const [index, language] of languages.entries()) {
    const spin = createLanguageSpin(languages, () => (index + 0.5) / languages.length);
    expect(spin?.winner).toEqual(language);
    expect(spin?.frames.at(-1)?.language).toEqual(language);
  }
  expect(createLanguageSpin(languages, () => 0)?.winner).toEqual(languages[0]);
  expect(createLanguageSpin(languages, () => 0.999999)?.winner).toEqual(languages.at(-1));
});

test("the reel starts fast, slows dramatically for the last picks, and holds the winner without dragging on", () => {
  const original = structuredClone(languages);
  const spin = createLanguageSpin(languages, () => 0.6);
  if (!spin) throw new Error("Expected a language spin.");
  expect(languages).toEqual(original);
  expect(spin.frames).toHaveLength(19);
  expect(spin.frames.every((frame) => languages.includes(frame.language))).toBe(true);
  expect(spin.frames[0]?.duration).toBe(28);
  expect(spin.frames.at(-2)?.duration).toBeGreaterThanOrEqual(400);
  expect(spin.frames.at(-1)?.duration).toBe(1_200);
  for (const [index, frame] of spin.frames.entries()) {
    if (index === 0) continue;
    const previous = spin.frames[index - 1];
    expect(frame.language).not.toEqual(previous?.language);
    expect(frame.duration).toBeGreaterThanOrEqual(previous?.duration || 0);
  }
  const duration = spin.frames.reduce((total, frame) => total + frame.duration, 0);
  expect(duration).toBeGreaterThan(3_000);
  expect(duration).toBeLessThan(3_500);
});

test("even a two-language reel has a distinct last tick before revealing the winner", () => {
  const spin = createLanguageSpin(languages.slice(0, 2), () => 0);
  expect(spin?.frames.at(-2)?.language.langSlug).toBe("rust");
  expect(spin?.frames.at(-1)?.language.langSlug).toBe("python3");
});

test("empty and single-language pools are safe", () => {
  expect(createLanguageSpin([])).toBeUndefined();
  const spin = createLanguageSpin(languages.slice(0, 1));
  expect(spin?.winner).toEqual(languages[0]);
  expect(spin?.frames.every((frame) => frame.language === languages[0])).toBe(true);
});
