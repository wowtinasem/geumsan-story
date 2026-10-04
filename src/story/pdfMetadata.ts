import { heroTitleWord, type HeroType } from "./heroOptions";

export type StoryPdfMetadataInput = {
  classId: string;
  characterName: string;
  place?: string;
  gender?: HeroType;
  age?: string;
  createdAt: Date;
  // 파일 이름 앞부분 (예: "금산중앙초_5-3-7_이도윤"). 패들렛에 올릴 때 누구 것인지 알아보기 쉽게.
  ownerLabel?: string;
};

export function buildStoryPdfMetadata(input: StoryPdfMetadataInput) {
  const date = input.createdAt.toISOString().slice(0, 10);
  const genderLabel = heroTitleWord(input.gender, input.age);
  const place = input.place?.trim() || "이야기 나라";

  return {
    // 내용에 맞춘 제목: "{호칭} {주인공}의 {장소} 모험" (호칭 예: 소녀, 할머니, 아기 로봇)
    title: `${genderLabel} ${input.characterName}의 ${place} 모험`,
    schoolLabel: "금산교육지원청 찾아가는 AI동화 수업",
    filename: input.ownerLabel?.trim()
      ? `${input.ownerLabel.trim().replace(/[\\/:*?"<>|\s]+/g, "_")}_동화.pdf`
      : `${input.classId}-story-${date}.pdf`
  };
}
