import { randomUUID } from "node:crypto";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { createAdminAccessStore } from "./adminAccess.js";
import { buildGeminiImageRequest, extractGeminiImageResult } from "./geminiImage.js";
import { toProviderErrorResponse } from "./providerErrors.js";

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3001);
const providerName = (process.env.PROVIDER || "gemini").toLowerCase();
const maxPerMinute = Number(process.env.MAX_PER_MIN || 20);
const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean)
  : true;
// Gemini 네이티브 이미지 생성 (무료 티어 지원)
const geminiImageModel = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
const geminiThinkingBudget = Number(process.env.GEMINI_THINKING_BUDGET ?? 0);
// Veo 영상 생성용 공통 키/엔드포인트 (이미지·동화 호출과 동일한 GEMINI_API_KEY 사용)
const geminiApiKey = process.env.GEMINI_API_KEY || "";
const geminiBase = "https://generativelanguage.googleapis.com/v1beta";
const veoModel = process.env.GEMINI_VIDEO_MODEL || "veo-3.1-fast-generate-preview";
// Veo 클립 길이(초). 4/6/8만 허용. 기본 6(자연스러움+비용 절감). 잘못된 값이면 6으로 보정.
const veoDurationSeconds = [4, 6, 8].includes(Number(process.env.GEMINI_VIDEO_SECONDS))
  ? Number(process.env.GEMINI_VIDEO_SECONDS)
  : 6;
// 영상(Veo) 동시 처리 한도는 "프로젝트(=키)당 약 10개"라, 여러 키로 분산하면 동시성이 늘어난다.
// GEMINI_API_KEYS="키1,키2,키3" 처럼 쉼표로 여러 개 넣을 수 있고, 없으면 GEMINI_API_KEY 한 개를 쓴다.
const geminiVideoKeys = (process.env.GEMINI_API_KEYS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (!geminiVideoKeys.length && geminiApiKey) geminiVideoKeys.push(geminiApiKey);
// 키 1개당 안전 동시 처리 수(공식 한도 10 미만으로 여유). 총 동시 = 키 수 × 이 값.
const veoConcurrencyPerKey = Number(process.env.VEO_CONCURRENCY_PER_KEY || 8);
// 대기열 최대 인원(메모리 보호). 초과 시 잠시 후 다시 시도 안내.
const veoMaxQueue = Number(process.env.VEO_MAX_QUEUE || 80);
const rateBuckets = new Map();
const adminAccess = createAdminAccessStore();

// 동시 이미지 생성 요청 수를 제한해 Gemini RPM 초과를 방지
const MAX_CONCURRENT_IMAGE = 3;
const MAX_QUEUE_SIZE = 12;
let activeImageCount = 0;
const imageQueue = [];

function acquireImageSlot(timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    if (activeImageCount >= MAX_CONCURRENT_IMAGE && imageQueue.length >= MAX_QUEUE_SIZE) {
      return reject(new Error("image_queue_full"));
    }

    const release = () => {
      activeImageCount--;
      const next = imageQueue.shift();
      if (next) next();
    };

    let timer = null;

    const activate = () => {
      clearTimeout(timer);
      activeImageCount++;
      resolve(release);
    };

    if (activeImageCount < MAX_CONCURRENT_IMAGE) {
      return activate();
    }

    timer = setTimeout(() => {
      const idx = imageQueue.indexOf(activate);
      if (idx >= 0) imageQueue.splice(idx, 1);
      reject(new Error("image_queue_timeout"));
    }, timeoutMs);

    imageQueue.push(activate);
  });
}

app.use(cors({ origin: corsOrigin }));
// 영상 생성(/api/video/start)은 그림 data URL(수 MB)을 본문에 담아 보내므로 한도를 키운다.
app.use(express.json({ limit: "12mb" }));

const providers = {
  gemini: {
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    key: process.env.GEMINI_API_KEY,
    call: callGemini
  },
  claude: {
    model: process.env.ANTHROPIC_MODEL || "claude-3-5-haiku-latest",
    key: process.env.ANTHROPIC_API_KEY,
    call: callClaude
  },
  openai: {
    model: process.env.OPENAI_MODEL || "gpt-4.1-nano",
    key: process.env.OPENAI_API_KEY,
    baseUrl: "https://api.openai.com/v1/chat/completions",
    call: callOpenAICompatible
  },
  upstage: {
    model: process.env.UPSTAGE_MODEL || "solar-pro2",
    key: process.env.UPSTAGE_API_KEY,
    baseUrl: "https://api.upstage.ai/v1/chat/completions",
    call: callOpenAICompatible
  },
  grok: {
    model: process.env.GROK_MODEL || "grok-4.1",
    key: process.env.GROK_API_KEY,
    baseUrl: "https://api.x.ai/v1/chat/completions",
    call: callOpenAICompatible
  }
};

function selectedProvider() {
  return providers[providerName] || providers.gemini;
}

function isRateLimited(ip) {
  const now = Date.now();
  const bucket = rateBuckets.get(ip) || { count: 0, resetAt: now + 60000 };

  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + 60000;
  }

  bucket.count += 1;
  rateBuckets.set(ip, bucket);
  return bucket.count > maxPerMinute;
}

