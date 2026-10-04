
const B = "https://geumsan-story-proxy.onrender.com";
const post = async (p, b) => { const t = Date.now(); const r = await fetch(B + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }); const d = await r.json().catch(() => ({})); return { s: r.status, d, sec: ((Date.now() - t) / 1000).toFixed(1) }; };
const sel = { character: { id: "gaya", name: "하늘", gender: "girl", age: "kid", heroLabel: "여자 어린이, 어린이(8~10살) 소녀", ageDesc: "a child around 8-10 years old", hair: "black hair", features: [] }, trait: { id: "brave", label: "용감한" }, place: { id: "jeokbyeok", name: "적벽강", sceneKey: "jeokbyeok" }, events: { opening: { id: "a", label: "신비한 지도를 발견했어요" }, development: { id: "b", label: "친구와 함께 길을 떠났어요" }, climax: { id: "c", label: "길을 잃었어요" }, ending: { id: "d", label: "무사히 집으로 돌아왔어요" } } };
const login = await post("/api/student-login", { school: "배포점검초", grade: "5", number: "1", name: "점검" });
console.log("login", login.s, login.d.sessionToken ? login.d.sessionToken.slice(0, 22) : "");
const tok = login.d.sessionToken;

const story = await post("/api/story", { sessionToken: tok, selection: sel, grade: "all" });
console.log("story", story.s, story.sec + "s", story.d.provider, (story.d.scenes || [])[0]);
for (let i = 0; i < 2; i++) {
  const img = await post("/api/image", { sessionToken: tok, selection: sel, scene: (story.d.scenes || [])[i] || "장면", pageIndex: i, mode: "print" });
  console.log("image", i + 1, img.s, img.sec + "s", img.d.model || img.d.error, img.d.imageBase64 ? Math.round(img.d.imageBase64.length * 0.75 / 1024) + "KB" : "");
}
const h = await (await fetch(B + "/api/health")).json();
console.log("queue", JSON.stringify(h.imageQueue));
