// 그림 스타일. 지시문은 서버(story-proxy/server.js의 artStylePrompts)에 있고, 앱은 id만 보낸다.
// 견본 그림: public/images/styles/{id}.jpg (운영 그림 모델로 한 번 만들어 넣은 것)
export type ArtStyleId = "anim3d" | "watercolor" | "colorpencil" | "clay" | "papercut" | "oil" | "crayon";

// label: 안내 문구용 전체 이름, short: 버튼에 쓰는 짧은 이름
export const artStyles: { id: ArtStyleId; label: string; short: string }[] = [
  { id: "anim3d", label: "3D 애니메이션", short: "3D" },
  { id: "watercolor", label: "수채화", short: "수채화" },
  { id: "colorpencil", label: "색연필 그림", short: "색연필" },
  { id: "clay", label: "클레이(점토)", short: "클레이" },
  { id: "papercut", label: "종이 오리기", short: "종이 오리기" },
  { id: "oil", label: "유화", short: "유화" },
  { id: "crayon", label: "따뜻한 크레파스", short: "크레파스" }
];

export const defaultArtStyle: ArtStyleId = "anim3d";
