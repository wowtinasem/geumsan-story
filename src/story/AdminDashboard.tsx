"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminGuide, type GuideSectionId } from "./AdminGuide";
import {
  decideRestart,
  readAdminSession,
  requestAdminStats,
  requestAiConnection,
  type AdminStats,
  type AiConnection,
  type RestartRequest
} from "./adminSession";

const REFRESH_MS = 5000;
const AI_CHECK_MS = 5 * 60 * 1000;

function Light({ ok, label, okText, badText }: { ok: boolean | null; label: string; okText: string; badText: string }) {
  const color = ok === null ? "bg-[#9FB4D0]" : ok ? "bg-[#5BE3A0]" : "bg-[#FF7A8A]";
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`h-3 w-3 rounded-full ${color}`} />
      <span className="text-[#9FDFF0]">{label}</span>
      <span className="font-black">{ok === null ? "확인 중" : ok ? okText : badText}</span>
    </span>
  );
}

function timeText(t: number) {
  return new Date(t).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" });
}

function dateTimeText(t: number) {
  return new Date(t).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" });
}

// 지금 상태를 한 단어로: 원활 / 붐빔 / 확인 필요
function overallState(stats: AdminStats) {
  const q = stats.imageQueue;
  const tried = stats.today.images + stats.today.imageFailed;
  const failRate = tried ? stats.today.imageFailed / tried : 0;
  if (tried >= 10 && failRate >= 0.1) {
    return { id: "check" as const, label: "확인 필요", detail: "오늘 그림 실패가 10% 이상이에요. Google AI Studio 사용량·결제를 확인하세요.", tone: "bg-[#5A1F2A] border-[#FF7A8A]" };
  }
  if (q.waiting >= 20 || q.startedLastMinute >= q.rpmLimit * 0.9) {
    return { id: "busy" as const, label: "붐빔", detail: "그림 순서를 기다리는 학생이 많아요. 학생들에게 화면을 그대로 두라고 안내하세요.", tone: "bg-[#5A4316] border-[#FFC857]" };
  }
  return { id: "ok" as const, label: "원활", detail: "그림이 바로바로 만들어지고 있어요.", tone: "bg-[#173F2E] border-[#5BE3A0]" };
}

function minutesAgo(t: number, now: number) {
  const minutes = Math.max(0, Math.floor((now - t) / 60000));
  return minutes === 0 ? "방금" : `${minutes}분 전`;
}