// 브라우저에서 온 짧은 설명 문자열을 프롬프트에 넣기 전에 정리한다(줄바꿈·백틱 제거, 길이 제한).
function cleanPromptText(value, maxLength) {
  return String(value || "").replace(/[\r\n`]+/g, " ").trim().slice(0, maxLength);
}

const heroTypeWords = { man: "남성", woman: "여성", boy: "남자 어린이", girl: "여자 어린이", robot: "로봇" };

function buildPrompt(selection, grade) {
  const events = selection.events || {};
  const isUpper = grade === "5-6";
  const gradeLabel = isUpper ? "5~6" : "3~4";
  const g = selection.character?.gender;
  // 예: "여성, 노년(70살 이상) 할머니". 나이대 정보가 없으면 유형만 쓴다.
  const genderWord = cleanPromptText(selection.character?.heroLabel, 60) || heroTypeWords[g] || "";
  const genderPart = genderWord ? ` (${genderWord})` : "";
  const name = selection.character?.name || "주인공";
  const trait = selection.trait?.label || "다정한";
  const placeName = selection.place?.name || "평화로운 마을";
  const opening = events.opening?.label || "";
  const development = events.development?.label || "";
  const climax = events.climax?.label || "";
  const ending = events.ending?.label || "";

  return `아래 설정으로 동화 한 편을 써 줘.

- 만들고 읽는 학생 : 초등 ${gradeLabel}학년
- 주인공: ${name}${genderPart} (성격: ${trait})
- 배경: ${placeName}
- 이야기 흐름: 발단 ${opening}, 전개 ${development}, 절정 ${climax}, 결말 ${ending}

반드시 지킬 고정값(절대 바꾸지 않는다):
- 주인공의 이름은 반드시 '${name}'(으)로 한다. 다른 이름으로 바꾸거나 새로 지어내지 않는다.
- 배경(장소)은 반드시 '${placeName}'(으)로 한다. 아래 규칙의 예시에 다른 장소가 나와도 그것으로 바꾸지 않는다.
${placeName === "칠백의총" ? "- 이 장소는 나라를 위해 목숨을 바친 분들을 기리는 곳이다. 추모하는 마음을 지키고, 소란스럽거나 가볍게 다루지 않는다. 파티·장난 같은 요소는 넣지 않는다.\n" : ""}${genderWord ? `- 주인공은 '${genderWord}'이다. 성별과 나이대를 바꾸지 않고, 그 나이에 어울리는 말투와 행동으로 쓴다.\n` : ""}${!isUpper ? "- 초등 3~4학년용이므로 각 쪽은 반드시 1~2개의 짧은 문장, 한 쪽당 40~70자 이내로 짧게 쓴다. 절대 길게 늘여 쓰지 않는다.\n" : ""}
중요 소재 반영 규칙:
- 2쪽 발단에는 반드시 '${opening}'의 핵심 소재가 보여야 한다.
- 3쪽 전개에는 반드시 '${development}'의 핵심 행동이 이어져야 한다.
- 4쪽 절정에는 반드시 '${climax}'의 핵심 문제가 나타나야 한다.
- 6쪽 결말에는 반드시 '${ending}'의 핵심 결과가 드러나야 한다.
- 문장을 글자 그대로 복사할 필요는 없지만, 사용자가 넣은 핵심 명사는 빠뜨리지 않는다.

조건:

1) 정확히 6쪽짜리 동화로 쓴다.

2) 1쪽 배경·주인공 소개, 2쪽 발단, 3쪽 전개, 4쪽 절정, 5쪽 해결 행동, 6쪽 결말과 배운 점으로 구성한다.

3) 선택한 사건 문장을 그대로 복사하거나 따옴표로 넣지 말고 자연스러운 장면으로 바꾼다.

4) 학년별 난이도 규칙을 적용한다.
- 초등 3~4학년: 쉬운 어휘, 한 쪽당 1~2개의 짧은 문장으로 40~70자 이내, 직관적인 사건 전개 (길게 늘여 쓰지 않는다)
- 초등 5~6학년: 조금 더 풍부한 표현, 추론 가능한 사건 전개, 다양한 감정 표현

5) 이전 쪽의 결과 때문에 다음 쪽 사건이 일어나도록 원인과 결과를 명확하게 연결한다.

6) 주인공의 성격이 문제를 해결하는 행동 속에서 자연스럽게 드러나야 한다.

7) 주인공 이름의 조사는 받침 여부에 맞게 올바르게 사용한다.

8) 따뜻하고 교훈이 은은하게 느껴지는 결말로 마무리한다.

9) 성격이 '엉뚱한'이면 '영뚱한'처럼 오탈자를 만들지 않는다.

10) 따옴표(" ")와 작은따옴표(' ')를 사용하지 않는다.

11) 이야기 유형을 다양하게 선택한다.
다음 유형 중 하나 이상을 활용하되, 반복적인 패턴을 피한다.
- 모험
- 탐험
- 미스터리
- 추리
- 성장
- 우정
- 발명
- 시간여행
- 판타지
- 역사 체험
- 동물 친구
- 환경 보호
- 축제
- 스포츠
- 음악
- 마을 전설
- 비밀 지도
- 꿈속 여행
- 과학 실험
- 문제 해결

12) 문제 발생 원인을 다양하게 구성한다.
문제는 항상 악당 때문일 필요가 없다.
예시:
- 자연 현상
- 실수
- 오해
- 호기심
- 잃어버림
- 고장
- 수수께끼
- 역사적 비밀
- 예상치 못한 변화
- 친구의 고민
- 동물의 도움 요청

