import { describe, expect, test } from "vitest";
import { buildStoryPdfMetadata } from "./pdfMetadata";
import { defaultHeroAgeId, getHeroAge, heroAgeOptions, heroStoryLabel, heroTitleWord, heroTypes } from "./heroOptions";

describe("heroOptions", () => {
  test("offers five hero types in the requested order", () => {
    expect(heroTypes.map((type) => type.label)).toEqual(["남성", "여성", "남자 어린이", "여자 어린이", "로봇"]);
  });

  test("every type has age buttons and a valid default age", () => {
    for (const type of heroTypes) {
      const options = heroAgeOptions[type.id];
      expect(options.length).toBeGreaterThanOrEqual(3);
      expect(options.map((option) => option.id)).toContain(defaultHeroAgeId[type.id]);
    }
  });

  test("uses age-aware title words", () => {
    expect(heroTitleWord("woman", "old")).toBe("할머니");
    expect(heroTitleWord("man", "old")).toBe("할아버지");
    expect(heroTitleWord("boy", "toddler")).toBe("꼬마");
    expect(heroTitleWord("girl", "kid")).toBe("소녀");
    expect(heroTitleWord("robot", "baby")).toBe("아기 로봇");
  });

  test("falls back to the type's default age for unknown age ids", () => {
    expect(getHeroAge("man", "toddler").id).toBe("adult");
    expect(heroTitleWord(undefined, undefined)).toBe("소녀");
  });

  test("builds a Korean label for the story prompt", () => {
    expect(heroStoryLabel("woman", "old")).toBe("여성, 노년(70살 이상) 할머니");
  });

  test("puts the age-aware word into the PDF title", () => {
    const meta = buildStoryPdfMetadata({
      classId: "geumsan",
      characterName: "순이",
      place: "적벽강",
      gender: "woman",
      age: "old",
      createdAt: new Date("2026-09-29T03:00:00.000Z")
    });
    expect(meta.title).toBe("할머니 순이의 적벽강 모험");
  });
});
