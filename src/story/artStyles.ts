// 그림 스타일. 지시문은 서버(story-proxy/server.js의 artStylePrompts)에 있고, 앱은 id만 보낸다.
// 견본 그림: public/images/styles/{id}.jpg (운영 그림 모델로 한 번 만들어 넣은 것)
export type ArtStyleId = "anim3d" | "watercolor" | "colorpencil" | "clay" | "papercut" | "oil" | "crayon";

export const artStyles: { id: ArtStyleId; label: string }[] = [
  { id: "anim3d", label: "3D 애니메이션" },
  { id: "watercolor", label: "수채화" },
  { id: "colorpencil", label: "색연필 그림" },
  { id: "clay", label: "클레이(점토)" },
  { id: "papercut", label: "종이 오리기" },
  { id: "oil", label: "유화" },
  { id: "crayon", label: "따뜻한 크레파스" }
];

export const defaultArtStyle: ArtStyleId = "anim3d";
