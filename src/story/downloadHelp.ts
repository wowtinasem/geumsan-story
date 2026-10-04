// PDF를 받은 뒤 "폴더 열기" 안내. 웹 페이지는 보안 때문에 기기의 폴더를 직접 열 수 없어서,
// 지금 쓰는 기기에 맞춰 다운로드 폴더 찾는 순서를 보여 준다.

// 수업용 패들렛 주소. 바꾸려면 이 값만 고치고 배포한다.
export const padletUrl = "https://padlet.com/dream4325/_-s0246akz2pa3rps68ms5";

export type DeviceKind = "ipad" | "iphone" | "android" | "chromebook" | "windows" | "mac" | "other";

export function detectDevice(): DeviceKind {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ipad";
  if (/iPhone|iPod/.test(ua)) return "iphone";
  if (/Android/.test(ua)) return "android";
  if (/CrOS/.test(ua)) return "chromebook";
  if (/Windows/.test(ua)) return "windows";
  if (/Macintosh/.test(ua)) return "mac";
  return "other";
}

export const deviceNames: Record<DeviceKind, string> = {
  ipad: "아이패드",
  iphone: "아이폰",
  android: "안드로이드 태블릿",
  chromebook: "크롬북",
  windows: "노트북(윈도우)",
  mac: "맥북",
  other: "이 기기"
};

export function folderSteps(device: DeviceKind): string[] {
  switch (device) {
    case "ipad":
    case "iphone":
      return [
        "홈 화면에서 파란 폴더 모양의 \"파일\" 앱을 열어요.",
        "아래(또는 왼쪽)의 \"둘러보기\" → \"나의 iPad\"(또는 \"iCloud Drive\") → \"다운로드\" 폴더를 눌러요.",
        "아래 파일 이름을 찾아요. Safari 주소창 옆 ⬇ 단추를 눌러도 방금 받은 파일이 보여요."
      ];
    case "android":
      return [
        "화면 맨 위를 아래로 쓸어내려 \"다운로드 완료\" 알림을 누르면 바로 열려요.",
        "알림이 없으면 \"내 파일\"(또는 \"Files\") 앱 → \"다운로드\" 폴더를 열어요.",
        "아래 파일 이름을 찾아요."
      ];
    case "chromebook":
      return [
        "키보드에서 Ctrl + J 를 누르면 다운로드 목록이 열려요.",
        "또는 화면 왼쪽 아래 런처 → \"파일\" 앱 → \"다운로드\" 폴더를 열어요.",
        "아래 파일 이름을 찾아요."
      ];
    case "windows":
      return [
        "키보드에서 Ctrl + J 를 누르면 다운로드 목록이 열려요.",
        "파일 옆의 폴더 모양(\"폴더에 표시\")을 누르면 파일이 있는 폴더가 열려요.",
        "또는 파일 탐색기 → 왼쪽 \"다운로드\" 폴더에서 아래 파일 이름을 찾아요."
      ];
    case "mac":
      return [
        "화면 아래 Dock의 \"다운로드\" 폴더를 누르거나 Finder → \"다운로드\"를 열어요.",
        "아래 파일 이름을 찾아요."
      ];
    default:
      return ["기기의 \"다운로드\" 폴더를 열고 아래 파일 이름을 찾아요."];
  }
}

export const padletUploadSteps = [
  "\"패들렛 바로가기\"를 눌러요.",
  "패들렛 화면의 + 단추 → \"업로드\"(또는 클립 모양)를 눌러요.",
  "\"다운로드\" 폴더에서 내 PDF 파일을 골라 올려요."
];
