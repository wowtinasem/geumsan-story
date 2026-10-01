import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://geumsan-story.vercel.app"),
  title: {
    default: "금산 AI 동화 만들기",
    template: "%s | 금산 AI 동화 만들기"
  },
  description: "금산교육지원청이 관내 초등학교로 찾아가는 AI 동화책 만들기 수업 앱입니다. 초등 3~6학년 학생이 주인공·배경·사건을 골라 6쪽 동화책을 만듭니다.",
  keywords: ["금산교육지원청", "금산", "찾아가는 수업", "AI 동화", "동화 만들기", "초등학교"],
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/images/ginseng-mascot.png",
    apple: "/images/ginseng-mascot.png"
  },
  appleWebApp: {
    capable: true,
    title: "금산 AI 동화"
  },
  other: {
    "mobile-web-app-capable": "yes"
  },
  openGraph: {
    title: "금산교육지원청 찾아가는 AI동화 수업",
    description: "AI와 함께 나만의 6쪽 동화책을 만드는 수업 앱입니다.",
    siteName: "금산 AI 동화 만들기",
    type: "website",
    locale: "ko_KR"
  },
  twitter: {
    card: "summary_large_image",
    title: "금산교육지원청 찾아가는 AI동화 수업",
    description: "AI와 함께 나만의 6쪽 동화책을 만드는 수업 앱입니다."
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
