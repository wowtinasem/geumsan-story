"use client";

import { defaultHeroAgeId, getHeroAge, heroAgeOptions, heroStoryLabel, heroTypes, type HeroType } from "./heroOptions";
import {
  ArrowLeftIcon,
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ArrowRightIcon,
  CheckIcon,
  HomeIcon,
  MusicalNoteIcon,
  PrinterIcon,
  SparklesIcon,
  VideoCameraIcon,
  FilmIcon
} from "@heroicons/react/24/solid";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildStoryPdfMetadata } from "./pdfMetadata";
import {
  clearAdminSession,
  clearRetiredClassSessions,
  readAdminSession,
  requestAdminLogin,
  requestStudentLogin,
  sessionLabel,
  requestAdminLogout,
  verifyAdminSession,
  writeAdminSession
} from "./adminSession";
import { getKioskArtworkSource } from "./storyArtwork";
import { characters, eventGroups, places, traits } from "./storyData";
import { isGeneratedSceneImage } from "./imageGeneration";
import { checkProxyHealth, generateSceneImage, generateStory, localStory } from "./storyEngine";
import { buildStoryVideo } from "./storyVideo";
import { generatePageVideo } from "./storyVideoApi";
import {
  defaultMusicGenreId,
  getMusicGenre,
  musicGenres,
  nextMusicState,
  type StoryMusicGenre,
  type StoryMusicGenreId,
  type StoryMusicState
} from "./storyMusic";
import type { CharacterChoice, Choice, PlaceChoice, StoryResult, StorySelection } from "./storyTypes";

type Step = "login" | "attract" | "character" | "trait" | "place" | "events" | "loading" | "result";
type ImageGenerationMode = "cover" | "print" | null;
type SavedStory = {
  id: string;
  createdAt: string;
  character: CharacterChoice;
  trait: Choice;
  place: PlaceChoice;
  events: StorySelection["events"];
  story: StoryResult;
  sceneImages: Record<number, string>;
};

const stepOrder: Step[] = ["character", "trait", "place", "events"];
const stepLabels = ["주인공", "성격", "배경", "사건"];

const defaultCharacter = characters[0];
const defaultTrait = traits[0];
const defaultPlace = places[0];

// 주인공 외형 옵션 (label=화면 표시 한글, desc=이미지 프롬프트용 영어, swatch=머리색 미리보기)
const hairColors: { id: string; label: string; desc: string; swatch: string }[] = [
  { id: "black", label: "검정", desc: "black hair", swatch: "#222530" },
  { id: "brown", label: "갈색", desc: "brown hair", swatch: "#7B4A26" },
  { id: "blonde", label: "금발", desc: "golden blonde hair", swatch: "#E8C261" },
  { id: "red", label: "빨강", desc: "ginger red hair", swatch: "#C5502E" },
  { id: "pink", label: "분홍", desc: "pastel pink hair", swatch: "#F19ABF" },
  { id: "blue", label: "파랑", desc: "soft blue hair", swatch: "#5AA9E6" }
];
const heroFeatures: { id: string; label: string; desc: string }[] = [
  { id: "glasses", label: "안경", desc: "round glasses" },
  { id: "freckles", label: "주근깨", desc: "cute freckles" },
  { id: "curly", label: "곱슬머리", desc: "curly hair" },
  { id: "cap", label: "모자", desc: "a cap" },
  { id: "dimples", label: "보조개", desc: "dimples" },
  { id: "backpack", label: "가방", desc: "a small backpack" }
];
const defaultHairColor = hairColors[0];
const savedStoriesKey = "geumsan-ai-story.savedStories.v1";
const maxSavedStories = 8;
const blockedCustomWords = ["바보", "죽", "살인", "폭력", "피", "혐오", "욕", "나쁜말"];
const schoolLabel = "금산교육지원청 찾아가는 AI동화 수업 · 초등 3~6학년";

