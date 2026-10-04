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
      schoolLabel: "금산교육지원청 찾아가는 AI동화 수업",
      filename: "M-01-story-2026-06-06.pdf"
    });
  });

  test("uses the student label for the file name when given", () => {
    expect(
      buildStoryPdfMetadata({
        classId: "geumsan",
        characterName: "가야",
        createdAt: new Date("2026-10-06T00:00:00.000Z"),
        ownerLabel: "금산중앙초_5-3-7_이도윤"
      }).filename
    ).toBe("금산중앙초_5-3-7_이도윤_동화.pdf");
  });
});
