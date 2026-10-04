// 입장 방식: 학생(학교명·학년·번호·이름) 또는 관리자(비밀번호).
// 토큰은 서버(story-proxy)만 발급한다. 브라우저는 발급받은 토큰을 보관만 한다.
export const adminSessionStorageKey = "geumsan-story.adminSession.v1";

// 더 이상 쓰지 않는 세션 저장 키. 키 이름을 바꾸면 예전 키를 여기에 넣어 앱을 열 때 지운다.
const retiredSessionStorageKeys: string[] = [];

const storyProxyUrl = process.env.NEXT_PUBLIC_STORY_PROXY_URL?.replace(/\/$/, "") || "http://localhost:3001";

export type StudentInfo = {
  school: string;
  grade: number;
  number: number;
  name: string;
};

export type AdminSession = {
  role: "admin" | "student";
  adminId?: string;
  student?: StudentInfo;
  sessionToken: string;
};

type AdminAuthResponse = {
  ok: boolean;
  role?: "admin" | "student";
  adminId?: string;
  student?: StudentInfo;
  sessionToken?: string;
  message: string;
  reason?: string;
};

// 화면 위쪽·PDF 아래쪽에 보이는 이름표. 예: "금산초 4학년 12번 홍길동"
export function sessionLabel(session: Pick<AdminSession, "role" | "student">) {
  if (session.role === "student" && session.student) {
    const { school, grade, number, name } = session.student;
    return `${school} ${grade}학년 ${number}번 ${name}`;
  }
  return "관리자";
}

export function clearRetiredClassSessions() {
  if (typeof window === "undefined") return;

  for (const key of retiredSessionStorageKeys) {
    window.localStorage.removeItem(key);
  }
}

export function readAdminSession(): AdminSession | null {
  if (typeof window === "undefined") return null;

  try {
    const value = window.localStorage.getItem(adminSessionStorageKey);
    if (!value) return null;
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed.sessionToken === "string") {
      if (parsed.role === "student" && parsed.student && typeof parsed.student.name === "string") {
        return parsed as AdminSession;
      }
      // role이 없는 예전 형식은 관리자 세션으로 본다.
      if (parsed.role === "admin" || typeof parsed.adminId === "string") {
        return { role: "admin", adminId: parsed.adminId, sessionToken: parsed.sessionToken };
      }
    }
  } catch {
    window.localStorage.removeItem(adminSessionStorageKey);
  }

  return null;
}

export function writeAdminSession(session: AdminSession) {
  window.localStorage.setItem(adminSessionStorageKey, JSON.stringify(session));
  return session;
}

export function clearAdminSession() {
  window.localStorage.removeItem(adminSessionStorageKey);
}

