import axios, { type AxiosInstance } from "axios";
import { chromium, type Browser, type Page } from "playwright";

const BASE_URL = "https://www.thetrainline.com";

const USER_AGENT =
  process.env.TRAINLINE_USER_AGENT ??
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export const LOCALE = process.env.TRAINLINE_LOCALE ?? "en-GB";

// Plain axios client — used only for unprotected endpoints (station search)
export const client: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  headers: {
    Accept: "application/json",
    "Accept-Encoding": "gzip, deflate, br",
    "Accept-Language": LOCALE,
    "User-Agent": USER_AGENT,
  },
  timeout: 30_000,
});

// --- Persistent Playwright browser for protected endpoints ---

let browser: Browser | null = null;
let page: Page | null = null;
let initPromise: Promise<void> | null = null;

async function ensureBrowser(): Promise<Page> {
  if (page) return page;

  if (!initPromise) {
    initPromise = (async () => {
      process.stderr.write("[trainline] Launching browser…\n");
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        userAgent: USER_AGENT,
        locale: LOCALE,
        extraHTTPHeaders: { "Accept-Language": LOCALE },
      });
      page = await context.newPage();
      await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 60_000 });
      await page.waitForTimeout(2_000);
      process.stderr.write("[trainline] Browser session ready\n");
    })();
  }

  await initPromise;
  return page!;
}

/**
 * Make a POST request from within the browser context so that Trainline's
 * bot-detection sees a genuine browser fingerprint, cookies, and TLS stack.
 */
export async function browserPost<T>(path: string, body: unknown): Promise<T> {
  const p = await ensureBrowser();

  const result = await p.evaluate(
    async ({
      url,
      payload,
      locale,
    }: {
      url: string;
      payload: unknown;
      locale: string;
    }) => {
      const res = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Accept-Language": locale,
          "x-version": "4.0",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      return res.json() as unknown;
    },
    { url: `${BASE_URL}${path}`, payload: body, locale: LOCALE }
  );

  return result as T;
}
