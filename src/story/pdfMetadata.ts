export type StoryPdfMetadataInput = {
  classId: string;
  characterName: string;
  place?: string;
  gender?: "boy" | "girl" | "robot";
  createdAt: Date;
};

export function buildStoryPdfMetadata(input: StoryPdfMetadataInput) {
  const date = input.createdAt.toISOString().slice(0, 10);
  const genderLabel = input.gender === "boy" ? "소년" : input.gender === "robot" ? "로봇" : "소녀";
  const place = input.place?.trim() || "이야기 나라";

  return {
    // 내용에 맞춘 제목: "{소년/소녀} {주인공}의 {장소} 모험"
    title: `${genderLabel} ${input.characterName}의 ${place} 모험`,
    schoolLabel: "모산초등학교 3~6학년 동화 만들기",
    filename: `${input.classId}-story-${date}.pdf`
  };
}
