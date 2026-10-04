// 가상 학생 N명이 동시에 동화(글 1번 + 그림 6장)를 만드는 부하 시험.
// 브라우저와 같은 방식으로 "잠시 뒤 다시(image_busy)"면 기다렸다가 다시 줄을 선다.
const BASE = process.env.BASE || "http://localhost:3002";
const N = Number(process.env.N || 60);
const SPREAD_MS = Number(process.env.SPREAD_MS || 20000); // 학생들이 버튼을 누르는 시간 차이

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = async (path, body, timeoutMs = 95000) => {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  try {
    const r = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: c.signal });
    const data = await r.json().catch(() => ({}));
    return { status: r.status, data };
  } catch (e) {
    return { status: 0, data: { error: "network_error", message: String(e) } };
  } finally {
    clearTimeout(t);
  }
};

const selection = (name) => ({
  character: { id: "gaya", name, gender: "girl", age: "kid" },
  trait: { id: "brave", label: "용감한" },
  place: { id: "insam", name: "금산 인삼마을", sceneKey: "insam" },
  events: { opening: { id: "a", label: "a" }, development: { id: "b", label: "b" }, climax: { id: "c", label: "c" }, ending: { id: "d", label: "d" } }
});

const results = [];
let peakWaiting = 0;

async function student(i) {
  await sleep(Math.random() * SPREAD_MS);
  const t0 = Date.now();
  const r = { i, ok: false, images: 0, busy: 0, errors: 0, story: 0, totalSec: 0, longestImageSec: 0 };
  const login = await post("/api/student-login", { school: i < 39 ? "금산중앙초" : "금산초", grade: "5", number: String((i % 30) + 1), name: `학생${i}` });
  if (!login.data.sessionToken) { r.err = "login " + login.status; results.push(r); return; }
  const token = login.data.sessionToken;
  const story = await post("/api/story", { sessionToken: token, selection: selection(`학생${i}`), grade: "all" }, 75000);
  r.story = story.status;
  if (story.status !== 200) { r.err = "story " + story.status + " " + (story.data.error || ""); results.push(r); return; }

  for (let page = 0; page < 6; page++) {
    const pt = Date.now();
    let busyTries = 0, errTries = 0;
    while (true) {
      const img = await post("/api/image", { sessionToken: token, selection: selection(`학생${i}`), scene: `장면 ${page}`, pageIndex: page, mode: "print" });
      if (img.status === 200 && img.data.imageBase64) { r.images++; break; }
      if (img.data.error === "image_busy" && busyTries < 12) {
        busyTries++; r.busy++;
        peakWaiting = Math.max(peakWaiting, img.data.waiting || 0);
        await sleep(Math.max(2, img.data.retryAfterSeconds || 3) * 1000);
        continue;
      }
      if ((img.data.error === "network_error" || img.data.error === "image_provider_failed") && errTries < 2) {
        errTries++; r.errors++; await sleep(4000 * errTries); continue;
      }
      r.err = `image ${img.status} ${img.data.error || ""}`;
      break;
    }
    r.longestImageSec = Math.max(r.longestImageSec, (Date.now() - pt) / 1000);
    if (r.err) break;
  }
  r.totalSec = (Date.now() - t0) / 1000;
  r.ok = r.images === 6;
  results.push(r);
}

let monitor = true;
(async () => {
  while (monitor) {
    try {
      const h = await (await fetch(BASE + "/api/health")).json();
      const q = h.imageQueue;
      console.log(`[${new Date().toISOString().slice(11, 19)}] active=${q.active} waiting=${q.waiting} lastMin=${q.startedLastMinute}/${q.rpmLimit} done=${q.done} busyReturned=${q.busyReturned}`);
      peakWaiting = Math.max(peakWaiting, q.waiting);
    } catch {}
    await sleep(15000);
  }
})();

const start = Date.now();
await Promise.all(Array.from({ length: N }, (_, i) => student(i)));
monitor = false;

const ok = results.filter((r) => r.ok);
const fail = results.filter((r) => !r.ok);
const totals = ok.map((r) => r.totalSec).sort((a, b) => a - b);
const pct = (p) => totals.length ? totals[Math.min(totals.length - 1, Math.floor(p * totals.length))].toFixed(0) : "-";
console.log("\n===== 결과 =====");
console.log(`학생 ${N}명, 전체 걸린 시간 ${((Date.now() - start) / 1000).toFixed(0)}초`);
console.log(`성공 ${ok.length}명 / 실패 ${fail.length}명`);
console.log(`학생 한 명이 글+그림 6장 완성까지: 중간 ${pct(0.5)}초, 90% ${pct(0.9)}초, 가장 늦은 ${pct(0.999)}초`);
console.log(`그림 1장 최대 대기 ${Math.max(...results.map((r) => r.longestImageSec)).toFixed(0)}초, '잠시 뒤 다시' 응답 합계 ${results.reduce((a, r) => a + r.busy, 0)}번, 최대 대기 줄 ${peakWaiting}`);
if (fail.length) console.log("실패:", fail.slice(0, 10).map((r) => `${r.i}:${r.err}`).join(", "));
process.exit(0);
