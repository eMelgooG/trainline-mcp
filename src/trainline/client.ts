import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from "axios";
import { chromium } from "playwright";

const BASE_URL = "https://www.thetrainline.com";

const USER_AGENT =
  process.env.TRAINLINE_USER_AGENT ??
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export const LOCALE = process.env.TRAINLINE_LOCALE ?? "en-GB";

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

// --- Playwright session management ---

let sessionCookies: string | null = null;
let sessionInitialising = false;
let sessionInitQueue: Array<() => void> = [];

async function initSession(): Promise<void> {
  if (sessionCookies) return;
  if (sessionInitialising) {
    await new Promise<void>((resolve) => sessionInitQueue.push(resolve));
    return;
  }
  sessionInitialising = true;

  process.stderr.write("[trainline] Launching browser to establish session…\n");

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ userAgent: USER_AGENT });
    const page = await context.newPage();

    await page.goto("https://www.thetrainline.com", {
      waitUntil: "networkidle",
      timeout: 60_000,
    });

    // Wait a moment to allow any JS-set cookies to be written
    await page.waitForTimeout(2_000);

    const cookies = await context.cookies();
    const cookieHeader = cookies
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");

    sessionCookies = cookieHeader;
    process.stderr.write(`[trainline] Session established (${cookies.length} cookies)\n`);
  } finally {
    await browser.close();
    sessionInitialising = false;
    const queue = sessionInitQueue;
    sessionInitQueue = [];
    queue.forEach((r) => r());
  }
}

export function invalidateSession(): void {
  sessionCookies = null;
  process.stderr.write("[trainline] Session invalidated, will refresh on next request\n");
}

// Inject session cookies into every request
client.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  await initSession();
  if (sessionCookies) {
    config.headers.Cookie = sessionCookies;
  }
  return config;
});

// On 403, invalidate session and retry once
client.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 403 && !error.config._retried) {
      process.stderr.write("[trainline] Got 403, refreshing session and retrying…\n");
      invalidateSession();
      error.config._retried = true;
      await initSession();
      if (sessionCookies) {
        error.config.headers.Cookie = sessionCookies;
      }
      return client.request(error.config);
    }
    return Promise.reject(error);
  }
);