13) 해결 방법을 다양하게 구성한다.
주인공은 매번 용기만으로 해결하지 않는다.
예시:
- 관찰
- 협력
- 창의적 아이디어
- 끈기
- 지식 활용
- 실험
- 설득
- 공감
- 배려
- 계획 세우기
- 발명
- 추리

14) 이야기 중 최소 1회는 예상하기 어려운 전환점(반전)을 넣는다.
예시:
- 문제의 원인이 사실은 도움이 되는 존재였다.
- 찾던 물건이 전혀 다른 장소에 있었다.
- 적이라고 생각한 인물이 협력자가 되었다.
- 실패라고 생각한 행동이 해결의 단서가 되었다.

15) 배경은 단순한 장소가 아니라 사건에 영향을 주는 요소로 활용한다.
예시:
- 인삼밭의 그늘막과 붉은 인삼 열매가 사건의 단서가 된다.
- 적벽강의 붉은 절벽과 물길이 문제 해결에 영향을 준다.
- 칠백의총의 오래된 비석과 소나무가 이야기의 실마리를 준다.
- 장소의 특징이 사건의 원인이나 해결 과정에 연결된다.

16) 반복 표현을 피한다.
아래 표현을 습관적으로 사용하지 않는다.
- 용기를 내어
- 힘을 합쳐
- 모두 함께
- 행복하게
- 그제야 알게 되었다
- 소중함을 깨달았다

같은 의미를 새로운 문장으로 표현한다.

17) 결말을 다양하게 구성한다.
항상 축제, 칭찬, 상장, 성공으로 끝나지 않는다.
예시:
- 새로운 목표 발견
- 다음 모험의 암시
- 새로운 친구와의 약속
- 작은 변화의 시작
- 마을의 전통 계승
- 비밀을 지켜 주기로 함
- 다른 사람을 돕게 됨

18) 등장인물을 다양하게 구성한다.
항상 또래 친구만 등장시키지 않는다.
예시:
- 할머니
- 할아버지
- 동생
- 장인
- 역사 속 인물
- 동물
- 관광객
- 발명가
- 수호자
- 마을 어른
- 안내인
- 신비한 존재

19) 입력된 소재들은 서로 연결되도록 활용한다.
단순히 장소나 사물을 나열하지 않는다.
각 소재가 사건의 원인, 단서, 해결 과정 중 하나 이상에 기여해야 한다.

20) 교훈은 설교처럼 직접 설명하지 않는다.
등장인물의 행동과 결과를 통해 자연스럽게 느껴지게 한다.

21) 같은 입력으로 여러 번 생성하더라도 이전에 자주 사용된 서사 패턴을 반복하지 않는다.
이야기 유형, 문제 원인, 조력자, 해결 방식, 반전, 결말을 가능한 한 새롭게 조합하여 매번 다른 작품처럼 느껴지게 한다.

22) AI가 자주 사용하는 전형적인 서사 구조를 우선적으로 회피한다.
예시:
- 문제 발견 → 친구 도움 → 해결 → 칭찬
- 잃어버림 → 찾음 → 교훈
- 위기 → 용기 → 성공
같은 구조가 반복되지 않도록 새로운 전개를 우선 선택한다.

23) 사건의 규모를 다양화한다.
항상 큰 위기만 만들지 않는다.
작은 호기심, 일상의 변화, 신기한 발견도 충분한 이야기 소재가 될 수 있다.

24) 이야기마다 감정의 중심을 다르게 설정한다.
예시:
- 설렘
- 긴장
- 호기심
- 웃음
- 감동
- 신비함
- 뿌듯함
- 아쉬움
한 가지 감정이 이야기 전체를 이끌도록 구성한다.

25) 반드시 길이 6인 JSON 문자열 배열만 출력한다.

출력 형식 예:
[
  "1쪽 내용",
  "2쪽 내용",
  "3쪽 내용",
  "4쪽 내용",
  "5쪽 내용",
  "6쪽 내용"
]

추가 출력 금지:
- 제목 출력 금지
- 설명 출력 금지
- 마크다운 출력 금지
- 페이지 번호 표기 금지
- JSON 배열 외 다른 텍스트 출력 금지

