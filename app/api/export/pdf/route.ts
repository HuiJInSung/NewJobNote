import { existsSync } from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { handle, jsonError } from "@/lib/http";
import { PDF_CSS } from "@/lib/export/pdfStyles";

/** Edge / Chrome already on this machine (or CHROME_PATH) — used headless to print the PDF. */
function findBrowser(): string | null {
  const env = process.env.CHROME_PATH;
  if (env && existsSync(env)) return env;
  const pf = process.env["ProgramFiles"] ?? "C:\\Program Files";
  const pf86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const local = process.env.LOCALAPPDATA ?? "";
  const candidates =
    process.platform === "win32"
      ? [
          path.join(pf86, "Microsoft\\Edge\\Application\\msedge.exe"),
          path.join(pf, "Microsoft\\Edge\\Application\\msedge.exe"),
          path.join(pf, "Google\\Chrome\\Application\\chrome.exe"),
          path.join(pf86, "Google\\Chrome\\Application\\chrome.exe"),
          path.join(local, "Google\\Chrome\\Application\\chrome.exe"),
        ]
      : process.platform === "darwin"
        ? [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
          ]
        : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge"];
  return candidates.find((p) => existsSync(p)) ?? null;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * POST { title, body } → A4 PDF.
 * `body` is note markup built (and sanitized) by the client. It is printed with JavaScript disabled, and the page
 * may only load this app's fonts and images (plus https images) — nothing else.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const input = await request.json().catch(() => null);
    const body = typeof input?.body === "string" ? input.body : null;
    const title = typeof input?.title === "string" ? input.title.slice(0, 200) : "工作學習筆記";
    if (!body) return jsonError("缺少內容");
    if (body.length > 20_000_000) return jsonError("內容過大，請改為匯出單一大類");

    const executablePath = findBrowser();
    if (!executablePath) {
      return jsonError("找不到 Edge 或 Chrome，無法產生 PDF。請安裝其一，或在 .env.local 設定 CHROME_PATH。", 500);
    }

    const origin = new URL(request.url).origin;
    const html =
      `<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><base href="${origin}/">` +
      `<title>${esc(title)}</title><style>${PDF_CSS}</style></head><body>${body}</body></html>`;

    const browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-first-run", "--disable-extensions"] });
    try {
      const page = await browser.newPage();
      await page.setJavaScriptEnabled(false);
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        const url = req.url();
        const ok =
          url.startsWith("data:") ||
          url.startsWith(`${origin}/fonts/`) ||
          url.startsWith(`${origin}/api/images/`) ||
          (req.resourceType() === "image" && url.startsWith("https://"));
        if (ok) void req.continue();
        else void req.abort();
      });
      await page.setContent(html, { waitUntil: "load", timeout: 120_000 });
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 120_000 }).catch(() => {});
      const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
        preferCSSPageSize: true,
        outline: true,
        tagged: true,
        displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate:
          // header/footer templates can't load web fonts; this uses the installed 粉圓 font (falls back to sans-serif)
          `<div style="width:100%;text-align:center;font-family:'jf open 粉圓 2.1','jf-openhuninn-2.1',sans-serif;` +
          `font-size:10pt;color:#9b9da4;-webkit-print-color-adjust:exact;">` +
          `第 <span class="pageNumber"></span> 頁，共 <span class="totalPages"></span> 頁</div>`,
        timeout: 120_000,
      });
      return new Response(new Uint8Array(pdf), {
        headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store" },
      });
    } finally {
      await browser.close();
    }
  });
}
