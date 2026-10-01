import { describe, expect, test } from "vitest";
import { buildStoryPdfMetadata } from "./pdfMetadata";

describe("buildStoryPdfMetadata", () => {
  test("creates a stable child-friendly PDF title and filename", () => {
    expect(
      buildStoryPdfMetadata({
        classId: "M-01",
        characterName: "가야",
        place: "적벽강",
        gender: "girl",
        createdAt: new Date("2026-06-06T03:00:00.000Z")
      })
    ).toEqual({
      title: "소녀 가야의 적벽강 모험",
      schoolLabel: "모산초등학교 3~6학년 동화 만들기",
      filename: "M-01-story-2026-06-06.pdf"
    });
  });
});
