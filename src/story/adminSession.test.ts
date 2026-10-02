import { describe, expect, test } from "vitest";
import { gradeLevelFor, sessionLabel } from "./adminSession";

describe("sessionLabel", () => {
  test("shows school, grade, number and name for a student", () => {
    expect(
      sessionLabel({ role: "student", student: { school: "금산초등학교", grade: 4, number: 12, name: "홍길동" } })
    ).toBe("금산초등학교 4학년 12번 홍길동");
  });

  test("shows 관리자 for the admin", () => {
    expect(sessionLabel({ role: "admin" })).toBe("관리자");
  });
});

describe("gradeLevelFor", () => {
  test("maps grades 1-4 to the 3-4 level and 5-6 to the 5-6 level", () => {
    expect([1, 2, 3, 4].map(gradeLevelFor)).toEqual(["3-4", "3-4", "3-4", "3-4"]);
    expect([5, 6].map(gradeLevelFor)).toEqual(["5-6", "5-6"]);
  });
});