// 학생의 "다시 만들기" 요청: 학생이 손을 들면 학번을 확인하고 허락한다.
function RestartRequests({
  requests,
  now,
  busyId,
  onDecide,
  onHelp
}: {
  requests: RestartRequest[];
  now: number;
  busyId: string;
  onDecide: (id: string, approve: boolean) => void;
  onHelp: () => void;
}) {
  return (
    <section className={`mt-5 rounded-3xl border-2 p-5 ${requests.length ? "border-[#FFB15D] bg-[#4A2A12]" : "border-[#73DFFF]/25 bg-[#111A39]"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-black">
          다시 만들기 요청 {requests.length ? <span className="ml-1 rounded-full bg-[#F0633C] px-3 py-0.5 text-base">{requests.length}건</span> : null}
        </h2>
        <button type="button" onClick={onHelp} className="rounded-xl bg-white/15 px-4 py-2 text-sm font-black">
          어떻게 하나요?
        </button>
      </div>
      {requests.length ? (
        <ul className="mt-3 space-y-2">
          {requests.map((request) => (
            <li key={request.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#111A39] px-4 py-3">
              <div>
                <div className="text-lg font-black">
                  {request.school} {request.grade}학년 {request.number}번 {request.name}
                </div>
                <div className="text-sm text-[#C9E9F5]">
                  {minutesAgo(request.requestedAt, now)} 요청 · 지금까지 동화 {request.stories}편 · 그림 {request.images}장
                  {request.restarts ? ` · 다시 만들기 ${request.restarts}번 허락받음` : ""}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busyId === request.id}
                  onClick={() => onDecide(request.id, false)}
                  className="min-h-11 rounded-xl border border-[#73DFFF]/45 bg-[#101A38] px-4 font-black disabled:opacity-50"
                >
                  거절
                </button>
                <button
                  type="button"
                  disabled={busyId === request.id}
                  onClick={() => onDecide(request.id, true)}
                  className="min-h-11 rounded-xl border-2 border-[#5BE3A0] bg-[#1F6B47] px-5 font-black disabled:opacity-50"
                >
                  허락
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-[#9FB4D0]">지금 기다리는 요청이 없어요. 학생이 &ldquo;다시 만들기&rdquo;를 누르면 여기에 이름이 떠요.</p>
      )}
    </section>
  );
}

function Card({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-2xl border border-[#73DFFF]/30 bg-[#111A39] p-4">
      <div className="text-sm font-bold text-[#9FDFF0]">{label}</div>
      <div className="mt-1 text-4xl font-black text-white">{value}</div>
      {sub ? <div className="mt-1 text-xs text-[#9FB4D0]">{sub}</div> : null}
    </div>
  );
}

export function AdminDashboard() {
  const [token, setToken] = useState<string | null>(null);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [problem, setProblem] = useState("");
  const [checkedAt, setCheckedAt] = useState(0);
  const [guide, setGuide] = useState<GuideSectionId | null>(null);
  const [busyId, setBusyId] = useState("");
  // undefined: 아직 확인 전, null: 확인 실패
  const [ai, setAi] = useState<AiConnection | null | undefined>(undefined);
  const closeGuide = useCallback(() => setGuide(null), []);

  async function decide(id: string, approve: boolean) {
    if (!token) return;
    setBusyId(id);
    await decideRestart(token, id, approve);
    setBusyId("");
    // 결과는 다음 새로 고침에도 반영되지만, 목록에서는 바로 뺀다.
    setStats((current) => (current ? { ...current, restartRequests: (current.restartRequests || []).filter((request) => request.id !== id) } : current));
  }

  useEffect(() => {
    const session = readAdminSession();
    setToken(session?.role === "admin" ? session.sessionToken : "");
  }, []);

  // 글·그림 AI 연결 확인 (비용 없는 모델 목록 조회, 5분마다)
  useEffect(() => {
    if (!token) return;
    let stopped = false;
    async function check() {
      const result = await requestAiConnection(token as string);
      if (!stopped) setAi(result);
    }
    void check();
    const timer = window.setInterval(check, AI_CHECK_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let stopped = false;
    async function load() {
      const result = await requestAdminStats(token as string);
      if (stopped) return;
      setCheckedAt(Date.now());
      if (result === "unauthorized") {
        setProblem("관리자 로그인이 풀렸어요. 동화 만들기 화면에서 관리자로 다시 들어와 주세요.");
        setStats(null);
      } else if (!result) {
        setProblem("서버에 연결하지 못했어요. 잠시 뒤 자동으로 다시 확인해요.");
      } else {
        setProblem("");
        setStats(result);
      }
    }
    void load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [token]);

  if (token === "") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#080D1F] p-6 text-white">
        <div className="max-w-md rounded-3xl border border-[#73DFFF]/40 bg-[#111A39] p-8 text-center">
          <h1 className="text-2xl font-black">관리자 현황판</h1>
          <p className="mt-3 text-[#C9E9F5]">관리자로 로그인해야 볼 수 있어요.</p>
          <a href="/story" className="mt-6 inline-block rounded-2xl bg-[#F0633C] px-6 py-3 font-black">동화 만들기 화면으로</a>
        </div>
      </main>
    );
  }

  const state = stats ? overallState(stats) : null;
  const q = stats?.imageQueue;
  const problemSection: GuideSectionId = problem.startsWith("관리자 로그인") ? "relogin" : "offline";

  return (
    <main className="min-h-screen bg-[#080D1F] px-4 py-6 text-white sm:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black sm:text-3xl">관리자 현황판</h1>
            <p className="text-sm text-[#9FB4D0]">
              5초마다 자동으로 새로 고쳐요{checkedAt ? ` · 마지막 확인 ${timeText(checkedAt)}` : ""}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setGuide("read")}
              className="rounded-2xl border-2 border-[#FFB15D] bg-[#F0633C] px-5 py-2 text-sm font-black text-white"
            >
              가이드
            </button>
            <a href="/story" className="rounded-2xl border border-[#73DFFF]/45 bg-[#101A38] px-4 py-2 text-sm font-black">
              동화 만들기 화면으로
            </a>
          </div>
        </header>

        {problem ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#FF7A8A] bg-[#5A1F2A] p-4 font-bold">
            <span>{problem}</span>
            <button type="button" onClick={() => setGuide(problemSection)} className="rounded-xl bg-white/15 px-4 py-2 text-sm font-black">
              이럴 땐 어떻게 하나요?
            </button>
          </div>
        ) : null}

        {stats && state && q ? (
          <>
            <RestartRequests
              requests={stats.restartRequests || []}
              now={stats.now}
              busyId={busyId}
              onDecide={decide}
              onHelp={() => setGuide("restartRequest")}
            />

            <section className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border border-[#73DFFF]/30 bg-[#111A39] px-5 py-3 text-sm">
              <Light ok={!problem} label="서버" okText="켜져 있음" badText="연결 안 됨" />
              <Light ok={ai === undefined ? null : Boolean(ai?.text)} label="글 AI" okText="연결됨" badText="확인 필요" />
              <Light ok={ai === undefined ? null : Boolean(ai?.image)} label="그림 AI" okText="연결됨" badText="확인 필요" />
              <span className="text-xs text-[#9FB4D0]">서버는 항상 켜져 있어요. 따로 깨울 필요가 없어요.</span>
            </section>

            <section className={`mt-4 rounded-3xl border-2 p-5 ${state.tone}`}>
              <div className="text-sm font-bold opacity-80">지금 상태</div>
              <div className="text-4xl font-black">{state.label}</div>
              <div className="mt-1 font-bold">{state.detail}</div>
              <button type="button" onClick={() => setGuide(state.id)} className="mt-3 rounded-xl bg-white/15 px-4 py-2 text-sm font-black">
                이럴 땐 어떻게 하나요?
              </button>
              {stats.mock ? <div className="mt-2 text-sm font-bold text-[#FFC857]">시험 모드(가짜 그림)로 켜져 있어요.</div> : null}
            </section>

            <h2 className="mt-7 text-lg font-black text-[#FFB15D]">그림 대기 줄 (지금)</h2>
            <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Card label="지금 그리는 중" value={q.active} sub={`한 번에 최대 ${q.maxConcurrent}장`} />
              <Card label="순서 기다리는 그림" value={q.waiting} />
              <Card label="최근 1분 시작" value={`${q.startedLastMinute}/${q.rpmLimit}`} sub="분당 한도" />
              <Card label="그림 1장 평균" value={`${q.avgSeconds}초`} sub="서버가 켜진 뒤 기준" />
            </div>

            <h2 className="mt-7 text-lg font-black text-[#FFB15D]">오늘 ({stats.today.date}) 만든 수</h2>
            <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Card label="입장한 학생" value={`${stats.today.students}명`} />
              <Card label="동화 글" value={`${stats.today.stories}편`} sub={`실패 ${stats.today.storyFailed}번`} />
              <Card label="그림" value={`${stats.today.images}장`} sub={`실패 ${stats.today.imageFailed}번 · 기다림 안내 ${stats.today.imageBusy}번`} />
            </div>

            <h2 className="mt-7 text-lg font-black text-[#FFB15D]">학교별 (오늘)</h2>
            {stats.schools.length ? (
              <div className="mt-2 overflow-x-auto rounded-2xl border border-[#73DFFF]/30">
                <table className="w-full min-w-[420px] text-left">
                  <thead className="bg-[#111A39] text-sm text-[#9FDFF0]">
                    <tr>
                      <th className="px-4 py-2">학교</th>
                      <th className="px-4 py-2 text-right">학생</th>
                      <th className="px-4 py-2 text-right">동화</th>
                      <th className="px-4 py-2 text-right">그림</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.schools.map((row) => (
                      <tr key={row.school} className="border-t border-[#73DFFF]/15">
                        <td className="px-4 py-2 font-bold">{row.school}</td>
                        <td className="px-4 py-2 text-right">{row.students}</td>
                        <td className="px-4 py-2 text-right">{row.stories}</td>
                        <td className="px-4 py-2 text-right">{row.images}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-2 text-[#9FB4D0]">오늘은 아직 입장한 학생이 없어요.</p>
            )}

            <p className="mt-6 text-xs leading-relaxed text-[#9FB4D0]">
              서버가 켜진 시각: {dateTimeText(stats.serverStartedAt)}. 숫자는 서버 메모리에 있어서 배포·재시작하면 0부터 다시 셉니다(학생 로그인은 유지돼요).
              학생 한 명당 동화 {stats.limits.storiesPerStudent}편·그림 {stats.limits.imagesPerStudent}장까지 만들 수 있어요.
            </p>
          </>
        ) : !problem ? (
          <p className="mt-6 text-[#9FB4D0]">불러오는 중…</p>
        ) : null}
      </div>
      {guide ? <AdminGuide focus={guide} onClose={closeGuide} /> : null}
    </main>
  );
}
