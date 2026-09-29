import { ImageResponse } from "next/og";

export const runtime = "edge";

export const alt = "모산초등학교 AI동화 수업 - AI와 함께 나만의 동화책 만들기";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// ImageResponse(satori)는 한글 글리프 폰트가 없으면 네모로 깨지므로,
// 필요한 글자만 담은 Noto Sans KR 서브셋 폰트를 받아서 사용한다.
async function loadKoreanFont(text: string): Promise<ArrayBuffer | null> {
  try {
    const cssUrl = `https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@900&text=${encodeURIComponent(text)}`;
    const css = await (await fetch(cssUrl, { headers: { "User-Agent": "Mozilla/5.0" } })).text();
    const fontUrl = css.match(/src:\s*url\((https:\/\/[^)]+)\)/)?.[1];
    if (!fontUrl) return null;
    return await (await fetch(fontUrl)).arrayBuffer();
  } catch {
    return null;
  }
}

export default async function OpengraphImage() {
  const title = "AI와 함께 나만의 동화책 만들기";
  const heading = "모산초등학교 AI동화 수업";
  const sub = "초등 3~4 · 5~6학년 · 주인공을 골라 6쪽 동화책을 완성해요";
  const fontData = await loadKoreanFont(`${title}${heading}${sub}0123456789·`);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "64px",
          textAlign: "center",
          backgroundImage:
            "radial-gradient(circle at 18% 12%, rgba(255,126,72,0.35), transparent 40%), radial-gradient(circle at 82% 12%, rgba(45,107,255,0.40), transparent 38%), linear-gradient(135deg, #101a38 0%, #1a244c 100%)",
          color: "#ffffff"
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 34,
            fontWeight: 900,
            color: "#FFD073",
            letterSpacing: 2,
            marginBottom: 26
          }}
        >
          {heading}
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 78,
            fontWeight: 900,
            lineHeight: 1.15,
            textShadow: "0 0 30px rgba(125,232,255,0.35)"
          }}
        >
          {title}
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 34,
            fontSize: 30,
            fontWeight: 900,
            color: "#DDF7FF",
            maxWidth: 900
          }}
        >
          {sub}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: fontData
        ? [{ name: "Noto Sans KR", data: fontData, weight: 900, style: "normal" }]
        : []
    }
  );
}
