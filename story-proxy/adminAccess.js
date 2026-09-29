import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

// 관리자 1인 전용 접근. 수업용 아이디(M-01~M-99)와 교사 초기화 코드는 폐지됐다.
// 자격증명은 코드에 두지 않는다. 환경변수가 없으면 로그인 자체가 막힌다(fail-closed).
const sessionTtlMs = 12 * 60 * 60 * 1000;
const maxFailedAttempts = 8;
const lockoutMs = 10 * 60 * 1000;

export function hashPassword(password) {
  return createHash("sha256").update(String(password), "utf8").digest("hex");
}

function safeEqualHex(a, b) {
  const left = Buffer.from(String(a), "utf8");
  const right = Buffer.from(String(b), "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function readAdminCredentials(env = process.env) {
  const adminId = String(env.ADMIN_ID || "").trim();
  const passwordHash = String(env.ADMIN_PASSWORD_HASH || "").trim().toLowerCase();
  const plainPassword = String(env.ADMIN_PASSWORD || "");

  // ADMIN_PASSWORD_HASH(sha256 hex)를 우선한다. 없으면 ADMIN_PASSWORD를 해시해서 쓴다.
  const resolvedHash = passwordHash || (plainPassword ? hashPassword(plainPassword) : "");

  return {
    adminId,
    passwordHash: resolvedHash,
    configured: Boolean(adminId && resolvedHash)
  };
}

export function createAdminAccessStore({
  credentials = readAdminCredentials(),
  now = () => Date.now()
} = {}) {
  const sessions = new Map();
  const failures = new Map();

  function pruneSessions() {
    const cutoff = now() - sessionTtlMs;
    for (const [token, record] of sessions) {
      if (record.issuedAt <= cutoff) sessions.delete(token);
    }
  }

  function attemptState(ip) {
    const key = String(ip || "unknown");
    const record = failures.get(key);
    if (!record) return { key, count: 0, lockedUntil: 0 };
    if (record.lockedUntil && record.lockedUntil <= now()) {
      failures.delete(key);
      return { key, count: 0, lockedUntil: 0 };
    }
    return { key, ...record };
  }

  function registerFailure(ip) {
    const state = attemptState(ip);
    const count = state.count + 1;
    failures.set(state.key, {
      count,
      lockedUntil: count >= maxFailedAttempts ? now() + lockoutMs : 0
    });
  }

  function login({ adminId, password, ip }) {
    if (!credentials.configured) {
      return {
        ok: false,
        reason: "admin_not_configured",
        message: "관리자 계정이 설정되지 않았어요. 서버 환경변수를 확인해 주세요."
      };
    }

    const state = attemptState(ip);
    if (state.lockedUntil && state.lockedUntil > now()) {
      return {
        ok: false,
        reason: "locked_out",
        message: "로그인 시도가 너무 많아요. 10분 뒤에 다시 시도해 주세요."
      };
    }

    const idMatches = safeEqualHex(String(adminId || "").trim(), credentials.adminId);
    const passwordMatches = safeEqualHex(hashPassword(password || ""), credentials.passwordHash);

    if (!idMatches || !passwordMatches) {
      registerFailure(ip);
      return {
        ok: false,
        reason: "invalid_credentials",
        message: "아이디 또는 비밀번호가 올바르지 않아요."
      };
    }

    failures.delete(state.key);
    pruneSessions();

    const sessionToken = `mosan-admin-${randomUUID()}`;
    sessions.set(sessionToken, { adminId: credentials.adminId, issuedAt: now() });

    return {
      ok: true,
      adminId: credentials.adminId,
      sessionToken,
      message: "관리자 로그인 완료. 동화책을 만들어요."
    };
  }

  function verify(sessionToken) {
    pruneSessions();
    const record = sessions.get(String(sessionToken || ""));
    if (!record) {
      return {
        ok: false,
        reason: "invalid_session",
        message: "로그인이 만료되었어요. 다시 로그인해 주세요."
      };
    }

    return { ok: true, adminId: record.adminId, sessionToken };
  }

  function logout(sessionToken) {
    sessions.delete(String(sessionToken || ""));
    return { ok: true };
  }

  return {
    configured: credentials.configured,
    login,
    verify,
    logout
  };
}
