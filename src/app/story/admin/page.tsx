import type { Metadata } from "next";
import { AdminDashboard } from "@/story/AdminDashboard";

export const metadata: Metadata = {
  title: "관리자 현황판",
  robots: { index: false, follow: false }
};

export default function AdminPage() {
  return <AdminDashboard />;
}
