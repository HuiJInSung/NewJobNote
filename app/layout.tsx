import type { Metadata } from "next";
// All text uses jf open 粉圓 2.1 — loaded by @font-face in globals.css (public/fonts/jf-openhuninn-2.1.ttf, SIL OFL)
import "./globals.css";

export const metadata: Metadata = {
  title: "工作學習筆記",
  description: "大類、中類、小分類三層架構的工作學習筆記，支援圖文筆記與資料庫儲存。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-Hant-TW">
      <body>{children}</body>
    </html>
  );
}
