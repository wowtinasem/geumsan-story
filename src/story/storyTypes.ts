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
  };
  trait: { id: string; label: string };
  place: { id: string; name: string; sceneKey: string };
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