반드시 길이 6짜리 JSON 문자열 배열만 출력한다.`;
}

function buildImagePrompt(selection, scene, pageIndex) {
  const character = selection.character?.name || "주인공";
  const trait = selection.trait?.label || "다정한";
  const place = selection.place?.name || "환상적인 마을";
  const characterId = selection.character?.id || "hero";
  const gender = selection.character?.gender;
  const isCustom = gender in heroTypeWords;
  const ageDesc = cleanPromptText(selection.character?.ageDesc, 160);
  const hair = String(selection.character?.hair || "").trim();
  const features = Array.isArray(selection.character?.features)
    ? selection.character.features.filter(Boolean)
    : [];
  const featureText = features.length ? `, with ${features.join(", ")}` : "";
  const placeKey = selection.place?.sceneKey || "village";
  const palette = {
    kong: "cream white rabbit-like child hero with very long rounded ears, blush pink cheeks, tiny paws, soft pastel pink scarf",
    gaya: "brave Korean girl child with warm golden jacket, round face, short dark hair, curious bright eyes",
    dani: "Korean boy child with sky-blue hoodie, round face, neat dark hair, gentle smile",
    robot: "small friendly rounded robot with lavender metal body, teal screen face, soft glowing eyes",
    miyo: "small orange-and-cream cat hero with round cheeks, bright eyes, tiny satchel",
    buri: "baby dragon hero with mint green scales, tiny wings, round snout, kind eyes"
  };
  const settingBible = {
    village: "peaceful fantasy village at sunset, round clay houses, warm windows, soft hills",
    forest: "magical fairy forest, oversized mushrooms, glowing flowers, leafy arches, sunbeams",
    island: "dreamlike island, turquoise water, round rocks, colorful flowers, soft clouds",
    sea: "sparkling underwater world, coral gardens, bubbles, gentle blue light",
    cloud: "castle above the clouds, soft white cloud bridges, pearl towers, pastel sky",
    insam: "a sunlit Korean ginseng village in Geumsan, long rows of low ginseng plants under dark green shade screens on wooden frames, glossy five-part leaves with clusters of bright red berries, a few cozy traditional houses at the edge of the fields, forested mountain ridges behind, warm earthy soil",
    jeokbyeok: "a wide calm river curving beneath tall reddish-brown rock cliffs, pebbled riverbank, willow trees, mist over the water, soft golden late-afternoon light",
    chilbaek: "a quiet Korean memorial ground with a wide stone-paved courtyard, a tall stone monument, a low tiled-roof shrine gate, rows of tall pine trees, still and solemn morning light"
  };

  // 이름·유형(남성/여성/남자 어린이/여자 어린이/로봇)·나이대·머리색·특징으로 주인공 외형을 구성한다.
  let characterBible;
  let speciesNote;
  let consistencyLine;
  if (gender === "robot") {
    const bodyColor = hair ? hair.replace(/\s*hair$/, "") : "silver";
    characterBible = `a friendly rounded robot, ${ageDesc || "a child-sized small robot"}, with smooth ${bodyColor}-colored body panels, glowing round eyes, a gentle cheerful expression${featureText}`;
    speciesNote = ", a friendly cute robot (not an animal, not a human child)";
    consistencyLine = "Do not redesign the protagonist between pages. Always draw the protagonist as the same robot; never turn it into an animal or a human.";
  } else if (gender === "boy" || gender === "girl") {
    const who = gender === "boy" ? "boy" : "girl";
    // 옷차림을 구체적으로 고정해 모든 쪽에서 같은 복장이 유지되도록 한다.
    const outfit = gender === "boy"
      ? "wearing a light blue hooded top, navy-blue jeans, and white sneakers"
      : "wearing a coral-pink long-sleeve shirt, light-blue jeans, and white sneakers";
    characterBible = `a friendly Korean ${who} child, ${ageDesc || "around 9-11 years old"}, with ${hair || "black hair"}, bright round eyes, rosy cheeks, ${outfit}${featureText}`;
    speciesNote = ", a real human child (not an animal, not a robot, not a mascot)";
    consistencyLine = "Do not redesign the protagonist between pages. Always draw the protagonist as the same human child at the same age; never turn them into an animal, a robot, or a mascot.";
  } else if (gender === "man" || gender === "woman") {
    const who = gender === "man" ? "man" : "woman";
    const outfit = gender === "man"
      ? "wearing a navy-blue casual jacket over a white shirt, beige trousers, and brown walking shoes"
      : "wearing a mustard-yellow cardigan over a white blouse, navy-blue trousers, and brown walking shoes";
    characterBible = `a friendly Korean ${who}, ${ageDesc || "an adult in their thirties or forties"}, with ${hair || "black hair"}, warm kind eyes, a gentle smile, ${outfit}${featureText}`;
    speciesNote = ", a real human adult (not a child, not an animal, not a robot, not a mascot)";
    consistencyLine = "Do not redesign the protagonist between pages. Always draw the protagonist as the same adult person at the same age; never make them younger or older, and never turn them into a child, an animal, a robot, or a mascot.";
  } else {
    characterBible = palette[characterId] || palette.kong;
    speciesNote = "";
    consistencyLine = "Do not redesign the protagonist between pages. Do not change the protagonist into a different animal, different age, different costume, or different color palette.";
  }

  const pageNum = Number(pageIndex) + 1;
  const flowRoleEn =
    [
      "introduce the protagonist and the setting",
      "show the beginning where the first event starts",
      "show the story developing further",
      "show the climax with the biggest problem or turning point",
      "show the protagonist's resolving action",
      "show the warm ending that wraps up the story"
    ][Number(pageIndex)] || "show a moment of the story";

  return [
    "Create one original children's storybook scene illustration.",
    "Visual direction: warm 3D animated feature film look, rounded toy-like characters, soft cinematic lighting, expressive faces, colorful magical atmosphere, high detail, family friendly, no text, no logos, no copyrighted characters, no imitation of an existing studio or franchise.",
    "Maintain strict visual continuity across all 6 pages of the same book.",
    `Character bible: ${characterBible}. This is the single named protagonist${speciesNote}. Keep the exact same face shape, hairstyle, eye color, body proportions, outfit, accessories, colors, and facial features on every page.`,
    "Treat the character bible as a fixed character model sheet: reproduce the protagonist's face, hairstyle, body proportions, and the exact same outfit identically on every page, as if drawn from the same reference sheet. Only the pose, action, expression, and scene change between pages.",
    consistencyLine,
    "Outfit lock: the protagonist wears the exact same outfit with the same colors on every page — the same top, same bottoms, same shoes, and same accessories. Never change, recolor, or restyle the clothing between pages.",
    "Anatomy must be correct and natural: the protagonist has exactly one head, two arms, and two hands with five fingers each, and two legs. Never draw extra, duplicated, or floating hands, arms, fingers, or limbs; no deformed or merged fingers.",
    "Supporting characters may appear only when needed by the story, but keep them small and secondary. They must not distract from, replace, duplicate, or be confused with the protagonist.",
    "Do not include Sami, the app guide mascot (a cute ginseng-root sprite with leaves and red berries on its head), logos, watermark, text labels, captions, or any extra sticker-like overlay inside the generated illustration.",
    `Setting bible: ${settingBible[placeKey] || settingBible.village}. Keep the same world design, palette, lighting mood, and material style across pages.`,
    ...(placeKey === "chilbaek" ? ["Keep the mood respectful and quiet; no party, no balloons, no playful chaos."] : []),
    "Use a consistent square storybook composition: protagonist clearly visible in the foreground or middle ground, clear foreground action, soft background depth, no extreme camera angle changes, no cropping that makes the character unrecognizable.",
    `This is page ${pageNum} of a 6-page continuous story; this page should ${flowRoleEn}. Illustrate the specific moment described below with its own distinct action, pose, expression, composition, and background detail.`,
    "Across the 6 pages each illustration must look clearly different and follow the story's progression in order; never repeat the same scene, pose, or composition. Keep the same protagonist and the same outfit while only the action and surroundings change to match each page's moment.",
    `Main character: ${character}, personality: ${trait}.`,
    `Setting: ${place}.`,
    `Story moment in Korean: ${scene}`,
    "Composition: one clear main action that matches this exact story moment, cozy emotion, child-safe, readable at kiosk distance."
  ].join("\n");
}

const systemPrompt = [
  "너는 한국 어린이를 위한 따뜻하고 상상력 넘치는 동화 작가다.",
  "초·중등 학생이 읽을 수 있도록 쉽고 바른 우리말, 존댓말을 쓴다.",
  "폭력적이거나 무섭거나 차별적인 표현은 절대 쓰지 않는다.",
  "요청한 출력 형식(JSON 배열) 외에는 어떤 글자도 출력하지 않는다."
].join("\n");

function parseScenes(rawText) {
  const text = String(rawText || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const candidates = [text];
  const firstArray = text.indexOf("[");
  const lastArray = text.lastIndexOf("]");
  const firstObject = text.indexOf("{");
  const lastObject = text.lastIndexOf("}");

  if (firstArray >= 0 && lastArray > firstArray) {
    candidates.push(text.slice(firstArray, lastArray + 1));
  }

  if (firstObject >= 0 && lastObject > firstObject) {
    candidates.push(text.slice(firstObject, lastObject + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      const scenes = Array.isArray(parsed) ? parsed : parsed.scenes || parsed.pages;
      if (Array.isArray(scenes) && scenes.length >= 6) {
        return scenes.slice(0, 6).map((scene) => String(scene).trim()).filter(Boolean);
      }
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error("Could not parse scenes from provider response");
}

async function fetchJson(url, options, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();

    if (!response.ok) {
      throw new Error(`Provider HTTP ${response.status}: ${text.slice(0, 300)}`);
    }

    return JSON.parse(text);
  } finally {
    clearTimeout(timeout);
  }
}

async function callGemini(provider, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${provider.model}:generateContent?key=${provider.key}`;
  const generationConfig = {
    maxOutputTokens: 2048,
    temperature: 0.85,
    responseMimeType: "application/json"
  };

  if (provider.model.includes("2.5") && Number.isFinite(geminiThinkingBudget)) {
    generationConfig.thinkingConfig = { thinkingBudget: geminiThinkingBudget };
  }

  const data = await fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig
    })
  }, 15000);

  return data.candidates?.[0]?.content?.parts?.map((part) => part.text).join("\n") || "";
}

