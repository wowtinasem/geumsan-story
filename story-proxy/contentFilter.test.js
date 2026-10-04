import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { containsBlockedWord, selectionHasBlockedWord } from "./contentFilter.js";

describe("contentFilter", () => {
  it("blocks swear words even with spaces, symbols, or digits in between", () => {
    for (const text of ["씨발", "씨 1 발", "시.발", "ㅅㅂ", "병 신", "개새끼야", "FUCK"]) assert.equal(containsBlockedWord(text), true, text);
  });

  it("blocks violent, sexual, and drug words", () => {
    for (const text of ["친구를 죽여", "자살", "섹스", "마약을 했다", "담배를 피웠다", "칼로찌르다"]) assert.equal(containsBlockedWord(text), true, text);
  });

  it("keeps ordinary story words", () => {
    for (const text of ["새끼 고양이", "시바견 콩이", "피아노", "피자", "칼로리", "죽순", "하늘", "용감한", "금산 하늘물빛정원", "엉뚱한"]) {
      assert.equal(containsBlockedWord(text), false, text);
    }
  });

  it("checks every student-written field in a selection", () => {
    const base = {
      character: { name: "하늘", features: ["안경"] },
      trait: { label: "용감한" },
      place: { name: "적벽강" },
      events: { opening: { label: "a" }, development: { label: "b" }, climax: { label: "c" }, ending: { label: "d" } }
    };
    assert.equal(selectionHasBlockedWord(base), false);
    assert.equal(selectionHasBlockedWord({ ...base, character: { name: "병신" } }), true);
    assert.equal(selectionHasBlockedWord({ ...base, place: { name: "마약 공장" } }), true);
    assert.equal(selectionHasBlockedWord({ ...base, events: { ...base.events, climax: { label: "친구를 죽였다" } } }), true);
  });
});
