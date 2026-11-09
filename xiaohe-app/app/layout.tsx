import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "小禾学伴 · 每一步，都算数",
  description: "把今天要学的，变成刚好适合的练习。拍照核对、题库组卷与有依据的学习记录。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
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
