import type { Metadata } from "next";
import { Inter, Noto_Sans_TC, Noto_Serif_TC } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-latin",
  subsets: ["latin"],
});

const notoSans = Noto_Sans_TC({
  variable: "--font-cjk",
  weight: ["400", "500", "700"],
  preload: false,
  display: "swap",
});

const notoSerif = Noto_Serif_TC({
  variable: "--font-display",
  weight: ["500", "700"],
  preload: false,
  display: "swap",
});

export const metadata: Metadata = {
  title: "工作學習筆記",
  description: "大類、中類、小分類三層架構的工作學習筆記，支援圖文筆記與資料庫儲存。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-Hant-TW" className={`${inter.variable} ${notoSans.variable} ${notoSerif.variable}`}>
      <body>{children}</body>
    </html>
  );
}