async function callClaude(provider, prompt) {
  const data = await fetchJson("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": provider.key,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }]
    })
  });

  return data.content?.map((part) => part.text).join("\n") || "";
}

async function callOpenAICompatible(provider, prompt) {
  const data = await fetchJson(provider.baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.key}`
    },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: 1000,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt }
      ]
    })
  });

  return data.choices?.[0]?.message?.content || "";
}

async function callGeminiImage(prompt) {
  const key = providers.gemini.key;
  if (!key) throw new Error("GEMINI_API_KEY not set");

  const request = buildGeminiImageRequest({ model: geminiImageModel, key, prompt });
  const data = await fetchJson(request.url, request.options, 45000);
  return extractGeminiImageResult(data);
}

async function callGeminiImageWithRetry(prompt) {
  try {
    return await callGeminiImage(prompt);
  } catch (error) {
    const msg = String(error?.message || "").toLowerCase();
    if (msg.includes("429") || msg.includes("quota") || msg.includes("rate")) {
      console.warn("Gemini image 429 — 3초 후 재시도");
      await new Promise((r) => setTimeout(r, 3000));
      return callGeminiImage(prompt);
    }
    throw error;
  }
}

function validateSelection(selection) {
  return Boolean(
    selection &&
      selection.character?.name &&
      selection.trait?.label &&
      selection.place?.name &&
      selection.events?.opening?.label &&
      selection.events?.development?.label &&
      selection.events?.climax?.label &&
      selection.events?.ending?.label
  );
}

app.get("/api/health", (req, res) => {
  const provider = selectedProvider();
  res.json({
    ok: true,
    provider: providerName in providers ? providerName : "gemini",
    model: provider.model,
    keyLoaded: Boolean(provider.key),
    imageModel: geminiImageModel,
    imageKeyLoaded: Boolean(providers.gemini.key),
    thinkingBudget: geminiThinkingBudget,
    videoModel: veoModel,
    videoSeconds: veoDurationSeconds,
    videoKeys: geminiVideoKeys.length,
    adminConfigured: adminAccess.configured
  });
});

app.post("/api/admin-login", (req, res) => {
  const result = adminAccess.login({
    adminId: req.body?.adminId,
    password: req.body?.password,
    ip: req.ip
  });

  return res.status(result.ok ? 200 : 403).json(result);
});

// 새로고침/재방문 시 저장된 토큰이 아직 살아 있는지 확인한다.
app.post("/api/admin-session", (req, res) => {
  const result = adminAccess.verify(req.body?.sessionToken);
  return res.status(result.ok ? 200 : 401).json(result);
});

app.post("/api/admin-logout", (req, res) => {
  return res.json(adminAccess.logout(req.body?.sessionToken));
});

// 수업용 아이디(M-01~M-99)와 교사 초기화 코드는 폐지됐다.
// 예전 앱이 캐시된 태블릿이 계속 호출할 수 있으므로 명시적으로 막는다.
app.post(["/api/class-login", "/api/class-reset"], (req, res) => {
  return res.status(410).json({
    ok: false,
    reason: "class_access_retired",
    message: "수업 아이디는 더 이상 사용하지 않아요. 관리자만 로그인할 수 있어요."
  });
});

// AI 호출은 서버가 발급한 관리자 토큰이 있어야만 통과한다.
// 브라우저가 만든 토큰이나 localStorage 조작으로는 뚫리지 않는다.
function denyUnlessAdmin(req, res) {
  const access = adminAccess.verify(req.body?.sessionToken);
  if (access.ok) return null;

  res.status(401).json({ error: "admin_auth_required", ...access });
  return access;
}

app.post("/api/story", async (req, res) => {
  if (isRateLimited(req.ip)) {
    return res.status(429).json({ error: "rate_limited" });
  }

  if (denyUnlessAdmin(req, res)) return undefined;

  const provider = selectedProvider();
  if (!provider.key) {
    return res.status(503).json({ error: "missing_api_key" });
  }

  const selection = req.body?.selection;
  if (!validateSelection(selection)) {
    return res.status(400).json({ error: "invalid_selection" });
  }

  try {
    const prompt = buildPrompt(selection, req.body?.grade);
    const rawText = await provider.call(provider, prompt);
    const scenes = parseScenes(rawText);
    return res.json({ scenes, provider: providerName in providers ? providerName : "gemini" });
  } catch (error) {
    console.error(error);
    const response = toProviderErrorResponse(error, "provider_failed");
    return res.status(response.statusCode).json(response.body);
  }
});

app.post("/api/image", async (req, res) => {
  if (isRateLimited(req.ip)) {
    return res.status(429).json({ error: "rate_limited" });
  }

  if (denyUnlessAdmin(req, res)) return undefined;

  if (!providers.gemini.key) {
    return res.status(503).json({ error: "missing_gemini_api_key" });
  }

  const selection = req.body?.selection;
  const scene = req.body?.scene;
  const pageIndex = Number(req.body?.pageIndex || 0);

  if (!validateSelection(selection) || typeof scene !== "string" || !scene.trim()) {
    return res.status(400).json({ error: "invalid_image_request" });
  }

  let release;
  try {
    release = await acquireImageSlot(30000);
  } catch {
    return res.status(429).json({
      error: "image_quota_exceeded",
      message: "이미지 생성 요청이 많아요. 잠시 뒤 다시 눌러 주세요.",
      retryAfterSeconds: 15
    });
  }

  try {
    const prompt = buildImagePrompt(selection, scene, pageIndex);
    const { b64, mimeType } = await callGeminiImageWithRetry(prompt);
    return res.json({ imageBase64: b64, mimeType, prompt, provider: "gemini", model: geminiImageModel });
  } catch (error) {
    console.error(error);
    const response = toProviderErrorResponse(error, "image_provider_failed");
    return res.status(response.statusCode).json(response.body);
  } finally {
    if (release) release();
  }
});

// ===========================================================================
//  Veo 영상 생성 (선택한 한 쪽 그림을 8초 클립으로 변환)
//  - 이미지/동화 호출과 동일한 geminiApiKey, 전역 fetch 사용
//  - 비동기 작업: start로 작업 시작 → status 폴링으로 완료 확인
// ===========================================================================

// jobId -> {
//   status: "queued"|"running"|"done"|"error",
//   prompt, imageData, imageMime,        // 대기 중 보관(시작되면 imageData는 비움)
//   apiKey, opName, videoBase64, mimeType, error,
//   createdAt, enqueuedAt, startedAt, finishedAt, lastPoll, retryAfter
// }
const videoJobs = new Map();
const VIDEO_JOB_TTL = 30 * 60 * 1000;

// 키별 현재 처리(in-flight) 수
const keyInFlight = new Map(geminiVideoKeys.map((k) => [k, 0]));
const incKey = (k) => keyInFlight.set(k, (keyInFlight.get(k) || 0) + 1);
const decKey = (k) => keyInFlight.set(k, Math.max(0, (keyInFlight.get(k) || 0) - 1));
// 할당량(429)에 걸린 키는 잠시 쉬게 한다(이 시각 전까지 건너뜀).
// 한 프로젝트가 하루 한도를 다 써도, 남은 프로젝트(키)로 자동 분배되도록.
const keyCooldownUntil = new Map();
const KEY_COOLDOWN_MS = 2 * 60 * 1000;
// 여유 슬롯이 있는 키를 찾는다(쿨다운 중인 키는 건너뛰고, 가장 한가한 키 우선).
function pickFreeKey() {
  const now = Date.now();
  let best = null;
  let bestLoad = veoConcurrencyPerKey;
  for (const k of geminiVideoKeys) {
    if (now < (keyCooldownUntil.get(k) || 0)) continue; // 할당량 초과로 쉬는 키
    const load = keyInFlight.get(k) || 0;
    if (load < bestLoad) {
      best = k;
      bestLoad = load;
    }
  }
  return best;
}
function totalCapacity() {
  return geminiVideoKeys.length * veoConcurrencyPerKey;
}
function queuedJobsSorted() {
  return [...videoJobs.values()]
    .filter((j) => j.status === "queued")
    .sort((a, b) => a.enqueuedAt - b.enqueuedAt);
}
function queuePosition(job) {
  const q = queuedJobsSorted();
  const idx = q.findIndex((j) => j === job);
  return idx < 0 ? 0 : idx + 1;
}

function finishJob(job, status, message) {
  job.status = status;
  if (message) job.error = message;
  job.finishedAt = Date.now();
  if (job.apiKey) {
    decKey(job.apiKey);
    job.apiKey = null;
  }
  job.imageData = null; // 메모리 회수
}

// 대기 중인 작업을 빈 슬롯에 실제로 Veo로 보낸다.
async function dispatchJob(job) {
  const key = pickFreeKey();
  if (!key) return false;
  job.apiKey = key;
  job.status = "running";
  job.startedAt = Date.now();
  incKey(key);
  try {
    const body = {
      instances: [{ prompt: job.prompt, image: { bytesBase64Encoded: job.imageData, mimeType: job.imageMime } }],
      // durationSeconds는 4/6/8만 가능. 짧을수록 비용↓(초당 과금). 자연스러움 위해 기본 6초.
      parameters: { aspectRatio: "16:9", durationSeconds: veoDurationSeconds }
    };
    const r = await fetch(`${geminiBase}/models/${veoModel}:predictLongRunning?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const j = await r.json();
    if (!r.ok || !j.name) {
      // 할당량 초과(429)는 일시적일 수 있으니 슬롯을 비우고 잠시 후 재시도(대기 상태로 되돌림).
      decKey(key);
      job.apiKey = null;
      if (r.status === 429 || j?.error?.status === "RESOURCE_EXHAUSTED") {
        // 이 키(프로젝트)는 할당량에 걸렸으니 잠시 쉬게 하고, 남은 키로 분배되게 한다.
        keyCooldownUntil.set(key, Date.now() + KEY_COOLDOWN_MS);
        // 빈 슬롯이 있었는데도 429라면 "줄이 밀려서"가 아니라 실제 할당량 문제.
        // 모든 키가 다 막혔을 때만(=계속 재시도해도 빈 키 없음) 오래 매달리지 말고 분명히 알린다.
        job.quotaStrikes = (job.quotaStrikes || 0) + 1;
        if (job.quotaStrikes >= 3) {
          finishJob(
            job,
            "error",
            "지금은 영상 생성 사용량(할당량)을 초과했어요. 잠시 후 다시 시도하거나 선생님께 알려 주세요."
          );
          return true;
        }
        job.status = "queued";
        job.retryAfter = Date.now() + 8000;
        return false;
      }
      finishJob(job, "error", j?.error?.message || "영상 생성을 시작하지 못했어요");
      return true;
    }
    job.opName = j.name;
    job.imageData = null; // 제출 완료 → 큰 이미지 데이터 회수
    job.lastPoll = 0;
    return true;
  } catch (error) {
    // 네트워크 등 일시 오류 → 슬롯 비우고 잠시 후 재시도
    decKey(key);
    job.apiKey = null;
    job.status = "queued";
    job.retryAfter = Date.now() + 15000;
    return false;
  }
}

