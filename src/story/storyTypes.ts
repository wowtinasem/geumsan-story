import type { HeroType } from "./heroOptions";

export type Choice = {
  id: string;
  label: string;
};

export type CharacterChoice = {
  id: string;
  name: string;
  emoji: string;
  color: string;
};

export type PlaceChoice = {
  id: string;
  name: string;
  sceneKey: string;
  color: string;
  imageSrc: string;
};

export type StorySelection = {
  character: {
    id: string;
    name: string;
    emoji?: string;
    gender?: HeroType;
    // 나이대 id와, 프록시 프롬프트용 설명(heroLabel=한국어, ageDesc=영어)
    age?: string;
    heroLabel?: string;
    ageDesc?: string;
    hair?: string;
    features?: string[];
    // "직접 쓰기"로 쓴 주인공 모습(옷차림 포함). 골라서 선택한 특징(features)과 함께 쓰지 않는다.
    lookText?: string;
  };
  trait: { id: string; label: string };
  place: { id: string; name: string; sceneKey: string };
  // 그림 스타일 id (artStyles.ts). 없으면 기본 3D
  artStyle?: string;
  events: {
    opening: Choice;
    development: Choice;
    climax: Choice;
    ending: Choice;
  };
};

export type StoryResult = {
  pages: string[];
  source: "ai" | "local";
  provider?: string;
};
