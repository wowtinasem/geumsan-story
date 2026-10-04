import { randomUUID } from "node:crypto";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { createAdminAccessStore, isMiddleSchool } from "./adminAccess.js";
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
const geminiImageModel = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image";
const geminiThinkingBudget = Number(process.env.GEMINI_THINKING_BUDGET ?? 0);
// Gemini 3 이후 모델은 thinkingBudget 대신 thinkingLevel을 쓴다. 동화 글은 빠른 응답이 중요해서 기본 low.
const geminiThinkingLevel = String(process.env.GEMINI_THINKING_LEVEL ?? "low").trim();
const rateBuckets = new Map();
const adminAccess = createAdminAccessStore();

// ---------------------------------------------------------------------------
//  수업 동시 사용 대비 설정 (학생 최대 60명 동시)
//  - Gemini 한도는 "프로젝트 단위"라 키를 여러 개 넣어도 늘지 않는다.
//  - 그림 모델 분당 한도(RPM)가 100이라 여유를 두고 분당 90장까지만 보낸다.
// ---------------------------------------------------------------------------
const IMAGE_RPM_LIMIT = Number(process.env.IMAGE_RPM_LIMIT || 90);
const IMAGE_MAX_CONCURRENT = Number(process.env.IMAGE_MAX_CONCURRENT || 16);
const IMAGE_MAX_QUEUE = Number(process.env.IMAGE_MAX_QUEUE || 400);
// 한 요청이 대기 줄에서 기다리는 최대 시간. 넘으면 "잠시 뒤 다시"로 돌려보내고 브라우저가 자동으로 다시 줄을 선다.
// (Render 앞단 Cloudflare가 아주 긴 요청을 끊을 수 있어 한 요청은 짧게 유지한다.)
const IMAGE_QUEUE_WAIT_MS = Number(process.env.IMAGE_QUEUE_WAIT_MS || 40000);
// 학생 한 명(학교·학년·반·번호·이름)이 쓸 수 있는 최대 횟수. 관리자는 제한 없음.
// 학생 한 명이 기본으로 만들 수 있는 양. "다시 만들기"는 관리자가 허락할 때마다 같은 양을 더 준다.
const STORY_LIMIT_PER_STUDENT = Number(process.env.STORY_LIMIT_PER_STUDENT || 1); // 동화 1편
const IMAGE_LIMIT_PER_STUDENT = Number(process.env.IMAGE_LIMIT_PER_STUDENT || 8); // 그림 6장 + 여유 2장
// MOCK_AI=1 이면 Gemini 대신 가짜 글·그림을 돌려준다(부하 시험용, 비용 없음).
const MOCK_AI = process.env.MOCK_AI === "1";

let activeImageCount = 0;
const imageQueue = []; // 대기 중인 { activate, timer }
const imageStartTimes = []; // 최근 60초 동안 Gemini로 보낸 시각
const imageStats = { done: 0, failed: 0, busyReturned: 0, totalMs: 0 };

function pruneImageStarts(t) {
  while (imageStartTimes.length && imageStartTimes[0] <= t - 60000) imageStartTimes.shift();
}

function canStartImage(t = Date.now()) {
  pruneImageStarts(t);
  return activeImageCount < IMAGE_MAX_CONCURRENT && imageStartTimes.length < IMAGE_RPM_LIMIT;
}

let pumpTimer = null;
function pumpImageQueue() {
  const t = Date.now();
  while (imageQueue.length && canStartImage(t)) {
    const next = imageQueue.shift();
    clearTimeout(next.timer);
    next.activate();
  }
  // 분당 한도 때문에 멈췄다면, 가장 오래된 기록이 1분을 지나는 순간 다시 시도한다.
  if (imageQueue.length && !pumpTimer && activeImageCount < IMAGE_MAX_CONCURRENT && imageStartTimes.length) {
    const wait = Math.max(50, imageStartTimes[0] + 60000 - t + 10);
    pumpTimer = setTimeout(() => {
      pumpTimer = null;
      pumpImageQueue();
    }, wait);
  }
}

