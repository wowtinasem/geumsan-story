import type { Metadata } from "next";
import { StoryClient } from "./StoryClient";

export const metadata: Metadata = {
  title: "AI와 함께 만드는 동화",
  description: "금산교육지원청 찾아가는 수업 · 초등 3~6학년 AI 동화책 만들기"
};

export default function StoryPage() {
  return <StoryClient />;
}