// 진행 중(running) 작업의 Veo 작업 상태를 폴링해 완료/실패를 반영하고 슬롯을 비운다.
async function pollRunningJob(job) {
  try {
    const r = await fetch(`${geminiBase}/${job.opName}?key=${job.apiKey}`);
    const j = await r.json();
    if (!j.done) return;

    const sample =
      j?.response?.generateVideoResponse?.generatedSamples?.[0] ||
      j?.response?.generatedSamples?.[0] ||
      j?.response?.videos?.[0];
    const inline = sample?.video?.bytesBase64Encoded || sample?.bytesBase64Encoded;
    const fileUri = sample?.video?.uri || sample?.uri;

    if (inline) {
      job.videoBase64 = inline;
      job.mimeType = sample?.video?.mimeType || "video/mp4";
      finishJob(job, "done");
      return;
    }
    if (fileUri) {
      const fr = await fetch(`${fileUri}${fileUri.includes("?") ? "&" : "?"}key=${job.apiKey}`);
      const buf = Buffer.from(await fr.arrayBuffer());
      job.videoBase64 = buf.toString("base64");
      job.mimeType = fr.headers.get("content-type") || "video/mp4";
      finishJob(job, "done");
      return;
    }
    finishJob(job, "error", "영상 결과를 해석하지 못했어요");
  } catch (error) {
    // 일시 오류는 다음 틱에서 재시도
  }
}

