import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  description: "双条件 AI 对话研究及管理后台。",
  title: "AI 对话研究",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
