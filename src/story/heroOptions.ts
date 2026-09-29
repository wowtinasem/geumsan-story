// 주인공 유형·나이대 선택지.
// label = 화면 버튼, word = 동화 글·PDF 제목에 쓰는 한국어 호칭, desc = 그림 프롬프트용 영어.

export type HeroType = "man" | "woman" | "boy" | "girl" | "robot";

export type HeroAgeOption = {
  id: string;
  label: string;
  sub: string;
  word: string;
  desc: string;
};

export const heroTypes: { id: HeroType; label: string }[] = [
  { id: "man", label: "남성" },
  { id: "woman", label: "여성" },
  { id: "boy", label: "남자 어린이" },
  { id: "girl", label: "여자 어린이" },
  { id: "robot", label: "로봇" }
];

const childAges = (childWord: string): HeroAgeOption[] => [
  { id: "toddler", label: "유아", sub: "5~7살", word: "꼬마", desc: "a small preschool child around 5-7 years old" },
  { id: "kid", label: "어린이", sub: "8~10살", word: childWord, desc: "a child around 8-10 years old" },
  { id: "preteen", label: "큰 어린이", sub: "11~13살", word: childWord, desc: "an older child around 11-13 years old" }
];

const adultAges = (middleWord: string, oldWord: string): HeroAgeOption[] => [
  { id: "young", label: "청년", sub: "20대", word: "청년", desc: "a young adult in their twenties" },
  { id: "adult", label: "어른", sub: "30~40대", word: middleWord, desc: "an adult in their thirties or forties" },
  { id: "middle", label: "중년", sub: "50~60대", word: middleWord, desc: "a middle-aged adult in their fifties or sixties, a few gentle wrinkles" },
  { id: "old", label: "노년", sub: "70살 이상", word: oldWord, desc: "an elderly person over seventy, gray or white hair streaks, kind wrinkles" }
];

export const heroAgeOptions: Record<HeroType, HeroAgeOption[]> = {
  boy: childAges("소년"),
  girl: childAges("소녀"),
  man: adultAges("아저씨", "할아버지"),
  woman: adultAges("아주머니", "할머니"),
  robot: [
    { id: "baby", label: "아기 로봇", sub: "막 만들어진", word: "아기 로봇", desc: "a tiny newly built baby robot, very small and round, shiny brand-new panels" },
    { id: "kid", label: "어린이 로봇", sub: "꼬마 크기", word: "로봇", desc: "a child-sized small robot" },
    { id: "old", label: "오래된 로봇", sub: "할아버지 로봇", word: "오래된 로봇", desc: "an old, well-worn vintage robot with slightly scratched panels and a kind, wise look" }
  ]
};

// 유형을 바꾸면 이 나이대로 돌아간다.
export const defaultHeroAgeId: Record<HeroType, string> = {
  boy: "kid",
  girl: "kid",
  man: "adult",
  woman: "adult",
  robot: "kid"
};

export function isHeroType(value: unknown): value is HeroType {
  return heroTypes.some((type) => type.id === value);
}

export function getHeroAge(type: HeroType, ageId?: string): HeroAgeOption {
  const options = heroAgeOptions[type];
  return options.find((option) => option.id === ageId) || options.find((option) => option.id === defaultHeroAgeId[type]) || options[0];
}

// PDF 표지·제목에 쓰는 호칭. 예: "할머니", "꼬마", "소녀", "오래된 로봇"
export function heroTitleWord(type: HeroType | undefined, ageId?: string) {
  return getHeroAge(isHeroType(type) ? type : "girl", ageId).word;
}

// 동화 글 프롬프트에 넣는 설명. 예: "여성, 노년(70살 이상) 할머니"
export function heroStoryLabel(type: HeroType, ageId?: string) {
  const typeLabel = heroTypes.find((item) => item.id === type)?.label || "";
  const age = getHeroAge(type, ageId);
  return `${typeLabel}, ${age.label}(${age.sub}) ${age.word}`;
}
