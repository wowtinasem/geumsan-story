import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// 접근 방식 두 가지.
// 1) 학생: 학교명·학년·번호·이름을 적으면 서버가 학생 세션 토큰을 발급한다(비밀번호 없음).
// 2) 관리자: 비밀번호로 입장한다. 자격증명은 코드에 두지 않는다.
//    관리자 환경변수가 없으면 관리자 로그인과 학생 입장이 모두 막힌다(fail-closed).
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

// 학생이 적은 값을 정리·검증한다. 올바르지 않으면 null.
export function normalizeStudentInfo(input = {}) {
  const clean = (value, max) =>
    String(value ?? "")
      .replace(/[^\u3131-\u318e\uac00-\ud7a3a-zA-Z0-9 ]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max);
  const school = clean(input.school, 20);
  const name = clean(input.name, 10);
  const grade = Number(String(input.grade ?? "").trim());
  const number = Number(String(input.number ?? "").trim());

  if (!school || !name) return null;
  if (!Number.isInteger(grade) || grade < 1 || grade > 6) return null;
  if (!Number.isInteger(number) || number < 1 || number > 99) return null;
  return { school, grade, number, name };
}

// 세션 토큰은 서버 서명이 붙은 자체 증명 토큰이다: geumsan-{역할}-{내용}.{서명}
// 서버가 다시 켜져도(배포·재시작) 같은 SESSION_SECRET이면 학생 로그인이 그대로 유지된다.
// SESSION_SECRET이 없으면 실행할 때마다 새 비밀값을 만든다(재시작하면 다시 로그인).
function base64url(buffer) {
  return Buffer.from(buffer).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(text) {
  return Buffer.from(String(text).replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export function createAdminAccessStore({
  credentials = readAdminCredentials(),
  now = () => Date.now(),
  secret = process.env.SESSION_SECRET || randomBytes(32).toString("hex")
} = {}) {
  const failures = new Map();
  const revoked = new Map(); // 로그아웃한 토큰 → 만료 시각

  function sign(body) {
    return base64url(createHmac("sha256", String(secret)).update(body).digest());
  }

  function issueToken(role, data) {
    const payload = base64url(JSON.stringify({ ...data, iat: now() }));
    const body = `geumsan-${role}-${payload}`;
    return `${body}.${sign(body)}`;
  }

  function pruneRevoked() {
    const t = now();
    for (const [token, expiresAt] of revoked) {
      if (expiresAt <= t) revoked.delete(token);
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

    // 관리자 화면은 비밀번호만 받는다. 아이디가 비어 오면 설정된 관리자 아이디로 본다.
    const requestedId = String(adminId || "").trim() || credentials.adminId;
    const idMatches = safeEqualHex(requestedId, credentials.adminId);
    const passwordMatches = safeEqualHex(hashPassword(password || ""), credentials.passwordHash);

    if (!idMatches || !passwordMatches) {
      registerFailure(ip);
      return {
        ok: false,
        reason: "invalid_credentials",
        message: "관리자 비밀번호가 올바르지 않아요."
      };
    }

    failures.delete(state.key);
    const sessionToken = issueToken("admin", { a: credentials.adminId });

    return {
      ok: true,
      role: "admin",
      adminId: credentials.adminId,
      sessionToken,
      message: "관리자 로그인 완료. 동화책을 만들어요."
    };
  }

  function studentLogin(input) {
    if (!credentials.configured) {
      return {
        ok: false,
        reason: "admin_not_configured",
        message: "수업 서버가 아직 준비되지 않았어요. 선생님께 알려 주세요."
      };
    }

    const student = normalizeStudentInfo(input);
    if (!student) {
      return {
        ok: false,
        reason: "invalid_student",
        message: "학교명, 학년(1~6), 번호(1~99), 이름을 모두 바르게 적어 주세요."
      };
    }

    const sessionToken = issueToken("student", { s: student });

    return {
      ok: true,
      role: "student",
      student,
      sessionToken,
      message: `${student.name} 학생, 환영해요! 동화책을 만들어요.`
    };
  }

  function invalid() {
    return {
      ok: false,
      reason: "invalid_session",
      message: "로그인이 만료되었어요. 다시 로그인해 주세요."
    };
  }

  function verify(sessionToken) {
    const token = String(sessionToken || "");
    const match = /^geumsan-(admin|student)-([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(token);
    if (!match) return invalid();

    const [, role, payload, signature] = match;
    const expected = sign(`geumsan-${role}-${payload}`);
    const given = Buffer.from(signature);
    const wanted = Buffer.from(expected);
    if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return invalid();

    let data;
    try {
      data = JSON.parse(fromBase64url(payload).toString("utf8"));
    } catch {
      return invalid();
    }
    const issuedAt = Number(data?.iat);
    if (!Number.isFinite(issuedAt) || issuedAt + sessionTtlMs <= now()) return invalid();

    pruneRevoked();
    if (revoked.has(token)) return invalid();

    if (role === "admin") {
      // 관리자 아이디가 바뀌면 예전 관리자 토큰은 쓸 수 없다.
      if (!credentials.configured || data.a !== credentials.adminId) return invalid();
      return { ok: true, role, adminId: data.a, sessionToken: token };
    }

    const student = normalizeStudentInfo(data.s);
    if (!student) return invalid();
    return { ok: true, role, student, sessionToken: token };
  }

  function logout(sessionToken) {
    const token = String(sessionToken || "");
    if (verify(token).ok) revoked.set(token, now() + sessionTtlMs);
    return { ok: true };
  }

  return {
    configured: credentials.configured,
    login,
    studentLogin,
    verify,
    logout
  };
}