function acquireImageSlot(timeoutMs = IMAGE_QUEUE_WAIT_MS) {
  return new Promise((resolve, reject) => {
    if (imageQueue.length >= IMAGE_MAX_QUEUE) {
      return reject(new Error("image_queue_full"));
    }

    const release = () => {
      activeImageCount--;
      pumpImageQueue();
    };
    const activate = () => {
      activeImageCount++;
      imageStartTimes.push(Date.now());
      resolve(release);
    };

    if (!imageQueue.length && canStartImage()) return activate();

    const entry = { activate, timer: null };
    entry.timer = setTimeout(() => {
      const idx = imageQueue.indexOf(entry);
      if (idx >= 0) imageQueue.splice(idx, 1);
      reject(new Error("image_queue_timeout"));
    }, timeoutMs);
    imageQueue.push(entry);
    pumpImageQueue();
  });
}

function imageQueueStatus() {
  pruneImageStarts(Date.now());
  return {
    active: activeImageCount,
    waiting: imageQueue.length,
    startedLastMinute: imageStartTimes.length,
    rpmLimit: IMAGE_RPM_LIMIT,
    maxConcurrent: IMAGE_MAX_CONCURRENT,
    done: imageStats.done,
    failed: imageStats.failed,
    busyReturned: imageStats.busyReturned,
    avgSeconds: imageStats.done ? Math.round(imageStats.totalMs / imageStats.done / 100) / 10 : 0
  };
}

// 학생별 사용 횟수 (서버 메모리. 재시작하면 0부터 다시 센다)
const usageCounters = new Map();
function usageKey(access) {
  if (!access || access.role !== "student" || !access.student) return null;
  const { school, grade, classNo, number, name } = access.student;
  return `${sameSchoolKey(school)}|${grade}|${classNo ?? ""}|${number}|${String(name).replace(/\s+/g, "")}`;
}
// "금산 초등학교", "금산초등학교", "금산초"를 같은 학교로 본다 (중학교도 같은 방식)
function sameSchoolKey(school) {
  return String(school || "").replace(/\s+/g, "").replace(/초등학교$/, "초").replace(/중학교$/, "중");
}
function usageOf(key) {
  if (!usageCounters.has(key)) usageCounters.set(key, { stories: 0, images: 0, extraStories: 0, extraImages: 0, restarts: 0 });
  return usageCounters.get(key);
}
function storyLimitOf(usage) {
  return STORY_LIMIT_PER_STUDENT + usage.extraStories;
}
function imageLimitOf(usage) {
  return IMAGE_LIMIT_PER_STUDENT + usage.extraImages;
}

// "다시 만들기" 요청: 학생이 요청하면 관리자 현황판에 뜨고, 관리자가 허락하면 동화 1편·그림 몫을 더 준다.
// 서버 메모리에 둔다(재시작하면 기다리던 요청은 사라지고 학생이 다시 요청하면 된다).
const RESTART_REQUEST_TTL_MS = 30 * 60 * 1000;
const restartRequests = new Map(); // key → { key, student, requestedAt, status }
function pruneRestartRequests(t = Date.now()) {
  for (const [key, request] of restartRequests) {
    if (t - request.requestedAt > RESTART_REQUEST_TTL_MS) restartRequests.delete(key);
  }
}