// 스케줄러: running 폴링 → 빈 슬롯에 대기열 배정 → 오래된 작업 정리
let veoTicking = false;
async function veoTick() {
  if (veoTicking) return;
  veoTicking = true;
  try {
    const now = Date.now();
    // 1) 진행 중 작업 폴링(작업당 5초 간격)
    const running = [...videoJobs.values()].filter((j) => j.status === "running" && j.opName);
    await Promise.all(
      running.map((job) => {
        if (now - (job.lastPoll || 0) < 5000) return null;
        job.lastPoll = now;
        // 너무 오래(8분) 걸리면 실패 처리
        if (job.startedAt && now - job.startedAt > 8 * 60 * 1000) {
          finishJob(job, "error", "영상 만들기가 너무 오래 걸려요. 다시 시도해 주세요.");
          return null;
        }
        return pollRunningJob(job);
      })
    );
    // 2) 빈 슬롯이 있으면 대기열에서 꺼내 배정
    for (const job of queuedJobsSorted()) {
      if (job.retryAfter && now < job.retryAfter) continue;
      if (!pickFreeKey()) break;
      await dispatchJob(job);
    }
    // 3) 완료/오래된 작업 정리
    for (const [id, job] of videoJobs) {
      if (now - job.createdAt > VIDEO_JOB_TTL) videoJobs.delete(id);
    }
  } finally {
    veoTicking = false;
  }
}
if (geminiVideoKeys.length) {
  setInterval(() => {
    veoTick().catch(() => undefined);
  }, 3000).unref?.();
}

