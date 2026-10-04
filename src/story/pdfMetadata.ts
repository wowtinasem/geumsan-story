import { heroTitleWord, type HeroType } from "./heroOptions";

export type StoryPdfMetadataInput = {
  classId: string;
  characterName: string;
  place?: string;
  gender?: HeroType;
  age?: string;
  createdAt: Date;
};

export function buildStoryPdfMetadata(input: StoryPdfMetadataInput) {
  const date = input.createdAt.toISOString().slice(0, 10);
  const genderLabel = heroTitleWord(input.gender, input.age);
  const place = input.place?.trim() || "이야기 나라";

  return {
    // 내용에 맞춘 제목: "{호칭} {주인공}의 {장소} 모험" (호칭 예: 소녀, 할머니, 아기 로봇)
    title: `${genderLabel} ${input.characterName}의 ${place} 모험`,
    schoolLabel: "금산교육지원청 찾아가는 AI동화 수업",
    filename: `${input.classId}-story-${date}.pdf`
  };
}