async function postAdmin(path: string, body: Record<string, string>): Promise<AdminAuthResponse> {
  const response = await fetch(`${storyProxyUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = (await response.json()) as Partial<AdminAuthResponse>;

  if (!response.ok || !data.ok) {
    return {
      ok: false,
      message: data.message || "로그인할 수 없어요.",
      reason: data.reason || "request_failed"
    };
  }

  return {
    ok: true,
    role: data.role,
    adminId: data.adminId,
    student: data.student,
    sessionToken: data.sessionToken,
    message: data.message || "입장했어요."
  };
}

const networkError: AdminAuthResponse = {
  ok: false,
  message: "서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.",
  reason: "network_error"
};

// 관리자는 비밀번호만 입력한다. 아이디는 서버에 설정된 값을 쓴다.
export async function requestAdminLogin(password: string): Promise<AdminAuthResponse> {
  if (!password) {
    return { ok: false, message: "관리자 비밀번호를 입력해 주세요.", reason: "missing_input" };
  }

  try {
    return await postAdmin("/api/admin-login", { adminId: "", password });
  } catch {
    return networkError;
  }
}

export async function requestStudentLogin(input: {
  school: string;
  grade: string;
  number: string;
  name: string;
}): Promise<AdminAuthResponse> {
  const school = input.school.trim();
  const name = input.name.trim();
  if (!school || !input.grade.trim() || !input.number.trim() || !name) {
    return { ok: false, message: "학교명, 학년, 번호, 이름을 모두 적어 주세요.", reason: "missing_input" };
  }

  try {
    return await postAdmin("/api/student-login", { school, grade: input.grade.trim(), number: input.number.trim(), name });
  } catch {
    return networkError;
  }
}

// 저장된 토큰이 서버에서 아직 유효한지 확인한다.
// 서버가 아니라고 하면 localStorage를 조작해도 들어올 수 없다.
export async function verifyAdminSession(sessionToken: string): Promise<boolean> {
  if (!sessionToken) return false;

  try {
    const result = await postAdmin("/api/admin-session", { sessionToken });
    return result.ok;
  } catch {
    return false;
  }
}

export async function requestAdminLogout(sessionToken: string) {
  if (!sessionToken) return;

  try {
    await postAdmin("/api/admin-logout", { sessionToken });
  } catch {
    // 서버에 못 닿아도 로컬 세션은 지운다.
  }
}

export type AdminStats = {
  now: number;
  serverStartedAt: number;
  mock: boolean;
  imageQueue: {
    active: number;
    waiting: number;
    startedLastMinute: number;
    rpmLimit: number;
    maxConcurrent: number;
    done: number;
    failed: number;
    busyReturned: number;
    avgSeconds: number;
  };
  limits: { storiesPerStudent: number; imagesPerStudent: number };
  today: {
    date: string;
    students: number;
    stories: number;
    storyFailed: number;
    images: number;
    imageFailed: number;
    imageBusy: number;
  };
  schools: { school: string; students: number; stories: number; images: number }[];
  restartRequests?: RestartRequest[];
};

export type RestartRequest = {
  id: string;
  school: string;
  grade: number;
  number: number;
  name: string;
  requestedAt: number;
  stories: number;
  images: number;
  restarts: number;
};

export type RestartStatus = "none" | "pending" | "approved" | "denied";

async function postStatus(path: string, body: Record<string, unknown>): Promise<RestartStatus | null> {
  try {
    const response = await fetch(`${storyProxyUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { status?: RestartStatus };
    return data.status || null;
  } catch {
    return null;
  }
}

// 학생: "다시 만들기" 요청 / 결과 확인 / 취소
export function requestRestart(sessionToken: string) {
  return postStatus("/api/restart-request", { sessionToken });
}

export function checkRestartStatus(sessionToken: string) {
  return postStatus("/api/restart-status", { sessionToken });
}

export function cancelRestart(sessionToken: string) {
  return postStatus("/api/restart-cancel", { sessionToken });
}

// 관리자: 요청 허락(true) 또는 거절(false)
export async function decideRestart(sessionToken: string, id: string, approve: boolean) {
  try {
    const response = await fetch(`${storyProxyUrl}/api/admin-restart-decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionToken, id, approve })
    });
    return response.ok;
  } catch {
    return false;
  }
}

// 관리자 현황판: 관리자 토큰이 아니면 null (로그인이 풀린 경우 포함).
export async function requestAdminStats(sessionToken: string): Promise<AdminStats | "unauthorized" | null> {
  try {
    const response = await fetch(`${storyProxyUrl}/api/admin-stats`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionToken })
    });
    if (response.status === 401) return "unauthorized";
    if (!response.ok) return null;
    return (await response.json()) as AdminStats;
  } catch {
    return null;
  }
}

export type AiConnection = { text: boolean; image: boolean; textModel: string; imageModel: string };

// 관리자 현황판: 서버의 Gemini 키로 설정된 글·그림 모델을 쓸 수 있는지 확인한다(모델 목록 조회라 비용 없음).
export async function requestAiConnection(sessionToken: string): Promise<AiConnection | null> {
  try {
    const response = await fetch(`${storyProxyUrl}/api/admin-models`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionToken })
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { configured?: { text?: string; image?: string }; models?: { name: string }[] };
    const names = new Set((data.models || []).map((model) => model.name));
    const textModel = data.configured?.text || "";
    const imageModel = data.configured?.image || "";
    return { text: names.has(textModel), image: names.has(imageModel), textModel, imageModel };
  } catch {
    return null;
  }
}