// data URL("data:image/png;base64,....")에서 mime/base64 분리
function splitDataUrl(dataUrl) {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || "");
  if (!m) return null;
  return { mimeType: m[1], data: m[2] };
}

// 1) 영상 생성 요청을 "대기열"에 넣고 작업ID 반환 (실제 Veo 호출은 스케줄러가 빈 슬롯에 배정).
//    이렇게 하면 동시 한도(키당 ~10) 안에서 30명을 줄 세워 안전하게 처리한다.
app.post("/api/video/start", async (req, res) => {
  if (isRateLimited(req.ip)) {
    return res.status(429).json({ message: "요청이 많아요. 잠시 후 다시 시도해 주세요." });
  }
  if (!geminiVideoKeys.length) {
    return res.status(503).json({ message: "영상 API 키가 설정되지 않았어요." });
  }

  // 영상은 Veo 할당량을 크게 쓰므로 관리자 세션을 항상 요구한다.
  if (denyUnlessAdmin(req, res)) return undefined;

  const img = splitDataUrl(req.body?.imageDataUrl);
  if (!img) return res.status(400).json({ message: "그림 데이터가 올바르지 않아요" });

  // 대기열이 너무 길면 보호(메모리/경험). 잠시 후 다시 시도하도록 안내.
  if (queuedJobsSorted().length >= veoMaxQueue) {
    return res.status(429).json({ message: "지금 만들기를 기다리는 친구가 많아요. 잠시 후 다시 눌러 주세요." });
  }

  const now = Date.now();
  const jobId = randomUUID();
  videoJobs.set(jobId, {
    status: "queued",
    prompt:
      req.body?.prompt ||
      "Animate this children's storybook illustration with gentle, subtle motion. Soft camera move, the character moves slightly and naturally. Keep the same art style, characters, and colors. No text, no captions.",
    imageData: img.data,
    imageMime: img.mimeType,
    apiKey: null,
    opName: null,
    createdAt: now,
    enqueuedAt: now
  });

  const position = queuePosition(videoJobs.get(jobId));
  res.json({ jobId, position, capacity: totalCapacity() });
  // 빈 슬롯이 있으면 즉시 배정 시도(다음 틱을 기다리지 않도록)
  veoTick().catch(() => undefined);
});

// 2) 작업 상태 확인(폴링) → 대기 순번 / 진행 / 완료(영상 base64) 반환
//    실제 Veo 폴링은 스케줄러(veoTick)가 하므로 여기서는 저장된 상태만 읽는다.
app.get("/api/video/status", (req, res) => {
  const job = videoJobs.get(req.query.jobId);
  if (!job) return res.json({ status: "error", message: "작업을 찾을 수 없어요" });

  if (job.status === "queued") {
    return res.json({ status: "queued", position: queuePosition(job), capacity: totalCapacity() });
  }
  if (job.status === "running") {
    return res.json({ status: "running" });
  }
  if (job.status === "done") {
    return res.json({ status: "done", videoBase64: job.videoBase64, mimeType: job.mimeType });
  }
  return res.json({ status: "error", message: job.error || "영상 만들기에 실패했어요" });
});

app.listen(port, () => {
  const provider = selectedProvider();
  console.log(`Story proxy listening on http://localhost:${port}`);
  console.log(`Provider: ${providerName in providers ? providerName : "gemini"} / ${provider.model}`);
  console.log(`API key loaded: ${Boolean(provider.key)}`);
  console.log(
    `Veo: model=${veoModel}, keys=${geminiVideoKeys.length}, perKey=${veoConcurrencyPerKey}, totalConcurrent=${geminiVideoKeys.length * veoConcurrencyPerKey}`
  );
});
