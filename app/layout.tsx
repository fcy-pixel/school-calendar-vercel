import type { Metadata } from "next";
import "./globals.css";
import AuthGate from "./AuthGate";

export const metadata: Metadata = {
  title: "中華基督教會基慈小學 — 智慧校曆",
  description: "學校智慧校曆",
  icons: { icon: "/logo.png" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}
