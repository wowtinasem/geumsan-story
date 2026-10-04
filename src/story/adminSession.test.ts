import { describe, expect, test } from "vitest";
import { sessionLabel } from "./adminSession";

describe("sessionLabel", () => {
  test("shows school, grade, number and name for a student", () => {
    expect(
      sessionLabel({ role: "student", student: { school: "금산초등학교", grade: 4, classNo: 2, number: 12, name: "홍길동" } })
    ).toBe("금산초등학교 4학년 2반 12번 홍길동");
  });

  test("shows 관리자 for the admin", () => {
    expect(sessionLabel({ role: "admin" })).toBe("관리자");
  });
});