// 관리자 현황판용 "오늘" 집계 (한국 시간 기준 날짜가 바뀌면 0부터. 서버 메모리라 재시작하면 다시 센다)
const serverStartedAt = Date.now();
function koreaDate(t = Date.now()) {
  return new Date(t + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function emptyDailyStats() {
  return { date: koreaDate(), stories: 0, storyFailed: 0, images: 0, imageFailed: 0, imageBusy: 0, schools: new Map() };
}
let dailyStats = emptyDailyStats();
function today() {
  if (dailyStats.date !== koreaDate()) dailyStats = emptyDailyStats();
  return dailyStats;
}
function schoolOf(access) {
  if (!access || access.role !== "student" || !access.student) return null;
  const stats = today();
  const name = access.student.school;
  if (!stats.schools.has(name)) stats.schools.set(name, { students: new Set(), stories: 0, images: 0 });
  return stats.schools.get(name);
}
function countToday(access, field) {
  const stats = today();
  stats[field] += 1;
  const school = schoolOf(access);
  if (!school) return;
  school.students.add(usageKey(access));
  if (field === "stories" || field === "images") school[field] += 1;
}

app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: "1mb" }));

const providers = {
  gemini: {
    model: process.env.GEMINI_MODEL || "gemini-3.8-flash",
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

// 한 학교 학생들은 같은 인터넷 주소를 쓰므로, 로그인한 사람별로 센다. 로그인 전이면 주소로 센다.
function rateKey(req) {
  const token = String(req.body?.sessionToken || "");
  return token ? `t:${token.slice(-24)}` : `ip:${req.ip}`;
}

function isRateLimited(key) {
  const now = Date.now();
  const bucket = rateBuckets.get(key) || { count: 0, resetAt: now + 60000 };

  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + 60000;
  }

  bucket.count += 1;
  rateBuckets.set(key, bucket);
  if (rateBuckets.size > 5000) {
    for (const [k, b] of rateBuckets) if (now > b.resetAt) rateBuckets.delete(k);
  }
  return bucket.count > maxPerMinute;
}

// 브라우저에서 온 짧은 설명 문자열을 프롬프트에 넣기 전에 정리한다(줄바꿈·백틱 제거, 길이 제한).
function cleanPromptText(value, maxLength) {
  return String(value || "").replace(/[\r\n`]+/g, " ").trim().slice(0, maxLength);
}

const heroTypeWords = { man: "남성", woman: "여성", boy: "남자 어린이", girl: "여자 어린이", robot: "로봇" };

function buildPrompt(selection, grade, student) {
  const events = selection.events || {};
  const isMiddle = Boolean(student && isMiddleSchool(student.school));
  // 학년 선택이 없어진 뒤로 앱은 "all"을 보낸다. 3~4학년용 짧은 글은 "3-4"를 보낼 때만 쓴다.
  const isUpper = isMiddle || grade !== "3-4";
  const gradeLabel = grade === "3-4" ? "3~4" : grade === "5-6" ? "5~6" : "3~6";
  const readerLabel = isMiddle ? `중학교 ${student.grade}학년` : `초등 ${gradeLabel}학년`;
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

- 만들고 읽는 학생 : ${readerLabel}
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
${isMiddle ? `- 중학생: 어린아이 말투(~했어요, ~했답니다)를 쓰지 않고 청소년 소설처럼 담백한 문장(~했다)으로 쓴다. 주인공의 고민과 선택, 마음속 갈등을 보여 주고, 비유와 복선을 한두 번 사용한다. 교훈은 직접 말하지 않고 여운으로 남긴다. 한 쪽당 2~4문장, 90~160자 이내로 쓴다(책 한 쪽에 들어가야 하므로 더 길게 쓰지 않는다).` : `- 초등 3~4학년: 쉬운 어휘, 한 쪽당 1~2개의 짧은 문장으로 40~70자 이내, 직관적인 사건 전개 (길게 늘여 쓰지 않는다)
- 초등 5~6학년: 조금 더 풍부한 표현, 추론 가능한 사건 전개, 다양한 감정 표현`}

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

18) 이야기의 시대는 오늘날(현재)이다. 마을 사람과 가족은 요즘 옷차림과 생활을 한다. 한복은 명절(설날·추석 등) 장면에서만 입는다. 역사 속 인물이나 시간여행은 이야기에 꼭 필요할 때만 쓴다.

18-1) 등장인물을 다양하게 구성한다.
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

  // 시대는 오늘날. 장면 글에 명절이 나오면 화려한 한복을, 역사 인물·시간여행이 나오면 그 인물에게만 옛날 옷을 허용한다.
  const sceneText = String(scene || "");
  const isHoliday = /명절|설날|추석|한가위|세배|정월 대보름|단오|한복/.test(sceneText);
  const isHistorical = /조선|고려|삼국|옛날 사람|역사 속|과거로|시간 ?여행|의병|장군|선비|임진왜란/.test(sceneText);
  const eraLine = isHoliday
    ? "Era: present-day Korea during a traditional holiday. Characters may wear colorful, festive, modern-style hanbok for the holiday; everything else (buildings, objects, other people) stays present-day."
    : [
        "Era: present-day Korea (2020s). The protagonist and all supporting characters — children, parents, grandparents, villagers, farmers, researchers — wear modern everyday clothing (t-shirts, hoodies, jackets, cardigans, work vests, jeans, trousers, sneakers).",
        isHistorical
          ? "Only a historical figure explicitly mentioned in the story moment may wear period clothing; everyone else wears modern clothes."
          : "Do not dress anyone in traditional hanbok, Joseon-era clothing, gat hats, or old-fashioned costumes.",
        "Grandparents wear modern clothes like cardigans, blouses, vests, and slacks, not hanbok."
      ].join(" ");

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
    "Output format: exactly ONE single continuous full-bleed illustration showing ONE moment, filling the whole canvas edge to edge. Never a comic page, never panels, grid, collage, split screen, diptych, triptych, storyboard, multiple frames, borders, gutters, or dividing lines; never repeat the same picture twice in one image; never a character turnaround or model sheet. The protagonist appears exactly once in the image.",
    "Visual direction: warm 3D animated feature film look, rounded toy-like characters, soft cinematic lighting, expressive faces, colorful magical atmosphere, high detail, family friendly, no text, no logos, no copyrighted characters, no imitation of an existing studio or franchise.",
    "This request makes the picture for one page only (other pages are drawn separately). Maintain strict visual continuity with the other pages of the same book.",
    `Character bible: ${characterBible}. This is the single named protagonist${speciesNote}. Keep the exact same face shape, hairstyle, eye color, body proportions, outfit, accessories, colors, and facial features on every page.`,
    "Treat the character bible as a fixed character design: reproduce the protagonist's face, hairstyle, body proportions, and the exact same outfit identically on every page. Only the pose, action, expression, and scene change between pages.",
    consistencyLine,
    "Outfit lock: the protagonist wears the exact same outfit with the same colors on every page — the same top, same bottoms, same shoes, and same accessories. Never change, recolor, or restyle the clothing between pages.",
    "Anatomy must be correct and natural: the protagonist has exactly one head, two arms, and two hands with five fingers each, and two legs. Never draw extra, duplicated, or floating hands, arms, fingers, or limbs; no deformed or merged fingers.",
    "Supporting characters may appear only when needed by the story, but keep them small and secondary. They must not distract from, replace, duplicate, or be confused with the protagonist.",
    "Do not include Geumsami, the app narrator mascot (a cute ginseng-root character with green leaves and red berries on its head, a green scarf, green vest, brown shorts and a brown satchel), logos, watermark, text labels, captions, or any extra sticker-like overlay inside the generated illustration.",
    `Setting bible: ${settingBible[placeKey] || settingBible.village}. Keep the same world design, palette, lighting mood, and material style across pages.`,
    eraLine,
    ...(placeKey === "chilbaek" ? ["Keep the mood respectful and quiet; no party, no balloons, no playful chaos."] : []),
    "Use a consistent square storybook composition: protagonist clearly visible in the foreground or middle ground, clear foreground action, soft background depth, no extreme camera angle changes, no cropping that makes the character unrecognizable.",
    `This is page ${pageNum} of a 6-page continuous story; this page should ${flowRoleEn}. Illustrate the specific moment described below with its own distinct action, pose, expression, composition, and background detail.`,
    "Each page's illustration must look clearly different from the other pages and follow the story's progression; never repeat another page's scene, pose, or composition. Keep the same protagonist and the same outfit while only the action and surroundings change to match this page's moment.",
    `Main character: ${character}, personality: ${trait}.`,
    `Setting: ${place}.`,
    `Story moment in Korean: ${scene}`,
    "Composition: one clear main action that matches this exact story moment, cozy emotion, child-safe, readable at kiosk distance.",
    "If the story moment mentions a choice, a sequence, or a before-and-after, still draw only one single moment in one single frame. Output format: exactly ONE single continuous full-bleed illustration showing ONE moment, filling the whole canvas edge to edge. Never a comic page, never panels, grid, collage, split screen, diptych, triptych, storyboard, multiple frames, borders, gutters, or dividing lines; never repeat the same picture twice in one image; never a character turnaround or model sheet. The protagonist appears exactly once in the image."
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

  if (provider.model.includes("2.5")) {
    if (Number.isFinite(geminiThinkingBudget)) {
      generationConfig.thinkingConfig = { thinkingBudget: geminiThinkingBudget };
    }
  } else if (geminiThinkingLevel) {
    generationConfig.thinkingConfig = { thinkingLevel: geminiThinkingLevel };
  }

  const data = await fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig
    })
  }, 30000);

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

function isTransientProviderError(error) {
  const msg = String(error?.message || "").toLowerCase();
  return (
    error?.name === "AbortError" ||
    msg.includes("429") ||
    msg.includes("500") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("504") ||
    msg.includes("quota") ||
    msg.includes("rate") ||
    msg.includes("overloaded") ||
    msg.includes("unavailable") ||
    msg.includes("aborted")
  );
}

async function callGeminiImageWithRetry(prompt, startedAt = Date.now()) {
  try {
    return await callGeminiImage(prompt);
  } catch (error) {
    // 한 요청이 너무 길어지지 않도록, 아직 30초가 안 지났을 때만 서버에서 한 번 더 시도한다.
    // 그 뒤의 재시도는 브라우저가 대기 안내를 보여 주며 맡는다.
    if (isTransientProviderError(error) && Date.now() - startedAt < 30000) {
      console.warn("Gemini 그림 일시 오류 — 3초 후 재시도:", String(error?.message || "").slice(0, 120));
      await new Promise((r) => setTimeout(r, 3000));
      return callGeminiImage(prompt);
    }
    throw error;
  }
}

// 부하 시험용 가짜 응답 (MOCK_AI=1)
const MOCK_IMAGE_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
function mockDelay(minMs, maxMs) {
  return new Promise((r) => setTimeout(r, minMs + Math.random() * (maxMs - minMs)));
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
    thinkingLevel: geminiThinkingLevel,
    mock: MOCK_AI,
    imageQueue: imageQueueStatus(),
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

// 학생 입장: 학교명·학년·반·번호·이름으로 학생 세션 토큰을 받는다.
app.post("/api/student-login", (req, res) => {
  const result = adminAccess.studentLogin({
    school: req.body?.school,
    grade: req.body?.grade,
    classNo: req.body?.classNo,
    number: req.body?.number,
    name: req.body?.name
  });
  if (result.ok) {
    const access = { role: "student", student: result.student };
    schoolOf(access).students.add(usageKey(access));
  }

  return res.status(result.ok ? 200 : 400).json(result);
});

// 새로고침/재방문 시 저장된 토큰이 아직 살아 있는지 확인한다.
app.post("/api/admin-session", (req, res) => {
  const result = adminAccess.verify(req.body?.sessionToken);
  return res.status(result.ok ? 200 : 401).json(result);
});

app.post("/api/admin-logout", (req, res) => {
  return res.json(adminAccess.logout(req.body?.sessionToken));
});

// 관리자 전용 현황판: 그림 대기 줄과 오늘 학교별 사용량.
app.post("/api/admin-stats", (req, res) => {
  const access = adminAccess.verify(req.body?.sessionToken);
  if (!access.ok || access.role !== "admin") {
    return res.status(401).json({ error: "admin_required" });
  }
  const stats = today();
  pruneRestartRequests();
  return res.json({
    now: Date.now(),
    serverStartedAt,
    mock: MOCK_AI,
    imageQueue: imageQueueStatus(),
    limits: { storiesPerStudent: STORY_LIMIT_PER_STUDENT, imagesPerStudent: IMAGE_LIMIT_PER_STUDENT },
    today: {
      date: stats.date,
      students: [...stats.schools.values()].reduce((sum, school) => sum + school.students.size, 0),
      stories: stats.stories,
      storyFailed: stats.storyFailed,
      images: stats.images,
      imageFailed: stats.imageFailed,
      imageBusy: stats.imageBusy
    },
    restartRequests: [...restartRequests.values()]
      .filter((request) => request.status === "pending")
      .sort((a, b) => a.requestedAt - b.requestedAt)
      .map((request) => {
        const usage = usageOf(request.key);
        return { id: request.key, ...request.student, requestedAt: request.requestedAt, stories: usage.stories, images: usage.images, restarts: usage.restarts };
      }),
    schools: [...stats.schools.entries()]
      .map(([school, value]) => ({ school, students: value.students.size, stories: value.stories, images: value.images }))
      .sort((a, b) => b.students - a.students)
  });
});

// 학생: "다시 만들기" 요청. 아직 쓸 몫이 남아 있으면(또는 관리자면) 바로 허락한다.
app.post("/api/restart-request", (req, res) => {
  if (denyUnlessSignedIn(req, res)) return undefined;
  const key = usageKey(req.access);
  if (!key) return res.json({ status: "approved" });
  const usage = usageOf(key);
  if (usage.stories < storyLimitOf(usage)) return res.json({ status: "approved" });
  pruneRestartRequests();
  const current = restartRequests.get(key);
  if (!current || current.status !== "pending") {
    restartRequests.set(key, { key, student: req.access.student, requestedAt: Date.now(), status: "pending" });
  }
  return res.json({ status: "pending" });
});

// 학생: 요청 결과 확인. 허락·거절은 한 번 알려 주면 지운다.
app.post("/api/restart-status", (req, res) => {
  if (denyUnlessSignedIn(req, res)) return undefined;
  const key = usageKey(req.access);
  const request = key ? restartRequests.get(key) : null;
  if (!request) return res.json({ status: "none" });
  if (request.status !== "pending") restartRequests.delete(key);
  return res.json({ status: request.status });
});

app.post("/api/restart-cancel", (req, res) => {
  if (denyUnlessSignedIn(req, res)) return undefined;
  const key = usageKey(req.access);
  if (key && restartRequests.get(key)?.status === "pending") restartRequests.delete(key);
  return res.json({ status: "none" });
});

// 관리자: 요청 허락(approve: true) 또는 거절
app.post("/api/admin-restart-decide", (req, res) => {
  const access = adminAccess.verify(req.body?.sessionToken);
  if (!access.ok || access.role !== "admin") {
    return res.status(401).json({ error: "admin_required" });
  }
  const request = restartRequests.get(String(req.body?.id || ""));
  if (!request || request.status !== "pending") {
    return res.status(404).json({ error: "request_not_found" });
  }
  if (req.body?.approve) {
    const usage = usageOf(request.key);
    usage.extraStories += STORY_LIMIT_PER_STUDENT;
    usage.extraImages += IMAGE_LIMIT_PER_STUDENT;
    usage.restarts += 1;
    request.status = "approved";
  } else {
    request.status = "denied";
  }
  return res.json({ ok: true, status: request.status });
});

// 관리자 전용: 서버의 Gemini 키로 쓸 수 있는 모델 목록을 확인한다(모델 이름 점검용). 키 값은 돌려주지 않는다.
app.post("/api/admin-models", async (req, res) => {
  const access = adminAccess.verify(req.body?.sessionToken);
  if (!access.ok || access.role !== "admin") {
    return res.status(401).json({ error: "admin_required" });
  }
  if (!providers.gemini.key) {
    return res.status(503).json({ error: "missing_api_key" });
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${encodeURIComponent(providers.gemini.key)}`
    );
    const data = await response.json();
    if (!response.ok) {
      return res.status(502).json({ error: "list_failed", status: response.status, message: data?.error?.message });
    }
    const models = (data.models || []).map((model) => ({
      name: String(model.name || "").replace(/^models\//, ""),
      methods: model.supportedGenerationMethods || []
    }));
    return res.json({ configured: { text: providers.gemini.model, image: geminiImageModel }, models });
  } catch (error) {
    console.error(error);
    return res.status(502).json({ error: "list_failed" });
  }
});

// 수업용 아이디(M-01~M-99)와 교사 초기화 코드는 폐지됐다.
// 예전 앱이 캐시된 태블릿이 계속 호출할 수 있으므로 명시적으로 막는다.
app.post(["/api/class-login", "/api/class-reset"], (req, res) => {
  return res.status(410).json({
    ok: false,
    reason: "class_access_retired",
    message: "수업 아이디는 더 이상 사용하지 않아요. 첫 화면에서 학교명·학년·반·번호·이름을 적어 주세요."
  });
});

// AI 호출은 서버가 발급한 토큰(학생 또는 관리자)이 있어야만 통과한다.
// 브라우저가 만든 토큰이나 localStorage 조작으로는 뚫리지 않는다.
function denyUnlessSignedIn(req, res) {
  const access = adminAccess.verify(req.body?.sessionToken);
  if (access.ok) {
    req.access = access;
    return null;
  }

  res.status(401).json({ error: "auth_required", ...access });
  return access;
}

app.post("/api/story", async (req, res) => {
  if (isRateLimited(rateKey(req))) {
    return res.status(429).json({ error: "rate_limited" });
  }

  if (denyUnlessSignedIn(req, res)) return undefined;

  const provider = selectedProvider();
  if (!provider.key && !MOCK_AI) {
    return res.status(503).json({ error: "missing_api_key" });
  }

  const selection = req.body?.selection;
  if (!validateSelection(selection)) {
    return res.status(400).json({ error: "invalid_selection" });
  }

  const key = usageKey(req.access);
  if (key && usageOf(key).stories >= storyLimitOf(usageOf(key))) {
    return res.status(403).json({
      error: "usage_limit",
      reason: "story_limit",
      message: "이미 동화를 만들었어요. 새로 만들려면 \"다시 만들기\"를 눌러 선생님께 허락을 받아 주세요."
    });
  }
  if (key) usageOf(key).stories += 1;

  try {
    if (MOCK_AI) {
      await mockDelay(1500, 3500);
      const name = selection.character?.name || "주인공";
      countToday(req.access, "stories");
      return res.json({
        scenes: Array.from({ length: 6 }, (_, i) => `${name}의 시험용 이야기 ${i + 1}쪽입니다. 부하 시험 중이라 실제 AI 글이 아니에요.`),
        provider: "mock"
      });
    }
    const prompt = buildPrompt(selection, req.body?.grade, req.access?.role === "student" ? req.access.student : null);
    let rawText;
    try {
      rawText = await provider.call(provider, prompt);
    } catch (error) {
      if (!isTransientProviderError(error)) throw error;
      await new Promise((r) => setTimeout(r, 2000));
      rawText = await provider.call(provider, prompt);
    }
    const scenes = parseScenes(rawText);
    countToday(req.access, "stories");
    return res.json({ scenes, provider: providerName in providers ? providerName : "gemini" });
  } catch (error) {
    console.error(error);
    countToday(req.access, "storyFailed");
    if (key) usageOf(key).stories = Math.max(0, usageOf(key).stories - 1);
    const response = toProviderErrorResponse(error, "provider_failed");
    return res.status(response.statusCode).json(response.body);
  }
});

app.post("/api/image", async (req, res) => {
  if (isRateLimited(rateKey(req))) {
    return res.status(429).json({ error: "rate_limited" });
  }

  if (denyUnlessSignedIn(req, res)) return undefined;

  if (!providers.gemini.key && !MOCK_AI) {
    return res.status(503).json({ error: "missing_gemini_api_key" });
  }

  const selection = req.body?.selection;
  const scene = req.body?.scene;
  const pageIndex = Number(req.body?.pageIndex || 0);

  if (!validateSelection(selection) || typeof scene !== "string" || !scene.trim()) {
    return res.status(400).json({ error: "invalid_image_request" });
  }

  const key = usageKey(req.access);
  if (key && usageOf(key).images >= imageLimitOf(usageOf(key))) {
    return res.status(403).json({
      error: "usage_limit",
      message: "그림을 만들 수 있는 몫을 모두 썼어요. 지금까지 만든 그림으로 PDF를 저장하거나 선생님께 말씀해 주세요."
    });
  }

  const startedAt = Date.now();
  let release;
  try {
    release = await acquireImageSlot();
  } catch (error) {
    imageStats.busyReturned += 1;
    today().imageBusy += 1;
    const status = imageQueueStatus();
    return res.status(429).json({
      error: "image_busy",
      message: "친구들이 그림을 많이 만들고 있어요. 순서를 기다리는 중이에요.",
      waiting: status.waiting,
      retryAfterSeconds: String(error?.message).includes("full") ? 10 : 2
    });
  }

  if (key) usageOf(key).images += 1;
  try {
    const prompt = buildImagePrompt(selection, scene, pageIndex);
    let result;
    if (MOCK_AI) {
      await mockDelay(7000, 13000);
      result = { b64: MOCK_IMAGE_B64, mimeType: "image/png" };
    } else {
      result = await callGeminiImageWithRetry(prompt, startedAt);
    }
    imageStats.done += 1;
    imageStats.totalMs += Date.now() - startedAt;
    countToday(req.access, "images");
    return res.json({ imageBase64: result.b64, mimeType: result.mimeType, prompt, provider: MOCK_AI ? "mock" : "gemini", model: geminiImageModel });
  } catch (error) {
    console.error(error);
    imageStats.failed += 1;
    countToday(req.access, "imageFailed");
    if (key) usageOf(key).images = Math.max(0, usageOf(key).images - 1);
    if (isTransientProviderError(error)) {
      return res.status(429).json({
        error: "image_busy",
        message: "그림을 만드는 곳이 잠시 바빠요. 곧 다시 시도할게요.",
        retryAfterSeconds: 5
      });
    }
    const response = toProviderErrorResponse(error, "image_provider_failed");
    return res.status(response.statusCode).json(response.body);
  } finally {
    if (release) release();
  }
});

app.listen(port, () => {
  const provider = selectedProvider();
  console.log(`Story proxy listening on http://localhost:${port}`);
  console.log(`Provider: ${providerName in providers ? providerName : "gemini"} / ${provider.model}`);
  console.log(`API key loaded: ${Boolean(provider.key)}`);
  console.log(
    `Image limits: ${IMAGE_RPM_LIMIT}/min, ${IMAGE_MAX_CONCURRENT} at once, queue ${IMAGE_MAX_QUEUE}; per student ${STORY_LIMIT_PER_STUDENT} stories / ${IMAGE_LIMIT_PER_STUDENT} images${MOCK_AI ? " [MOCK_AI]" : ""}`
  );
});
