// 관리자 1인 전용 로그인. 수업 아이디(M-01~M-99)와 교사 초기화 코드는 폐지됐다.
// 토큰은 서버(story-proxy)만 발급한다. 브라우저는 발급받은 토큰을 보관만 한다.
export const adminSessionStorageKey = "geumsan-story.adminSession.v1";

// 더 이상 쓰지 않는 세션 저장 키. 키 이름을 바꾸면 예전 키를 여기에 넣어 앱을 열 때 지운다.
const retiredSessionStorageKeys: string[] = [];

const storyProxyUrl = process.env.NEXT_PUBLIC_STORY_PROXY_URL?.replace(/\/$/, "") || "http://localhost:3001";

export type AdminSession = {
  adminId: string;
  sessionToken: string;
};

type AdminAuthResponse = {
  ok: boolean;
  adminId?: string;
  sessionToken?: string;
  message: string;
  reason?: string;
};

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
    if (parsed && typeof parsed.adminId === "string" && typeof parsed.sessionToken === "string") {
      return parsed as AdminSession;
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
    adminId: data.adminId,
    sessionToken: data.sessionToken,
    message: data.message || "관리자 로그인 완료."
  };
}

export async function requestAdminLogin(adminId: string, password: string): Promise<AdminAuthResponse> {
  if (!adminId.trim() || !password) {
    return { ok: false, message: "아이디와 비밀번호를 입력해 주세요.", reason: "missing_input" };
  }

  try {
    return await postAdmin("/api/admin-login", { adminId: adminId.trim(), password });
  } catch {
    return {
      ok: false,
      message: "서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.",
      reason: "network_error"
    };
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