function sanitizeCustomChoice(value: string) {
  return value
    .replace(/[^\u3131-\u318e\uac00-\ud7a3a-zA-Z0-9 .,!?~\-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24);
}

const maxFeatureTextLength = 40;

// 특징 직접 쓰기: 입력 중에는 앞뒤 공백을 남겨 둬야 띄어쓰기를 칠 수 있다. 사용할 때 trim 한다.
function sanitizeFeatureText(value: string) {
  return value
    .replace(/[^\u3131-\u318e\uac00-\ud7a3a-zA-Z0-9 .,!?~\-]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, maxFeatureTextLength);
}

function isBlockedCustomChoice(value: string) {
  const normalized = value.replace(/\s+/g, "").toLowerCase();
  return blockedCustomWords.some((word) => normalized.includes(word));
}

function readSavedStories() {
  if (typeof window === "undefined") return [];

  try {
    const value = window.localStorage.getItem(savedStoriesKey);
    if (!value) return [];
    const stories = JSON.parse(value);
    if (!Array.isArray(stories)) return [];

    const validStories = stories.filter((story): story is SavedStory => {
      return Boolean(
        story &&
        typeof story.id === "string" &&
        typeof story.createdAt === "string" &&
        story.character &&
        typeof story.character.id === "string" &&
        typeof story.character.name === "string" &&
        story.trait &&
        typeof story.trait.id === "string" &&
        typeof story.trait.label === "string" &&
        story.place &&
        typeof story.place.id === "string" &&
        typeof story.place.name === "string" &&
        story.events &&
        story.story &&
        Array.isArray(story.story.pages)
      );
    });

    if (validStories.length !== stories.length) {
      writeSavedStories(validStories);
    }

    return validStories;
  } catch {
    window.localStorage.removeItem(savedStoriesKey);
    return [];
  }
}

function writeSavedStories(stories: SavedStory[]) {
  try {
    window.localStorage.setItem(savedStoriesKey, JSON.stringify(stories.slice(0, maxSavedStories)));
  } catch {
    window.localStorage.removeItem(savedStoriesKey);
  }
}

function formatSavedStoryDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "저장된 동화";

  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function mascotGuideForStep(step: Step, characterName: string) {
  switch (step) {
    case "character":
      return "안녕! 나는 금산 인삼 요정 삼이야. 1단계: 주인공을 골라주세요.";
    case "trait":
      return `2단계: ${characterName}의 성격을 선택해주세요.`;
    case "place":
      return "3단계: 이야기 배경을 골라주세요.";
    case "events":
      return "4단계: 기승전결 사건을 차례대로 선택해주세요.";
    case "loading":
      return "삼이가 멋진 동화를 만들고 있어요. 잠시만 기다려주세요.";
    case "result":
      return "";
    default:
      return "";
  }
}

function buildSelection(
  character: CharacterChoice,
  trait: Choice,
  place: PlaceChoice,
  events: StorySelection["events"],
  heroName = "",
  gender: HeroType = "girl",
  hair = "",
  features: string[] = [],
  ageId?: string
): StorySelection {
  const name = heroName.trim() || "주인공";
  const age = getHeroAge(gender, ageId);
  return {
    character: {
      id: character.id,
      name,
      emoji: character.emoji,
      gender,
      age: age.id,
      heroLabel: heroStoryLabel(gender, age.id),
      ageDesc: age.desc,
      hair,
      features
    },
    trait,
    place: { id: place.id, name: place.name, sceneKey: place.sceneKey },
    events
  };
}

function choiceButtonClass(active: boolean) {
  return [
    "group min-h-0 rounded-3xl border-2 p-3 text-left shadow-[0_0_22px_rgba(36,77,255,0.16)] transition duration-200 ease-out sm:p-4",
    "active:scale-[0.98] focus:outline-none focus:ring-4 focus:ring-[#F2B33D]/40",
    active
      ? "border-[#FFB15D] bg-[#2E2442] text-white shadow-[0_0_28px_rgba(255,177,93,0.28)]"
      : "border-[#73DFFF]/25 bg-[#151F41] text-[#E8FCFF] hover:-translate-y-1 hover:border-[#FFB15D]"
  ].join(" ");
}

function compactChoiceButtonClass(active: boolean) {
  return [
    "group min-h-0 rounded-2xl border-2 p-2 text-left shadow-[0_0_18px_rgba(36,77,255,0.13)] transition duration-200 ease-out",
    "active:scale-[0.98] focus:outline-none focus:ring-4 focus:ring-[#F2B33D]/40",
    active
      ? "border-[#FFB15D] bg-[#2E2442] text-white shadow-[0_0_24px_rgba(255,177,93,0.24)]"
      : "border-[#73DFFF]/25 bg-[#151F41] text-[#E8FCFF] hover:-translate-y-0.5 hover:border-[#FFB15D]"
  ].join(" ");
}

function Progress({ activeStep }: { activeStep: Step }) {
  const index = Math.max(0, stepOrder.indexOf(activeStep));

  return (
    <div className="flex items-center gap-3" aria-label="진행 단계">
      {stepLabels.map((label, itemIndex) => {
        const active = itemIndex <= index;
        return (
          <div key={label} className="flex items-center gap-2">
            <span
              className={[
                "grid h-9 w-9 place-items-center rounded-full border-2 text-sm font-black",
                active ? "border-[#FFB15D] bg-[#F0633C] text-white" : "border-[#73DFFF]/30 bg-[#101A38]/80 text-[#D4F5FF]"
              ].join(" ")}
            >
              {itemIndex + 1}
            </span>
            <span className="hidden text-sm font-bold text-[#D4F5FF] md:inline">{label}</span>
          </div>
        );
      })}
    </div>
  );
}

function StatusPill({
  health
}: {
  health: { ok: boolean; provider: string; model: string; keyLoaded: boolean } | null;
}) {
  const connected = Boolean(health?.ok && health.keyLoaded);

  return (
    <div className="rounded-full border border-[#7DE8FF]/30 bg-[#101A38]/80 px-4 py-2 text-sm font-black text-white shadow-[0_0_22px_rgba(125,232,255,0.18)]">
      <span className={connected ? "text-[#7DFFD4]" : "text-[#FFD073]"}>{connected ? "AI 연결됨" : "내장 엔진 준비"}</span>
      {health?.provider ? <span className="ml-2 text-[#D4F5FF]">{health.provider}</span> : null}
    </div>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled = false
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl border-2 border-[#FFB15D] bg-[#F0633C] px-6 text-base font-black text-white shadow-[0_0_26px_rgba(240,99,60,0.32)] transition hover:-translate-y-1 hover:bg-[#D94E2B] active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-[#6B5C72] disabled:shadow-none"
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  children,
  onClick,
  disabled = false
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border-2 border-[#73DFFF]/55 bg-[#101A38]/72 px-5 text-sm font-black text-[#DDFBFF] transition hover:-translate-y-0.5 hover:border-[#FFB15D] active:scale-[0.98] disabled:cursor-not-allowed disabled:border-[#73DFFF]/20 disabled:text-[#D4F5FF]/45 disabled:hover:translate-y-0"
    >
      {children}
    </button>
  );
}

function HeaderActionButton({
  children,
  onClick
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-2xl border border-[#FFB15D]/65 bg-[#F0633C] px-3 text-sm font-black text-white shadow-[0_0_18px_rgba(240,99,60,0.22)] transition active:scale-[0.98]"
    >
      {children}
    </button>
  );
}

function KioskArtwork({
  imageSrc,
  generatedImage,
  guideText
}: {
  imageSrc: string;
  generatedImage?: string;
  guideText: string;
}) {
  return (
    <div className="pointer-events-none absolute inset-6 z-0 overflow-hidden rounded-[24px] border border-[#73DFFF]/20 bg-[#0B1230] shadow-[inset_0_0_60px_rgba(0,0,0,0.45)]">
      {generatedImage ? (
        <div
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover"
          style={{ backgroundImage: `url(${generatedImage})`, backgroundPosition: "center", backgroundSize: "cover" }}
        />
      ) : (
        <div
          aria-hidden="true"
          className="absolute inset-0 h-full w-full"
          style={{ backgroundImage: `url(${imageSrc})`, backgroundPosition: "center", backgroundSize: "cover" }}
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-[#090D20]/50 via-transparent to-[#090D20]/5" />
      {guideText ? (
        <div className="absolute bottom-16 left-7 flex max-w-[calc(100%-56px)] items-end gap-3">
          <img
            src="/images/ginseng-mascot-transparent.png"
            alt=""
            aria-hidden="true"
            className="story-mascot-float h-28 w-28 shrink-0 object-contain drop-shadow-[0_18px_24px_rgba(0,0,0,0.3)] sm:h-32 sm:w-32"
            draggable={false}
          />
          <div className="relative mb-7 max-w-[360px] rounded-2xl border-2 border-[#FFB15D]/75 bg-white px-5 py-4 text-left text-base font-black leading-snug text-[#24304B] shadow-[0_14px_28px_rgba(0,0,0,0.24)]">
            <span className="absolute -left-3 bottom-5 h-5 w-5 rotate-45 border-b-2 border-l-2 border-[#FFB15D]/75 bg-white" />
            {guideText}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MiniPlaceArt({ place }: { place: PlaceChoice }) {
  const scene = place.sceneKey;

  if (place.imageSrc) {
    return (
      <span className="relative mb-1.5 block h-12 overflow-hidden rounded-xl border border-[#73DFFF]/30 bg-[#111A39] shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_10px_22px_rgba(0,0,0,0.22)]">
        <img
          src={place.imageSrc}
          alt=""
          aria-hidden="true"
          className="h-full w-full scale-110 object-cover"
          draggable={false}
        />
        <span className="absolute inset-0 bg-[radial-gradient(circle_at_72%_18%,rgba(255,245,169,0.32),transparent_30%),linear-gradient(180deg,rgba(255,255,255,0.12),rgba(8,14,35,0.12))]" />
      </span>
    );
  }

  return (
    <span className="relative mb-1.5 block h-12 overflow-hidden rounded-xl border border-[#73DFFF]/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_10px_22px_rgba(0,0,0,0.22)]">
      <span
        className="absolute inset-0"
        style={{
          background:
            scene === "sea"
              ? "radial-gradient(circle at 80% 18%,#FFF2A2,transparent 16%),linear-gradient(180deg,#69E7FF 0%,#229BE4 48%,#074178 100%)"
              : scene === "cloud"
                ? "radial-gradient(circle at 75% 18%,#FFF1B8,transparent 18%),linear-gradient(180deg,#AFC4FF 0%,#F2FBFF 52%,#8C9EF1 100%)"
                : `radial-gradient(circle at 78% 16%, #FFF0A8, transparent 18%), radial-gradient(circle at 18% 18%, rgba(255,255,255,0.58), transparent 18%), linear-gradient(135deg, ${place.color}, #244066 66%, #111A39)`
        }}
      />
      {scene === "village" ? (
        <>
          <span className="absolute inset-x-0 bottom-0 h-7 rounded-t-[55%] bg-[linear-gradient(180deg,#99D982,#4FAE67)]" />
          <span className="absolute bottom-4 left-5 h-8 w-10 rounded-t-2xl rounded-b-md bg-[linear-gradient(145deg,#FFE1A5,#E99C58)] shadow-[inset_-4px_-5px_8px_rgba(122,60,34,0.18),0_6px_10px_rgba(0,0,0,0.18)]" />
          <span className="absolute bottom-11 left-3 h-0 w-0 border-x-[26px] border-b-[24px] border-x-transparent border-b-[#E56F47] drop-shadow-[0_4px_3px_rgba(0,0,0,0.2)]" />
          <span className="absolute bottom-4 left-20 h-9 w-9 rounded-t-2xl rounded-b-md bg-[linear-gradient(145deg,#FFF0B7,#F4B96A)] shadow-[inset_-4px_-5px_8px_rgba(122,60,34,0.18),0_6px_10px_rgba(0,0,0,0.18)]" />
          <span className="absolute bottom-[52px] left-[70px] h-0 w-0 border-x-[26px] border-b-[27px] border-x-transparent border-b-[#F07D4D] drop-shadow-[0_4px_3px_rgba(0,0,0,0.2)]" />
          <span className="absolute bottom-5 right-7 h-5 w-9 rounded-full bg-[#FFE07A]/85 blur-[1px]" />
        </>
      ) : null}
      {scene === "forest" ? (
        <>
          <span className="absolute inset-x-0 bottom-0 h-6 rounded-t-[60%] bg-[linear-gradient(180deg,#67C978,#2D7545)]" />
          {[18, 48, 82, 118].map((left) => (
            <span key={left} className="absolute bottom-4 h-12 w-9 rounded-t-full bg-[linear-gradient(145deg,#82E6A2,#2FAE66)] shadow-[inset_-5px_-7px_9px_rgba(9,80,45,0.22),0_7px_10px_rgba(0,0,0,0.18)]" style={{ left }} />
          ))}
          <span className="absolute bottom-3 right-8 h-10 w-11 rounded-t-full bg-[linear-gradient(145deg,#FFB19E,#F16F5D)] shadow-[inset_-5px_-6px_8px_rgba(129,40,38,0.2)]" />
        </>
      ) : null}
      {scene === "island" ? (
        <>
          <span className="absolute inset-x-0 bottom-0 h-7 bg-[linear-gradient(180deg,#2BAFE4,#1267A9)]" />
          <span className="absolute bottom-5 left-8 h-7 w-24 rounded-[50%] bg-[linear-gradient(145deg,#FFE98C,#F6BB4B)] shadow-[0_7px_12px_rgba(0,0,0,0.2)]" />
          <span className="absolute bottom-10 left-16 h-11 w-3 rounded-full bg-[linear-gradient(90deg,#A96A37,#71411F)]" />
          <span className="absolute bottom-[68px] left-14 h-8 w-16 -rotate-12 rounded-[50%] bg-[linear-gradient(145deg,#74DE8E,#35A95A)] shadow-[inset_-5px_-5px_8px_rgba(22,92,45,0.22)]" />
          <span className="absolute bottom-[60px] left-8 h-7 w-14 rotate-12 rounded-[50%] bg-[linear-gradient(145deg,#8AF0A5,#40BA66)]" />
        </>
      ) : null}
      {scene === "sea" ? (
        <>
          <span className="absolute left-0 top-6 h-3 w-full bg-[linear-gradient(90deg,transparent,#B9F7FF,transparent,#B9F7FF,transparent)] opacity-70" />
          <span className="absolute bottom-3 left-8 h-7 w-12 rounded-[50%] bg-[linear-gradient(145deg,#FFC06C,#F6903D)] shadow-[inset_-5px_-5px_8px_rgba(127,62,22,0.2),0_6px_10px_rgba(0,0,0,0.18)]" />
          <span className="absolute bottom-4 left-[70px] h-0 w-0 border-y-[8px] border-r-[14px] border-y-transparent border-r-[#FFB15D]" />
          <span className="absolute bottom-2 right-8 h-11 w-5 rounded-t-full bg-[linear-gradient(145deg,#8DFFE0,#35C89F)]" />
          <span className="absolute bottom-2 right-14 h-8 w-4 rounded-t-full bg-[linear-gradient(145deg,#B7FFD0,#6DD98A)]" />
        </>
      ) : null}
      {scene === "cloud" ? (
        <>
          <span className="absolute bottom-3 left-4 h-8 w-20 rounded-full bg-[linear-gradient(145deg,#FFFFFF,#DDEBFF)] shadow-[inset_-5px_-6px_9px_rgba(102,128,180,0.2)]" />
          <span className="absolute bottom-6 left-12 h-9 w-14 rounded-full bg-[linear-gradient(145deg,#FFFFFF,#E3EEFF)]" />
          <span className="absolute bottom-10 right-10 h-10 w-9 rounded-t-lg bg-[linear-gradient(145deg,#FFE89C,#F0B854)] shadow-[inset_-4px_-5px_8px_rgba(128,82,22,0.18)]" />
          <span className="absolute bottom-20 right-8 h-0 w-0 border-x-[22px] border-b-[22px] border-x-transparent border-b-[#F0A34D]" />
          <span className="absolute bottom-5 right-4 h-7 w-16 rounded-full bg-white/90" />
        </>
      ) : null}
      {scene === "insam" ? (
        <>
          {/* 인삼밭: 흙 이랑 + 검은 그늘막 + 초록 잎 + 붉은 열매, 뒤편에 초가집 */}
          <span className="absolute inset-x-0 bottom-0 h-6 bg-[linear-gradient(180deg,#9A6B3F,#6B4526)]" />
          {[6, 46, 86, 126].map((left) => (
            <span key={left} className="absolute bottom-6 h-3 w-9 rounded-t-full bg-[linear-gradient(145deg,#7FD27A,#3E8E45)]" style={{ left }} />
          ))}
          {[14, 54, 94, 134].map((left) => (
            <span key={left} className="absolute bottom-8 h-2 w-2 rounded-full bg-[#E53935] shadow-[0_0_4px_rgba(229,57,53,0.7)]" style={{ left }} />
          ))}
          <span className="absolute bottom-[38px] left-0 h-2 w-full -skew-y-3 bg-[#1F2A24]/85 shadow-[0_4px_6px_rgba(0,0,0,0.25)]" />
          <span className="absolute bottom-[46px] right-6 h-5 w-10 rounded-b-sm bg-[linear-gradient(145deg,#F2DDB0,#C99B5E)]" />
          <span className="absolute bottom-[64px] right-3 h-3 w-16 rounded-t-[60%] bg-[linear-gradient(180deg,#E3C27A,#B88A3E)]" />
        </>
      ) : null}
      {scene === "jeokbyeok" ? (
        <>
          {/* 적벽강: 붉은 절벽 + 푸른 강물 띠 */}
          <span className="absolute bottom-6 left-0 h-14 w-24 rounded-tr-[40%] bg-[linear-gradient(160deg,#D9784A,#8E3B22)] shadow-[inset_-6px_-6px_10px_rgba(60,20,10,0.3)]" />
          <span className="absolute bottom-6 left-16 h-9 w-16 rounded-tr-[60%] bg-[linear-gradient(160deg,#C9663C,#7D3219)]" />
          <span className="absolute bottom-[52px] left-3 h-4 w-10 rounded-full bg-[linear-gradient(145deg,#6FC27A,#3A8A4A)]" />
          <span className="absolute inset-x-0 bottom-0 h-7 bg-[linear-gradient(180deg,#58C3E8,#1D6FA8)]" />
          <span className="absolute bottom-3 left-6 h-1 w-20 rounded-full bg-white/60" />
          <span className="absolute bottom-1.5 right-8 h-1 w-14 rounded-full bg-white/50" />
        </>
      ) : null}
      {scene === "chilbaek" ? (
        <>
          {/* 칠백의총: 회색 비석 + 소나무, 차분한 색 */}
          <span className="absolute inset-x-0 bottom-0 h-6 rounded-t-[45%] bg-[linear-gradient(180deg,#86A98A,#4D6B53)]" />
          <span className="absolute bottom-5 left-[60px] h-12 w-7 rounded-t-md bg-[linear-gradient(145deg,#D9DDE3,#8A929C)] shadow-[inset_-4px_-5px_7px_rgba(40,48,58,0.25),0_6px_10px_rgba(0,0,0,0.2)]" />
          <span className="absolute bottom-4 left-[52px] h-2 w-11 rounded-sm bg-[#7C848E]" />
          {[14, 116].map((left) => (
            <span key={left} className="absolute bottom-5 h-0 w-0 border-x-[14px] border-b-[34px] border-x-transparent border-b-[#2F6B45] drop-shadow-[0_4px_3px_rgba(0,0,0,0.2)]" style={{ left }} />
          ))}
          {[24, 126].map((left) => (
            <span key={left} className="absolute bottom-2 h-4 w-2 bg-[#6B4A2F]" style={{ left }} />
          ))}
        </>
      ) : null}
      <span className="absolute inset-0 rounded-xl bg-[radial-gradient(circle_at_25%_18%,rgba(255,255,255,0.42),transparent_18%),linear-gradient(180deg,rgba(255,255,255,0.2),transparent_42%,rgba(0,0,0,0.2))]" />
    </span>
  );
}

function fallbackSceneImage(images: Record<number, string>, pageIndex: number) {
  for (let index = pageIndex - 1; index >= 0; index -= 1) {
    if (images[index]) return images[index];
  }

  for (let index = pageIndex + 1; index < 6; index += 1) {
    if (images[index]) return images[index];
  }

  return undefined;
}

function StoryTextPanel({
  story,
  pageIndex,
  imageReady,
  onPrev,
  onNext
}: {
  story: StoryResult;
  pageIndex: number;
  imageReady: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <article
        key={`text-${pageIndex}`}
        className="animate-[pageIn_360ms_ease-out] flex flex-col rounded-[24px] border-2 border-[#FFB15D]/45 bg-[#FFFDF7] p-[0.8rem] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.7),0_0_20px_rgba(255,177,93,0.16)]"
      >
        <p className="mb-2 text-sm font-black text-[#A16B32]">{pageIndex + 1} / {story.pages.length}쪽</p>
        <p className="text-[clamp(18px,2.25vw,22px)] font-bold leading-[1.58] text-[#312D29]">{story.pages[pageIndex]}</p>
      </article>
      <div className="grid grid-cols-2 gap-3">
        <SecondaryButton onClick={onPrev}>
          <ArrowLeftIcon className="h-5 w-5" /> 이전 쪽
        </SecondaryButton>
        <SecondaryButton onClick={onNext}>
          다음 쪽 <ArrowRightIcon className="h-5 w-5" />
        </SecondaryButton>
      </div>
      {!imageReady ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-[#73DFFF]/25 bg-[#101A38]/72 py-3 text-sm font-black text-[#D4F5FF]">
          <SparklesIcon className="h-4 w-4 animate-pulse" /> 이미지 생성 중...
        </div>
      ) : null}
    </div>
  );
}


function loadImageElement(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawCoverImage(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number, r: number) {
  ctx.save();
  roundRectPath(ctx, x, y, w, h, r);
  ctx.clip();
  const imgRatio = img.width / img.height;
  const boxRatio = w / h;
  let dw = w;
  let dh = h;
  let dx = x;
  let dy = y;
  if (imgRatio > boxRatio) {
    dh = h;
    dw = h * imgRatio;
    dx = x - (dw - w) / 2;
  } else {
    dw = w;
    dh = w / imgRatio;
    dy = y - (dh - h) / 2;
  }
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();
}

function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const ch of text) {
    if (ch === "\n") {
      lines.push(line);
      line = "";
      continue;
    }
    const candidate = line + ch;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = ch;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// 브라우저 인쇄(팝업/iframe)는 태블릿 Chrome에서 자주 "인쇄 중 문제가 발생했습니다"로 실패한다.
// 인쇄 파이프라인을 거치지 않고 canvas로 각 쪽을 직접 그려 jsPDF로 묶어 PDF 파일을 다운로드한다.
// canvas의 fillText는 한글을 시스템 폰트로 렌더하므로 별도 폰트 임베딩이 필요 없다.
async function generateStoryPdf({
  title,
  footer,
  pages,
  images,
  filename
}: {
  title: string;
  footer: string;
  pages: string[];
  images: Record<number, string>;
  filename: string;
}) {
  const { jsPDF } = await import("jspdf");
  if (document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // 폰트 로딩 대기 실패는 무시 (시스템 폰트로 대체 렌더됨)
    }
  }

  const W = 1754;
  const H = 1240; // 약 150dpi A4 가로
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const defaultBg = `${window.location.origin}/images/story-default-bg.png`;
  const pageImages = await Promise.all(
    pages.map((_, index) => loadImageElement(images[index] || fallbackSceneImage(images, index) || defaultBg))
  );

  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pw = pdf.internal.pageSize.getWidth();
  const ph = pdf.internal.pageSize.getHeight();
  let pageCount = 0;
  const commitPage = () => {
    const jpeg = canvas.toDataURL("image/jpeg", 0.9);
    if (pageCount > 0) pdf.addPage();
    pdf.addImage(jpeg, "JPEG", 0, 0, pw, ph);
    pageCount += 1;
  };

  // 표지
  const cover = ctx.createLinearGradient(0, 0, W, H);
  cover.addColorStop(0, "#101a38");
  cover.addColorStop(1, "#1a244c");
  ctx.fillStyle = cover;
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  const coverHeading = "금산교육지원청 찾아가는 AI동화 수업";
  const headingFont = "800 56px Pretendard, sans-serif";
  const titleFont = "900 86px Pretendard, sans-serif";
  const headingH = 66;
  const gapHeadingToTitle = 54;
  const titleLineH = 106;

  ctx.font = titleFont;
  const titleLines = wrapCanvasText(ctx, title, W - 300);
  const blockH = headingH + gapHeadingToTitle + titleLines.length * titleLineH;
  let coverY = H / 2 - blockH / 2;

  // 1줄: 수업 제목
  ctx.fillStyle = "#FFD073";
  ctx.font = headingFont;
  ctx.fillText(coverHeading, W / 2, coverY);
  coverY += headingH + gapHeadingToTitle;

  // 2줄: 동화 제목
  ctx.fillStyle = "#ffffff";
  ctx.font = titleFont;
  for (const line of titleLines) {
    ctx.fillText(line, W / 2, coverY);
    coverY += titleLineH;
  }

  // 하단: 식별용 정보(배경 · 아이디)
  ctx.fillStyle = "#dff9ff";
  ctx.font = "700 34px Pretendard, sans-serif";
  ctx.fillText(footer, W / 2, H - 96);
  commitPage();

  // 본문 6쪽
  for (let i = 0; i < pages.length; i += 1) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);

    const margin = 70;
    const gap = 50;
    const colW = (W - margin * 2 - gap) / 2;
    const colH = H - margin * 2;

    const img = pageImages[i];
    if (img) {
      drawCoverImage(ctx, img, margin, margin, colW, colH, 40);
    } else {
      ctx.fillStyle = "#eef4f7";
      roundRectPath(ctx, margin, margin, colW, colH, 40);
      ctx.fill();
    }

    const cardX = margin + colW + gap;
    ctx.fillStyle = "#fffdf7";
    roundRectPath(ctx, cardX, margin, colW, colH, 40);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#e7c884";
    roundRectPath(ctx, cardX, margin, colW, colH, 40);
    ctx.stroke();

    const pad = 70;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#a16b32";
    ctx.font = "900 30px Pretendard, sans-serif";
    ctx.fillText(`${i + 1} / ${pages.length}쪽`, cardX + pad, margin + pad);

    ctx.fillStyle = "#312d29";
    ctx.font = "800 42px Pretendard, sans-serif";
    const textLines = wrapCanvasText(ctx, pages[i] || "", colW - pad * 2);
    const lineH = 68;
    const blockH = textLines.length * lineH;
    let bodyY = margin + colH / 2 - blockH / 2;
    for (const line of textLines) {
      ctx.fillText(line, cardX + pad, bodyY);
      bodyY += lineH;
    }
    commitPage();
  }

  pdf.save(filename);
}

export function StoryKioskApp() {
  const [step, setStep] = useState<Step>("login");
  // 학년 선택은 없앴다. 모든 학생이 같은 흐름(풍부한 글 + 동화 영상 만들기)으로 진행한다.
  const grade = "all";
  // 첫 화면 입장 정보. 학교명·학년은 로그아웃해도 남겨 둬서 같은 반 다음 학생이 이어 쓰기 쉽게 한다.
  const [studentSchool, setStudentSchool] = useState("");
  const [studentGrade, setStudentGrade] = useState("");
  const [studentNumber, setStudentNumber] = useState("");
  const [studentName, setStudentName] = useState("");
  const [adminMode, setAdminMode] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [classId, setClassId] = useState("");
  const [classSessionToken, setClassSessionToken] = useState("");
  const [classLoginMessage, setClassLoginMessage] = useState("");
  const [classLoginPending, setClassLoginPending] = useState(false);
  const [character, setCharacter] = useState<CharacterChoice>(defaultCharacter);
  const [heroName, setHeroName] = useState("");
  const [gender, setGender] = useState<HeroType>("girl");
  const [heroAgeId, setHeroAgeId] = useState(defaultHeroAgeId.girl);
  const [hairColorId, setHairColorId] = useState(defaultHairColor.id);
  const [featureIds, setFeatureIds] = useState<string[]>([]);
  const [featureTab, setFeatureTab] = useState<"pick" | "write">("pick");
  const [featureText, setFeatureText] = useState("");
  const [trait, setTrait] = useState<Choice>(defaultTrait);
  const [place, setPlace] = useState<PlaceChoice>(defaultPlace);
  const [events, setEvents] = useState<StorySelection["events"]>({
    opening: eventGroups.opening[0],
    development: eventGroups.development[0],
    climax: eventGroups.climax[0],
    ending: eventGroups.ending[0]
  });
  const [story, setStory] = useState<StoryResult>(() => localStory(buildSelection(defaultCharacter, defaultTrait, defaultPlace, {
    opening: eventGroups.opening[0],
    development: eventGroups.development[0],
    climax: eventGroups.climax[0],
    ending: eventGroups.ending[0]
  })));
  const [pageIndex, setPageIndex] = useState(0);
  const [health, setHealth] = useState<Awaited<ReturnType<typeof checkProxyHealth>>>(null);
  const [sceneImages, setSceneImages] = useState<Record<number, string>>({});
  const [imageGenerationMode, setImageGenerationMode] = useState<ImageGenerationMode>(null);
  const [imageGenerationMessage, setImageGenerationMessage] = useState("");
  const [savedStories, setSavedStories] = useState<SavedStory[]>([]);
  const [activeSavedStoryId, setActiveSavedStoryId] = useState<string | null>(null);
  const [customTrait, setCustomTrait] = useState("");
  const [customEvents, setCustomEvents] = useState<Record<keyof StorySelection["events"], string>>({
    opening: "",
    development: "",
    climax: "",
    ending: ""
  });
  const [customError, setCustomError] = useState("");
  const [musicState, setMusicState] = useState<StoryMusicState>("paused");
  const [musicGenreId, setMusicGenreId] = useState<StoryMusicGenreId>(defaultMusicGenreId);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // 동화 영상 만들기 상태
  const [videoPageIndex, setVideoPageIndex] = useState(2); // 기본: 절정 부근(3쪽)
  const [videoPhase, setVideoPhase] = useState<"idle" | "clip" | "render" | "ready">("idle");
  const [videoMessage, setVideoMessage] = useState("");
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  const [clipPageIndex, setClipPageIndex] = useState<number | null>(null);
  // 완성된 동화 영상(미리보기/다운로드 공용). 한 번 만들면 재생도, 다운로드도 이걸로 한다.
  const [storyVideoUrl, setStoryVideoUrl] = useState<string | null>(null);
  const [storyVideoName, setStoryVideoName] = useState("");
  // 6쪽 전부를 각각 그린다. 쪽마다 고유한 장면 텍스트로 생성하므로 같은 그림이 재사용되지 않는다.
  const IMAGE_PAGES = [0, 1, 2, 3, 4, 5] as const;

  const hairDesc = useMemo(() => hairColors.find((c) => c.id === hairColorId)?.desc || "", [hairColorId]);
  const featureTextTrimmed = featureText.trim();
  const featureTextBlocked = featureTextTrimmed ? isBlockedCustomChoice(featureTextTrimmed) : false;
  const featureDescs = useMemo(() => {
    const picked = heroFeatures.filter((f) => featureIds.includes(f.id)).map((f) => f.desc);
    // 금지어가 들어간 글은 그림에 넣지 않는다.
    return featureTextTrimmed && !featureTextBlocked ? [...picked, featureTextTrimmed] : picked;
  }, [featureIds, featureTextTrimmed, featureTextBlocked]);
  const selection = useMemo(
    () => buildSelection(character, trait, place, events, heroName, gender, hairDesc, featureDescs, heroAgeId),
    [character, trait, place, events, heroName, gender, hairDesc, featureDescs, heroAgeId]
  );
  const pdfMetadata = useMemo(
    () =>
      buildStoryPdfMetadata({
        // PDF 파일 이름 접두사. 관리자 아이디를 파일명에 노출하지 않는다.
        classId: "geumsan",
        characterName: heroName.trim() || "주인공",
        place: place.name,
        gender,
        age: heroAgeId,
        createdAt: new Date()
      }),
    [heroName, place.name, gender, heroAgeId]
  );
  const currentStepIndex = stepOrder.indexOf(step);
  const currentSceneImage = step === "result" ? sceneImages[pageIndex] || fallbackSceneImage(sceneImages, pageIndex) : undefined;
  const kioskArtworkImageSrc = getKioskArtworkSource({ step, placeImageSrc: place.imageSrc, generatedImage: currentSceneImage });
  const mascotGuide = useMemo(() => mascotGuideForStep(step, character.name), [character.name, step]);
  const selectedMusicGenre = useMemo(() => getMusicGenre(musicGenreId), [musicGenreId]);
  const printableImagesReady = IMAGE_PAGES.every((index) => Boolean(sceneImages[index]));
  const currentPageImageLoading = Boolean(imageGenerationMode && IMAGE_PAGES.includes(pageIndex as typeof IMAGE_PAGES[number]) && !sceneImages[pageIndex]);

  const persistSavedStories = useCallback((updater: (current: SavedStory[]) => SavedStory[]) => {
    setSavedStories((current) => {
      const next = updater(current).slice(0, maxSavedStories);
      writeSavedStories(next);
      return next;
    });
  }, []);

  const persistActiveStoryImages = useCallback((images: Record<number, string>) => {
    if (!activeSavedStoryId) return;

    persistSavedStories((current) =>
      current.map((item) => (item.id === activeSavedStoryId ? { ...item, sceneImages: images } : item))
    );
  }, [activeSavedStoryId, persistSavedStories]);

  const stopStoryMusic = useCallback(() => {
    if (!audioRef.current) return;

    audioRef.current.pause();
    audioRef.current.currentTime = 0;
    audioRef.current = null;
  }, []);

  const startStoryMusic = useCallback((genre: StoryMusicGenre = selectedMusicGenre) => {
    stopStoryMusic();
    const audio = new Audio(genre.audioSrc);
    audio.loop = true;
    audio.volume = genre.volume;
    audioRef.current = audio;
    void audio.play().catch(() => {
      setMusicState("paused");
      stopStoryMusic();
    });
  }, [selectedMusicGenre, stopStoryMusic]);

  function toggleStoryMusic() {
    const nextState = nextMusicState(musicState);
    setMusicState(nextState);
    if (nextState === "playing") {
      startStoryMusic(selectedMusicGenre);
    } else {
      stopStoryMusic();
    }
  }

  function selectMusicGenre(id: StoryMusicGenreId) {
    const nextGenre = getMusicGenre(id);
    setMusicGenreId(nextGenre.id);
    if (musicState === "playing") {
      startStoryMusic(nextGenre);
    }
  }

  const reset = useCallback(() => {
    stopStoryMusic();
    setMusicState("paused");
    setStep("attract");
    setPageIndex(0);
  }, [stopStoryMusic]);

  const logOut = useCallback(() => {
    stopStoryMusic();
    void requestAdminLogout(classSessionToken);
    clearAdminSession();
    setMusicState("paused");
    setClassId("");
    setClassSessionToken("");
    setStudentNumber("");
    setStudentName("");
    setAdminMode(false);
    setPasswordInput("");
    setClassLoginMessage("로그아웃했어요.");
    setImageGenerationMessage("");
    setPageIndex(0);
    setStep("login");
  }, [stopStoryMusic, classSessionToken]);

  async function signInAsAdmin() {
    setClassLoginPending(true);
    setClassLoginMessage("로그인 중이에요.");
    const result = await requestAdminLogin(passwordInput);
    setClassLoginPending(false);
    setPasswordInput("");

    if (!result.ok || !result.sessionToken) {
      setClassLoginMessage(result.message);
      return;
    }

    const session = writeAdminSession({ role: "admin", adminId: result.adminId, sessionToken: result.sessionToken });
    setClassId(sessionLabel(session));
    setClassSessionToken(result.sessionToken);
    setClassLoginMessage(result.message);
    setStep("attract");
  }

  async function signInAsStudent() {
    setClassLoginPending(true);
    setClassLoginMessage("확인 중이에요.");
    const result = await requestStudentLogin({
      school: studentSchool,
      grade: studentGrade,
      number: studentNumber,
      name: studentName
    });
    setClassLoginPending(false);

    if (!result.ok || !result.sessionToken || !result.student) {
      setClassLoginMessage(result.message);
      return;
    }

    const session = writeAdminSession({ role: "student", student: result.student, sessionToken: result.sessionToken });
    setClassId(sessionLabel(session));
    setClassSessionToken(result.sessionToken);
    setClassLoginMessage(result.message);
    setStep("attract");
  }

  function openSavedStory(savedStory: SavedStory) {
    setCharacter(savedStory.character);
    setTrait(savedStory.trait);
    setPlace(savedStory.place);
    setEvents(savedStory.events);
    setStory(savedStory.story);
    setSceneImages(savedStory.sceneImages || {});
    setActiveSavedStoryId(savedStory.id);
    setPageIndex(0);
    setStep("result");
  }

  useEffect(() => {
    checkProxyHealth().then(setHealth);
    setSavedStories(readSavedStories());
    clearRetiredClassSessions();

    const session = readAdminSession();
    if (!session) return;

    let cancelled = false;
    // 저장된 토큰이라도 서버에 다시 물어본다. 서버가 모르는 토큰이면 로그인 화면에 머문다.
    verifyAdminSession(session.sessionToken).then((valid) => {
      if (cancelled) return;

      if (!valid) {
        clearAdminSession();
        return;
      }

      setClassId(sessionLabel(session));
      setClassSessionToken(session.sessionToken);
      setStep("attract");
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // 무동작 자동 복귀(유휴 타이머)는 제거했다.
  // 학생이 "처음으로" 버튼을 직접 누르기 전까지 진행 상황을 그대로 유지한다.

  useEffect(() => {
    if (step === "result") return undefined;

    stopStoryMusic();
    setMusicState("paused");
    return undefined;
  }, [step, stopStoryMusic]);

  async function createStory() {
    const storySelection = selection;
    const storyId = `story-${Date.now()}`;
    setStep("loading");
    setPageIndex(0);
    setSceneImages({});
    setImageGenerationMode(null);
    setImageGenerationMessage("");
    let result: StoryResult;
    try {
      result = await generateStory(storySelection, { classId, sessionToken: classSessionToken }, grade);
    } catch (error) {
      // 사용 횟수 초과(특별 아이디의 횟수 제한 등): 만들지 않고 안내 후 사건 선택 화면으로 되돌린다.
      if ((error as { code?: string })?.code === "usage_limit") {
        setStep("events");
        setCustomError(
          (error as Error).message || "이 아이디로 만들 수 있는 횟수를 모두 사용했어요. 선생님께 리셋을 요청해 주세요."
        );
        return;
      }
      throw error;
    }
    setStory(result);
    setActiveSavedStoryId(storyId);
    persistSavedStories((current) => [
      {
        id: storyId,
        createdAt: new Date().toISOString(),
        character,
        trait,
        place,
        events,
        story: result,
        sceneImages: {}
      },
      ...current.filter((item) => item.id !== storyId)
    ]);
    setStep("result");
  }

  async function generateStoryImages(indices: readonly number[], mode: Exclude<ImageGenerationMode, null>) {
    if (imageGenerationMode) return sceneImages;

    setImageGenerationMode(mode);
    setImageGenerationMessage("");
    let nextImages = { ...sceneImages };

    try {
      for (const index of indices) {
        if (nextImages[index]) continue;

        const scene = story.pages[index];
        if (!scene) continue;

        const image = await generateSceneImage(selection, scene, index, mode, { classId, sessionToken: classSessionToken });
        if (isGeneratedSceneImage(image)) {
          nextImages = { ...nextImages, [index]: image.imageDataUrl };
          setSceneImages(nextImages);
          persistActiveStoryImages(nextImages);
        } else if (image?.message) {
          setImageGenerationMessage(image.message);
          break;
        }
      }

      return nextImages;
    } finally {
      setImageGenerationMode(null);
    }
  }

  async function generateCoverImage() {
    await generateStoryImages([0], "cover");
  }

  async function generatePrintableImages() {
    return generateStoryImages(IMAGE_PAGES, "print");
  }
  async function printStorybook() {
    const imagesForPrint = printableImagesReady ? sceneImages : await generatePrintableImages();
    await generateStoryPdf({
      title: pdfMetadata.title,
      footer: `${place.name} · ${classId || "연습 아이디"}`,
      pages: story.pages,
      images: imagesForPrint,
      filename: pdfMetadata.filename
    });
  }

  // 선택한 한 쪽을 Veo로 "움직이는 클립"으로 만든다 (유일한 유료 단계)
  async function makeSceneClip() {
    if (videoPhase === "clip") return;
    setVideoPhase("clip");
    setVideoMessage("그림을 준비하고 있어요…");
    try {
      // 그 쪽 그림이 아직 없으면 먼저 생성
      let images = sceneImages;
      if (!images[videoPageIndex]) {
        images = await generateStoryImages([videoPageIndex], "print");
      }
      const baseImage = images[videoPageIndex];
      if (!baseImage) throw new Error("그림을 먼저 만들어야 해요");

      setVideoMessage("움직이는 그림을 만들고 있어요… (1~2분 걸려요)");
      const prompt = `Gently animate this children's storybook illustration of ${heroName.trim() || "the main character"} at ${place.name}. Subtle, soft motion only — keep the exact same character, outfit, art style, and colors. No new text.`;

      const url = await generatePageVideo({
        imageDataUrl: baseImage,
        prompt,
        classId,
        sessionToken: classSessionToken,
        onProgress: (info) => {
          if (info.phase === "queued" && info.position && info.position > 1) {
            setVideoMessage(`친구들이 만드는 중이라 잠시 기다려요… (대기 ${info.position}번째)`);
          } else {
            setVideoMessage(`움직이는 그림을 만들고 있어요… (${info.elapsedSec}초)`);
          }
        }
      });

      if (clipUrl) URL.revokeObjectURL(clipUrl);
      setClipUrl(url);
      setClipPageIndex(videoPageIndex);
      // 새 움직이는 그림이 생겼으니 이전 미리보기 영상은 무효화(다시 만들도록)
      if (storyVideoUrl) URL.revokeObjectURL(storyVideoUrl);
      setStoryVideoUrl(null);
      setVideoPhase("ready");
      setVideoMessage("움직이는 그림이 완성됐어요! 이제 ‘영상 미리보기’로 확인해 보세요.");
    } catch (e) {
      setVideoPhase("idle");
      setVideoMessage(e instanceof Error ? e.message : "영상 만들기에 실패했어요. 다시 해볼까요?");
    }
  }

  // 만들어 둔 영상(blob URL)을 파일로 내려받기
  function saveBlobUrl(url: string, fileName: string) {
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  // 6쪽을 하나의 영상으로 묶는다. autoDownload=true면 만들자마자 바로 다운로드.
  // 만든 영상은 storyVideoUrl에 보관해 미리보기 재생과 다운로드에 함께 쓴다.
  async function makeStoryVideo(autoDownload: boolean) {
    if (videoPhase === "render") return;
    const useClip = Boolean(clipUrl) && clipPageIndex != null;
    setVideoPhase("render");
    setVideoMessage(
      useClip
        ? "동화를 영상으로 묶고 있어요… 끝날 때까지 화면을 켜 두세요."
        : "정지 그림으로 동화 영상을 만들고 있어요… 끝날 때까지 화면을 켜 두세요."
    );
    try {
      const allImages = printableImagesReady ? sceneImages : await generatePrintableImages();
      const imageList = IMAGE_PAGES.map((i) => allImages[i] || null);

      const result = await buildStoryVideo({
        title: pdfMetadata.title,
        footer: `${place.name} · ${classId || "연습 아이디"}`,
        pages: story.pages,
        images: imageList,
        animatedIndex: useClip ? (clipPageIndex as number) : -1,
        animatedVideoUrl: useClip ? (clipUrl as string) : "",
        musicSrc: selectedMusicGenre.audioSrc,
        musicVolume: selectedMusicGenre.volume,
        onProgress: (ratio) => setVideoMessage(`동화를 영상으로 묶고 있어요… (${Math.round(ratio * 100)}%)`)
      });

      const url = URL.createObjectURL(result.blob);
      const fileName = pdfMetadata.filename.replace(/\.pdf$/i, `.${result.ext}`);
      // 이전 미리보기 영상이 있으면 메모리 정리
      if (storyVideoUrl) URL.revokeObjectURL(storyVideoUrl);
      setStoryVideoUrl(url);
      setStoryVideoName(fileName);

      if (autoDownload) {
        saveBlobUrl(url, fileName);
        setVideoMessage("영상을 저장했어요! 🎬 (아래에서 다시 보기도 돼요)");
      } else {
        setVideoMessage("미리보기가 준비됐어요! 아래에서 재생해 보고 다운로드하세요. ▶️");
      }
      setVideoPhase("ready");
    } catch (e) {
      setVideoPhase("ready");
      setVideoMessage(e instanceof Error ? e.message : "영상으로 묶는 중 문제가 생겼어요.");
    }
  }

  // 이미 만들어 둔 미리보기 영상을 그대로 다운로드(다시 만들지 않음)
  function downloadBuiltVideo() {
    if (!storyVideoUrl) return;
    saveBlobUrl(storyVideoUrl, storyVideoName || "story.mp4");
    setVideoMessage("영상을 저장했어요! 🎬");
  }

  function move(delta: number) {
    const next = stepOrder[currentStepIndex + delta];
    if (next) setStep(next);
  }

  function updateEvent(key: keyof StorySelection["events"], value: Choice) {
    setEvents((current) => ({ ...current, [key]: value }));
  }

  function applyCustomTrait() {
    const label = sanitizeCustomChoice(customTrait);
    if (!label) return;
    if (isBlockedCustomChoice(label)) {
      setCustomError("다른 표현으로 써 주세요.");
      return;
    }

    setTrait({ id: `custom-trait-${Date.now()}`, label });
    setCustomTrait("");
    setCustomError("");
  }

  function applyCustomEvent(key: keyof StorySelection["events"]) {
    const label = sanitizeCustomChoice(customEvents[key]);
    if (!label) return;
    if (isBlockedCustomChoice(label)) {
      setCustomError("다른 표현으로 써 주세요.");
      return;
    }

    updateEvent(key, { id: `custom-${key}-${Date.now()}`, label });
    setCustomEvents((current) => ({ ...current, [key]: "" }));
    setCustomError("");
  }

  return (
    <main className="h-[100dvh] overflow-hidden bg-[#090D20] text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(255,126,72,0.24),transparent_34%),radial-gradient(circle_at_82%_10%,rgba(45,107,255,0.24),transparent_32%),radial-gradient(circle_at_50%_90%,rgba(125,232,255,0.16),transparent_45%),linear-gradient(180deg,#151936_0%,#090D20_100%)]" />
      <div className="pointer-events-none fixed inset-6 rounded-[34px] border-4 border-[#244DFF] shadow-[inset_0_0_0_3px_rgba(255,177,93,0.85),0_0_34px_rgba(36,77,255,0.42)]" />

      <section className={["relative grid h-full min-h-0 overflow-hidden p-5 sm:p-6 lg:p-8", step === "login" || step === "attract" ? "grid-rows-1" : "grid-rows-[auto_minmax(0,1fr)]"].join(" ")}>
        {step !== "login" && step !== "attract" ? (
          <header className="z-10 mx-auto flex w-full max-w-[1560px] flex-wrap items-center justify-between gap-3 pb-2">
            <div className="flex items-center gap-4">
              <img
                src="/images/ginseng-mascot-transparent.png"
                alt=""
                aria-hidden="true"
                className="h-16 w-16 shrink-0 object-contain drop-shadow-[0_8px_14px_rgba(0,0,0,0.28)]"
                draggable={false}
              />
              <div>
                <h1 className="mt-1 text-2xl font-black text-white drop-shadow-[0_0_16px_rgba(125,232,255,0.32)] sm:text-3xl">
                  AI와 함께 만드는 나만의 동화책
                </h1>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {step !== "loading" && step !== "result" ? <Progress activeStep={step} /> : null}
              {step === "result" ? (
                <div className="flex items-center gap-2">
                  <HeaderActionButton onClick={reset}>
                    처음으로 <HomeIcon className="h-5 w-5" />
                  </HeaderActionButton>
                  <HeaderActionButton onClick={createStory}>
                    다시 짓기 <ArrowPathIcon className="h-5 w-5" />
                  </HeaderActionButton>
                  <HeaderActionButton onClick={() => setStep("character")}>
                    새 동화 <SparklesIcon className="h-5 w-5" />
                  </HeaderActionButton>
                </div>
              ) : null}
              {classId ? (
                <div className="rounded-full border border-[#FFB15D]/45 bg-[#2E2442]/82 px-4 py-2 text-sm font-black text-[#FFE9B0]">
                  {classId}
                </div>
              ) : null}
              <StatusPill health={health} />
            </div>
          </header>
        ) : null}

        {step === "login" ? (
          <div className="relative z-10 grid min-h-0 place-items-center overflow-y-auto px-3 py-4 text-center">
            <div className="grid max-h-full w-full max-w-[820px] gap-4 rounded-[34px] border-2 border-[#73DFFF]/35 bg-[#101A38]/82 px-6 py-5 shadow-[0_0_42px_rgba(36,77,255,0.28)] backdrop-blur sm:px-9">
              <div className="grid gap-2">
                <h1 className="text-balance text-[clamp(24px,3.4vw,44px)] font-black leading-tight text-white drop-shadow-[0_0_28px_rgba(125,232,255,0.35)]">
                  AI와 함께 나만의 동화책 만들기
                </h1>
                <p className="mx-auto max-w-[620px] break-keep text-balance text-[clamp(14px,1.5vw,19px)] font-bold leading-relaxed text-[#D4F5FF]">
                  주인공을 고르고, 사건을 이어 붙이면 세상에 하나뿐인 나만의 동화책이 완성돼요.
                </p>
              </div>

              {adminMode ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!classLoginPending) void signInAsAdmin();
                  }}
                  className="mx-auto grid w-full max-w-[440px] gap-3 rounded-[24px] border border-[#FFB15D]/45 bg-[#0B1029]/80 p-5 text-left"
                >
                  <p className="text-base font-black text-[#FFE9B0]">관리자 입장</p>
                  <label className="grid gap-1 text-sm font-black text-[#D4F5FF]" htmlFor="admin-password">
                    관리자 비밀번호
                    <input
                      id="admin-password"
                      name="password"
                      type="password"
                      inputMode="numeric"
                      autoComplete="current-password"
                      autoFocus
                      value={passwordInput}
                      onChange={(event) => setPasswordInput(event.target.value)}
                      className="min-h-14 w-full min-w-0 rounded-2xl border-2 border-[#73DFFF]/30 bg-[#151F41] px-5 text-lg font-black text-white outline-none placeholder:text-[#D4F5FF]/45 focus:border-[#FFB15D]"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={classLoginPending}
                    className="mt-1 min-h-14 rounded-2xl border-2 border-[#FFB15D] bg-[#F0633C] px-6 text-lg font-black text-white shadow-[0_0_24px_rgba(240,99,60,0.26)] active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-[#6B5C72]"
                  >
                    {classLoginPending ? "확인 중" : "관리자로 입장"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAdminMode(false);
                      setPasswordInput("");
                      setClassLoginMessage("");
                    }}
                    className="min-h-11 rounded-2xl border border-[#73DFFF]/35 px-4 text-sm font-black text-[#DDFBFF] active:scale-[0.98]"
                  >
                    학생 입장으로 돌아가기
                  </button>
                  <p className="min-h-6 text-sm font-black text-[#FFD073]">{classLoginMessage}</p>
                </form>
              ) : (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!classLoginPending) void signInAsStudent();
                  }}
                  className="mx-auto grid w-full max-w-[520px] gap-3 rounded-[24px] border border-[#FFB15D]/45 bg-[#0B1029]/80 p-5 text-left"
                >
                  <p className="text-base font-black text-[#FFE9B0]">나를 소개해요</p>
                  <label className="grid gap-1 text-sm font-black text-[#D4F5FF]">
                    학교명
                    <input
                      name="school"
                      autoComplete="off"
                      placeholder="예: 금산초등학교"
                      value={studentSchool}
                      onChange={(event) => setStudentSchool(sanitizeFeatureText(event.target.value).slice(0, 20))}
                      className="min-h-14 w-full min-w-0 rounded-2xl border-2 border-[#73DFFF]/30 bg-[#151F41] px-5 text-lg font-black text-white outline-none placeholder:text-[#D4F5FF]/45 focus:border-[#FFB15D]"
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="grid gap-1 text-sm font-black text-[#D4F5FF]">
                      학년
                      <input
                        name="grade"
                        inputMode="numeric"
                        autoComplete="off"
                        placeholder="예: 4"
                        value={studentGrade}
                        onChange={(event) => setStudentGrade(event.target.value.replace(/[^1-6]/g, "").slice(0, 1))}
                        className="min-h-14 w-full min-w-0 rounded-2xl border-2 border-[#73DFFF]/30 bg-[#151F41] px-5 text-lg font-black text-white outline-none placeholder:text-[#D4F5FF]/45 focus:border-[#FFB15D]"
                      />
                    </label>
                    <label className="grid gap-1 text-sm font-black text-[#D4F5FF]">
                      번호
                      <input
                        name="number"
                        inputMode="numeric"
                        autoComplete="off"
                        placeholder="예: 12"
                        value={studentNumber}
                        onChange={(event) => setStudentNumber(event.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
                        className="min-h-14 w-full min-w-0 rounded-2xl border-2 border-[#73DFFF]/30 bg-[#151F41] px-5 text-lg font-black text-white outline-none placeholder:text-[#D4F5FF]/45 focus:border-[#FFB15D]"
                      />
                    </label>
                  </div>
                  <label className="grid gap-1 text-sm font-black text-[#D4F5FF]">
                    이름
                    <input
                      name="student-name"
                      autoComplete="off"
                      placeholder="예: 홍길동"
                      value={studentName}
                      onChange={(event) => setStudentName(sanitizeFeatureText(event.target.value).slice(0, 10))}
                      className="min-h-14 w-full min-w-0 rounded-2xl border-2 border-[#73DFFF]/30 bg-[#151F41] px-5 text-lg font-black text-white outline-none placeholder:text-[#D4F5FF]/45 focus:border-[#FFB15D]"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={classLoginPending}
                    className="mt-1 min-h-14 rounded-2xl border-2 border-[#FFB15D] bg-[#F0633C] px-6 text-lg font-black text-white shadow-[0_0_24px_rgba(240,99,60,0.26)] active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-[#6B5C72]"
                  >
                    {classLoginPending ? "확인 중" : "동화 만들기 시작"}
                  </button>
                  <p className="min-h-6 text-sm font-black text-[#FFD073]">{classLoginMessage}</p>
                </form>
              )}
            </div>
            {!adminMode ? (
              <button
                type="button"
                onClick={() => {
                  setAdminMode(true);
                  setClassLoginMessage("");
                }}
                className="absolute bottom-4 right-4 z-20 inline-flex min-h-11 items-center justify-center rounded-2xl border border-[#73DFFF]/35 bg-[#101A38]/86 px-4 text-sm font-black text-[#DDFBFF]/80 active:scale-[0.98]"
              >
                관리자
              </button>
            ) : null}
          </div>
        ) : step === "attract" ? (
          <div className="relative z-10 grid min-h-0 overflow-hidden">
            <div className="z-10 grid min-h-0 place-items-center px-3 py-3 text-center">
              <span className="relative flex h-full min-h-0 w-full max-w-[1120px] flex-col items-center justify-center gap-3 rounded-[34px] px-6 py-4 sm:px-10">
                <span className="pointer-events-none absolute left-[8%] top-[14%] h-20 w-20 rounded-full border border-[#7DFFD4]/25" />
                <span className="pointer-events-none absolute right-[10%] top-[20%] h-28 w-28 rounded-full border border-[#FFB15D]/25" />
                <span className="pointer-events-none absolute bottom-[12%] left-[18%] h-3 w-3 rotate-45 bg-[#FFE17A] shadow-[0_0_20px_rgba(255,225,122,0.7)]" />
                <span className="pointer-events-none absolute bottom-[22%] right-[20%] h-4 w-4 rotate-45 bg-[#7DFFD4] shadow-[0_0_22px_rgba(125,255,212,0.68)]" />

                <span className="flex flex-col items-center gap-2">
                  <span className="text-[clamp(26px,3.4vw,52px)] font-black leading-tight text-white drop-shadow-[0_0_20px_rgba(125,232,255,0.28)]">
                    AI와 함께 만드는 나만의 동화책
                  </span>
                </span>

                <span className="mt-1 text-[clamp(54px,7.4vw,96px)] font-black leading-none text-white drop-shadow-[0_0_38px_rgba(125,232,255,0.36)]">
                  동화 만들기
                </span>

                <span aria-hidden="true" className="story-mascot-float relative mt-1 block h-[clamp(120px,14vw,178px)] w-[clamp(120px,14vw,178px)]">
                  <span className="absolute inset-x-[18%] bottom-1 h-8 rounded-full bg-[#050914]/55 blur-xl" />
                  <img
                    src="/images/ginseng-mascot-transparent.png"
                    alt=""
                    className="relative h-full w-full object-contain drop-shadow-[0_24px_34px_rgba(0,0,0,0.36)]"
                    draggable={false}
                  />
                </span>

                <span className="mt-1 text-[clamp(16px,1.7vw,22px)] font-black text-[#DDFBFF]">
                  버튼을 누르면 동화 만들기를 시작해요!
                </span>
                <button
                  type="button"
                  onClick={() => setStep("character")}
                  className="min-h-16 rounded-[22px] border-2 border-[#FFB15D]/80 bg-[#F0633C] px-12 text-[clamp(20px,2.2vw,30px)] font-black text-white shadow-[0_16px_34px_rgba(240,99,60,0.32)] transition hover:-translate-y-1 active:scale-[0.98]"
                >
                  동화 만들기 시작
                </button>

              </span>
            </div>
            {classId ? (
              <button
                type="button"
                onClick={logOut}
                className="absolute bottom-8 right-10 z-20 inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-[#73DFFF]/45 bg-[#101A38]/86 px-4 text-sm font-black text-[#DDFBFF] shadow-[0_0_18px_rgba(125,232,255,0.16)] active:scale-[0.98]"
              >
                <ArrowPathIcon className="h-4 w-4" /> 로그아웃
              </button>
            ) : null}
          </div>
        ) : (
          <div className={["z-10 mx-auto grid h-full min-h-0 w-full max-w-[1560px] overflow-hidden", step === "result" ? "grid-rows-[minmax(0,1fr)_auto] gap-2" : "grid-rows-1"].join(" ")}>
            <div className="grid min-h-0 w-full grid-cols-1 gap-4 overflow-hidden py-1 lg:grid-cols-[minmax(0,0.95fr)_minmax(520px,1.15fr)] lg:items-stretch">
              <div className="relative min-h-0 overflow-hidden rounded-[30px] border-2 border-[#FFB15D]/80 bg-[#111936]/78 shadow-[0_0_36px_rgba(45,107,255,0.28)]">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(125,232,255,0.18),transparent_40%),linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0))]" />
                <KioskArtwork imageSrc={kioskArtworkImageSrc} generatedImage={currentSceneImage} guideText={mascotGuide} />
                {step === "result" ? (
                  <div className="pointer-events-none absolute inset-x-6 bottom-5 z-20 rounded-2xl border border-[#73DFFF]/30 bg-[#080D1F]/72 p-4 text-center font-black text-[#E8FCFF] shadow-[0_0_18px_rgba(125,232,255,0.18)] backdrop-blur">
                    {pageIndex + 1} / {story.pages.length}쪽
                  </div>
                ) : null}
              </div>

              <div className="flex min-h-0 flex-col justify-start overflow-y-auto overflow-x-hidden rounded-[30px] border-2 border-[#244DFF]/75 bg-[#101A38]/78 p-4 shadow-[0_0_34px_rgba(36,77,255,0.26)] backdrop-blur lg:p-5">
                {step === "character" ? (
                  <div className="space-y-3">
                    <div>
                      <p className="text-base font-black text-[#7DFFD4]">1단계</p>
                      <h2 className="text-3xl font-black">주인공을 만들어요</h2>
                    </div>

                    <div className="grid gap-2">
                      <p className="text-sm font-black text-[#FFE9B0]">이름</p>
                      <input
                        value={heroName}
                        onChange={(event) => setHeroName(sanitizeCustomChoice(event.target.value))}
                        maxLength={12}
                        placeholder="예: 가야"
                        className="min-h-12 w-full rounded-xl border border-[#73DFFF]/25 bg-[#151F41] px-4 text-base font-black text-white outline-none placeholder:text-[#D4F5FF]/45 focus:border-[#FFB15D]"
                      />
                    </div>

                    <div className="grid gap-2">
                      <p className="text-sm font-black text-[#FFE9B0]">유형</p>
                      <div className="grid grid-cols-5 gap-2">
                        {heroTypes.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            aria-pressed={gender === item.id}
                            onClick={() => {
                              if (gender !== item.id) setHeroAgeId(defaultHeroAgeId[item.id]);
                              setGender(item.id);
                            }}
                            className={[
                              "min-h-12 break-keep rounded-xl border-2 px-1 text-sm font-black leading-tight transition active:scale-[0.98] sm:text-base",
                              gender === item.id
                                ? "border-[#FFB15D] bg-[#F0633C] text-white"
                                : "border-[#73DFFF]/25 bg-[#151F41] text-[#D4F5FF]"
                            ].join(" ")}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid gap-2">
                      <p className="text-sm font-black text-[#FFE9B0]">나이대</p>
                      <div className={["grid gap-2", heroAgeOptions[gender].length === 4 ? "grid-cols-4" : "grid-cols-3"].join(" ")}>
                        {heroAgeOptions[gender].map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            aria-pressed={heroAgeId === item.id}
                            onClick={() => setHeroAgeId(item.id)}
                            className={[
                              "flex min-h-12 flex-col items-center justify-center rounded-xl border-2 px-1 py-1 transition active:scale-[0.98]",
                              heroAgeId === item.id
                                ? "border-[#FFB15D] bg-[#F0633C] text-white"
                                : "border-[#73DFFF]/25 bg-[#151F41] text-[#D4F5FF]"
                            ].join(" ")}
                          >
                            <span className="text-sm font-black leading-tight sm:text-base">{item.label}</span>
                            <span className="text-[11px] font-bold leading-tight opacity-80">{item.sub}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid gap-2">
                      <p className="text-sm font-black text-[#FFE9B0]">{gender === "robot" ? "몸 색" : "머리색"}</p>
                      <div className="grid grid-cols-6 gap-2">
                        {hairColors.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => setHairColorId(item.id)}
                            aria-label={item.label}
                            title={item.label}
                            className={[
                              "flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl border-2 transition active:scale-[0.98]",
                              hairColorId === item.id ? "border-[#FFB15D] bg-[#2E2442]" : "border-[#73DFFF]/25 bg-[#151F41]"
                            ].join(" ")}
                          >
                            <span className="h-5 w-5 rounded-full border border-white/30" style={{ backgroundColor: item.swatch }} />
                            <span className="text-[11px] font-black text-[#D4F5FF]">{item.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid gap-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-black text-[#FFE9B0]">특징</p>
                        <div role="tablist" aria-label="특징 입력 방식" className="flex rounded-xl border-2 border-[#73DFFF]/25 bg-[#151F41] p-1">
                          {([
                            { id: "pick", label: "골라서 선택" },
                            { id: "write", label: "직접 쓰기" }
                          ] as const).map((tab) => (
                            <button
                              key={tab.id}
                              type="button"
                              role="tab"
                              aria-selected={featureTab === tab.id}
                              onClick={() => setFeatureTab(tab.id)}
                              className={[
                                "min-h-9 rounded-lg px-3 text-sm font-black transition active:scale-[0.98]",
                                featureTab === tab.id ? "bg-[#F0633C] text-white" : "text-[#D4F5FF]"
                              ].join(" ")}
                            >
                              {tab.label}
                              {tab.id === "pick" && featureIds.length ? ` ${featureIds.length}` : ""}
                              {tab.id === "write" && featureTextTrimmed ? " ✓" : ""}
                            </button>
                          ))}
                        </div>
                      </div>
                      {featureTab === "pick" ? (
                      <div className="grid grid-cols-3 gap-2">
                        {heroFeatures.map((item) => {
                          const active = featureIds.includes(item.id);
                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() =>
                                setFeatureIds((current) =>
                                  current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id]
                                )
                              }
                              className={[
                                "min-h-11 rounded-xl border-2 text-sm font-black transition active:scale-[0.98]",
                                active ? "border-[#FFB15D] bg-[#2E2442] text-white" : "border-[#73DFFF]/25 bg-[#151F41] text-[#D4F5FF]"
                              ].join(" ")}
                            >
                              {item.label}
                            </button>
                          );
                        })}
                      </div>
                      ) : (
                        <div className="grid gap-1">
                          <textarea
                            value={featureText}
                            onChange={(event) => setFeatureText(sanitizeFeatureText(event.target.value))}
                            maxLength={maxFeatureTextLength}
                            rows={2}
                            placeholder="예: 빨간 목도리를 두르고 인삼 모양 가방을 멘"
                            className="w-full resize-none rounded-xl border border-[#73DFFF]/25 bg-[#151F41] px-4 py-3 text-base font-black text-white outline-none placeholder:text-[#D4F5FF]/45 focus:border-[#FFB15D]"
                          />
                          <p className="flex justify-between gap-2 text-xs font-bold text-[#D4F5FF]/70">
                            <span>
                              {featureTextBlocked
                                ? "다른 표현으로 써 주세요. 이 글은 그림에 넣지 않아요."
                                : "고른 특징과 함께 그림에 반영돼요."}
                            </span>
                            <span>
                              {featureText.length}/{maxFeatureTextLength}
                            </span>
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}

                {step === "trait" ? (
                  <div className="space-y-6">
                    <div>
                      <p className="text-base font-black text-[#7DFFD4]">2단계</p>
                      <h2 className="text-3xl font-black">{heroName.trim() || "주인공"}의 성격은?</h2>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {traits.map((item) => (
                        <button key={item.id} type="button" onClick={() => setTrait(item)} className={choiceButtonClass(trait.id === item.id)}>
                          <span className="flex items-center justify-between gap-3 text-xl font-black">
                            {item.label}
                            {trait.id === item.id ? <CheckIcon className="h-6 w-6 text-[#1F8A74]" /> : null}
                          </span>
                        </button>
                      ))}
                    </div>
                    <div className="rounded-2xl border border-[#73DFFF]/20 bg-[#0B1029]/72 p-3">
                      <p className="mb-2 text-sm font-black text-[#D4F5FF]">직접 입력</p>
                      <div className="grid grid-cols-[1fr_auto] gap-2">
                        <input
                          value={customTrait}
                          onChange={(event) => setCustomTrait(sanitizeCustomChoice(event.target.value))}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") applyCustomTrait();
                          }}
                          maxLength={24}
                          placeholder="예: 상상력이 풍부한"
                          className="min-h-12 rounded-xl border border-[#73DFFF]/25 bg-[#151F41] px-4 text-base font-black text-white outline-none placeholder:text-[#D4F5FF]/45 focus:border-[#FFB15D]"
                        />
                        <button
                          type="button"
                          onClick={applyCustomTrait}
                          className="min-h-12 rounded-xl border border-[#FFB15D] bg-[#F0633C] px-4 text-sm font-black text-white active:scale-[0.98]"
                        >
                          추가
                        </button>
                      </div>
                      {customError ? <p className="mt-2 text-sm font-black text-[#FFD073]">{customError}</p> : null}
                    </div>
                  </div>
                ) : null}

                {step === "place" ? (
                  <div className="flex h-full min-h-0 flex-col gap-3">
                    <div className="shrink-0">
                      <p className="text-base font-black text-[#7DFFD4]">3단계</p>
                      <h2 className="text-[clamp(24px,2.4vw,30px)] font-black leading-tight">이야기 배경을 골라요</h2>
                    </div>
                    <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
                      {places.map((item) => (
                        <button key={item.id} type="button" onClick={() => setPlace(item)} className={compactChoiceButtonClass(place.id === item.id)}>
                          <MiniPlaceArt place={item} />
                          <span className="text-sm font-black">{item.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {step === "events" ? (
                  <div className="space-y-3">
                    <div>
                      <p className="text-base font-black text-[#7DFFD4]">4단계</p>
                      <h2 className="text-3xl font-black">기승전결을 완성해요</h2>
                    </div>
                    <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                      {[
                        ["opening", "발단", eventGroups.opening],
                        ["development", "전개", eventGroups.development],
                        ["climax", "절정", eventGroups.climax],
                        ["ending", "결말", eventGroups.ending]
                      ].map(([key, title, list]) => (
                        <div key={key as string} className="rounded-2xl border border-[#73DFFF]/20 bg-[#0B1029]/72 p-2">
                          <p className="mb-1 text-xs font-black text-[#D4F5FF]">{title as string}</p>
                          <div className="grid grid-cols-2 gap-1.5">
                            {(list as Choice[]).map((item) => {
                              const eventKey = key as keyof StorySelection["events"];
                              const active = events[eventKey].id === item.id;
                              return (
                                <button
                                  key={item.id}
                                  type="button"
                                  onClick={() => updateEvent(eventKey, item)}
                                  className={[
                                    "min-h-8 rounded-xl border px-2.5 py-1 text-left text-[10px] font-black leading-snug transition active:scale-[0.98]",
                                    active ? "border-[#FFB15D] bg-[#2E2442] text-white" : "border-[#73DFFF]/25 bg-[#151F41] text-[#D4F5FF]"
                                  ].join(" ")}
                                >
                                  {item.label}
                                </button>
                              );
                            })}
                          </div>
                          <div className="mt-2 grid grid-cols-[1fr_auto] gap-1.5">
                            <input
                              value={customEvents[key as keyof StorySelection["events"]]}
                              onChange={(event) => {
                                const eventKey = key as keyof StorySelection["events"];
                                const value = sanitizeCustomChoice(event.target.value);
                                setCustomEvents((current) => ({ ...current, [eventKey]: value }));
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") applyCustomEvent(key as keyof StorySelection["events"]);
                              }}
                              maxLength={24}
                              placeholder={`${title as string} 직접 쓰기`}
                              className="min-h-8 rounded-xl border border-[#73DFFF]/25 bg-[#151F41] px-2.5 text-[10px] font-black text-white outline-none placeholder:text-[#D4F5FF]/45 focus:border-[#FFB15D]"
                            />
                            <button
                              type="button"
                              onClick={() => applyCustomEvent(key as keyof StorySelection["events"])}
                              className="min-h-8 rounded-xl border border-[#FFB15D] bg-[#F0633C] px-2.5 text-[10px] font-black text-white active:scale-[0.98]"
                            >
                              추가
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                    {customError ? <p className="text-sm font-black text-[#FFD073]">{customError}</p> : null}
                  </div>
                ) : null}

                {step === "loading" ? (
                  <div className="space-y-6 text-center">
                    <div className="mx-auto h-20 w-20 animate-spin rounded-full border-8 border-[#F2B33D]/30 border-t-[#1F8A74]" />
                    <h2 className="text-4xl font-black">동화를 짓는 중...</h2>
                    <p className="text-xl font-bold leading-8 text-[#D4F5FF]">
                      연결이 느려도 괜찮아요. 필요하면 내장 엔진이 바로 동화를 완성해요.
                    </p>
                  </div>
                ) : null}

                {step === "result" ? (
                  <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto pr-1">
                    <div>
                      <p className="text-sm font-black text-[#7DFFD4]">
                        {story.source === "ai" ? "AI가 새로 지은 동화" : "내장 엔진 동화"}
                      </p>
                      <h2 className="text-[clamp(24px,2.4vw,30px)] font-black leading-tight">{pdfMetadata.title}</h2>
                    </div>
                    <StoryTextPanel
                      story={story}
                      pageIndex={pageIndex}
                      imageReady={!currentPageImageLoading}
                      onPrev={() => setPageIndex((current) => Math.max(0, current - 1))}
                      onNext={() => setPageIndex((current) => Math.min(story.pages.length - 1, current + 1))}
                    />
                    <div className="rounded-2xl border border-[#FFB15D]/30 bg-[#2E2442]/72 p-2">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-xs font-black text-[#FFE9B0]">
                          배경음악 <span className="font-bold text-[#D4F5FF]/70">· 영상 저장 시 자동으로 들어가요</span>
                        </p>
                        <button
                          type="button"
                          onClick={toggleStoryMusic}
                          className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl border border-[#73DFFF]/45 bg-[#101A38]/72 px-3 text-xs font-black text-[#DDFBFF] active:scale-[0.98]"
                        >
                          <MusicalNoteIcon className="h-4 w-4" /> {musicState === "playing" ? "미리듣기 정지" : "미리듣기"}
                        </button>
                      </div>
                      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                        {musicGenres.map((genre) => {
                          const active = musicGenreId === genre.id;
                          return (
                            <button
                              key={genre.id}
                              type="button"
                              onClick={() => selectMusicGenre(genre.id)}
                              title={genre.description}
                              className={[
                                "min-h-8 rounded-xl border px-2 text-xs font-black transition active:scale-[0.98]",
                                active ? "border-[#FFB15D] bg-[#F0633C] text-white" : "border-[#73DFFF]/25 bg-[#151F41] text-[#D4F5FF]"
                              ].join(" ")}
                            >
                              {genre.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-2 rounded-2xl border border-[#73DFFF]/20 bg-[#0B1029]/72 p-2 sm:grid-cols-2">
                      <SecondaryButton onClick={generateCoverImage} disabled={Boolean(imageGenerationMode) || Boolean(sceneImages[0])}>
                        <SparklesIcon className="h-5 w-5" /> {imageGenerationMode === "cover" ? "대표 그림 생성 중" : sceneImages[0] ? "대표 그림 완료" : "대표 그림 만들기"}
                      </SecondaryButton>
                      <SecondaryButton onClick={generatePrintableImages} disabled={Boolean(imageGenerationMode) || printableImagesReady}>
                        <PrinterIcon className="h-5 w-5" /> {imageGenerationMode === "print" ? "출력용 그림 생성 중" : printableImagesReady ? "출력용 그림 완료" : "출력용 그림 만들기"}
                      </SecondaryButton>
                      {imageGenerationMessage ? (
                        <p className="col-span-1 rounded-xl border border-[#FFD073]/35 bg-[#2E2442]/80 px-3 py-2 text-xs font-black text-[#FFE9B0] sm:col-span-2">
                          {imageGenerationMessage}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {step !== "loading" && step !== "result" ? (
                  <div className="mt-auto flex shrink-0 items-center justify-between gap-3 border-t border-[#73DFFF]/20 pt-3">
                    <SecondaryButton onClick={() => (currentStepIndex <= 0 ? reset() : move(-1))}>
                      <ArrowLeftIcon className="h-5 w-5" /> 이전
                    </SecondaryButton>
                    {step === "events" ? (
                      <PrimaryButton onClick={createStory}>
                        동화 만들기 <SparklesIcon className="h-6 w-6" />
                      </PrimaryButton>
                    ) : (
                      <PrimaryButton onClick={() => move(1)}>
                        다음 <ArrowRightIcon className="h-6 w-6" />
                      </PrimaryButton>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
            {step === "result" ? (
              <div className="flex w-full flex-col gap-3 pb-1">
                {grade ? (
                  <div className="rounded-2xl border border-[#73DFFF]/25 bg-[#0B1029]/72 p-2.5">
                    <p className="mb-1.5 text-xs font-black text-[#7DFFD4]">
                      🎬 동화 영상 만들기
                    </p>
                    <p className="mb-2 text-[11px] font-bold text-[#D4F5FF]/80">
                      &ldquo;영상 미리보기&rdquo;로 재생해 보고 &ldquo;영상 다운로드&rdquo;로 저장하세요. 한 장면을 움직이게 하려면 쪽을 고르고 &ldquo;한 쪽 움직임&rdquo;을 먼저 누르면 돼요(선택).
                      배경음악은 위에서 고른 <span className="text-[#FFE9B0]">{selectedMusicGenre.label}</span>이(가) 영상에 자동으로 들어가요 🎵
                    </p>
                    <div className="mb-2 grid grid-cols-6 gap-1.5">
                      {IMAGE_PAGES.map((i) => {
                        const active = videoPageIndex === i;
                        const made = clipPageIndex === i;
                        return (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setVideoPageIndex(i)}
                            disabled={videoPhase === "clip" || videoPhase === "render"}
                            className={[
                              "min-h-9 rounded-xl border px-2 text-xs font-black transition active:scale-[0.98] disabled:opacity-50",
                              active
                                ? "border-[#FFB15D] bg-[#F0633C] text-white"
                                : "border-[#73DFFF]/25 bg-[#151F41] text-[#D4F5FF]"
                            ].join(" ")}
                          >
                            {i + 1}쪽{made ? " ✓" : ""}
                          </button>
                        );
                      })}
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      <SecondaryButton
                        onClick={makeSceneClip}
                        disabled={videoPhase === "clip" || videoPhase === "render"}
                      >
                        <VideoCameraIcon className="h-5 w-5" />{" "}
                        {videoPhase === "clip"
                          ? "만드는 중…"
                          : clipPageIndex === videoPageIndex
                            ? "움직임 완료 ✓"
                            : "한 쪽 움직임"}
                      </SecondaryButton>
                      <SecondaryButton
                        onClick={() => makeStoryVideo(false)}
                        disabled={videoPhase === "render" || videoPhase === "clip"}
                      >
                        <FilmIcon className="h-5 w-5" />{" "}
                        {videoPhase === "render" ? "만드는 중…" : "영상 미리보기"}
                      </SecondaryButton>
                      <SecondaryButton
                        onClick={() => {
                          if (storyVideoUrl) downloadBuiltVideo();
                          else void makeStoryVideo(true);
                        }}
                        disabled={videoPhase === "render" || videoPhase === "clip"}
                      >
                        <ArrowDownTrayIcon className="h-5 w-5" />{" "}
                        {videoPhase === "render" ? "만드는 중…" : "영상 다운로드"}
                      </SecondaryButton>
                      <SecondaryButton
                        onClick={printStorybook}
                        disabled={Boolean(imageGenerationMode) || videoPhase === "render"}
                      >
                        <ArrowDownTrayIcon className="h-5 w-5" />{" "}
                        {imageGenerationMode === "print" ? "PDF 준비 중" : "PDF 저장"}
                      </SecondaryButton>
                    </div>
                    {storyVideoUrl ? (
                      <div className="mt-2 rounded-xl border border-[#73DFFF]/25 bg-[#0B1029]/72 p-2">
                        <video
                          src={storyVideoUrl}
                          controls
                          playsInline
                          className="w-full rounded-lg bg-black"
                        />
                      </div>
                    ) : null}
                    {videoMessage ? (
                      <p className="mt-2 rounded-xl border border-[#FFD073]/35 bg-[#2E2442]/80 px-3 py-2 text-xs font-black text-[#FFE9B0]">
                        {videoMessage}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <SecondaryButton
                    onClick={printStorybook}
                    disabled={Boolean(imageGenerationMode) || videoPhase === "render"}
                  >
                    <ArrowDownTrayIcon className="h-5 w-5" />{" "}
                    {imageGenerationMode === "print" ? "PDF 준비 중" : "그림책 PDF로 저장하기"}
                  </SecondaryButton>
                )}
              </div>
            ) : null}
          </div>
        )}
      </section>
    </main>
  );
}
