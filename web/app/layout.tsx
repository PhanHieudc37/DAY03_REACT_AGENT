import type { Metadata } from "next";
import { Be_Vietnam_Pro, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geist = Be_Vietnam_Pro({ variable: "--font-sans", subsets: ["vietnamese"], weight: ["400","500","600","700","800"] });
const mono = Geist_Mono({ variable: "--font-mono", subsets: ["latin", "latin-ext"] });

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") || "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/hero-pixel.png`;
  return {
    title: "RecruitFlow — Trợ lý tuyển dụng ReAct",
    description: "Chấm điểm CV, xếp hạng và sắp lịch phỏng vấn qua ReAct Agent minh bạch.",
    openGraph: { title: "RecruitFlow", description: "AI tuyển dụng có kiểm soát", images: [{ url: image, width: 1536, height: 1024 }] },
    twitter: { card: "summary_large_image", title: "RecruitFlow", description: "AI tuyển dụng có kiểm soát", images: [image] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="vi"><body className={`${geist.variable} ${mono.variable}`}>{children}</body></html>;
}
