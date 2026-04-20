import path from "path";
import { fileURLToPath } from "url";
import axios, { type AxiosInstance } from "axios";
import { type BrowserContext, type Page } from "playwright";
import { chromium as chromiumExtra } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

chromiumExtra.use(StealthPlugin());

const BASE_URL = "https://www.thetrainline.com";

const USER_AGENT =
  process.env.TRAINLINE_USER_AGENT ??
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export const LOCALE = process.env.TRAINLINE_LOCALE ?? "en-GB";

// Persistent Chrome profile — preserves cookies, localStorage, IndexedDB,
// device fingerprint and DataDome trust score across restarts.
const USER_DATA_DIR =
  process.env.TRAINLINE_USER_DATA_DIR ??
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    ".trainline-profile"
  );

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

// --- Persistent browser context ---

let browserCtx: BrowserContext | null = null;
let page: Page | null = null;
let initPromise: Promise<void> | null = null;

const CAPTCHA_TIMEOUT_MS = 300_000; // 5 minutes for user to solve
const LOGIN_TIMEOUT_MS = 300_000;

async function hasCaptcha(p: Page): Promise<boolean> {
  return p
    .evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const doc = (globalThis as any).document;
      const frames = Array.from(doc.querySelectorAll("iframe")) as Array<{ src?: string }>;
      const hasFrame = frames.some((f) => (f.src ?? "").includes("captcha-delivery"));
      const hasBlocker = !!doc.querySelector(
        '[id*="datadome"], [class*="datadome"], #captcha__puzzle, #captcha-container'
      );
      return hasFrame || hasBlocker;
    })
    .catch(() => false);
}

async function isLoggedIn(p: Page): Promise<boolean> {
  // Trainline sets an auth cookie after login (typical names: "tl-auth",
  // "tlAccessToken", or a session cookie). Safer heuristic: check if the
  // account endpoint returns 200 from within the page.
  return p
    .evaluate(async (base) => {
      try {
        const r = await fetch(`${base}/my-account/`, {
          credentials: "include",
          redirect: "manual",
        });
        // 200 = logged in, 0/opaqueredirect/302 to /login = not
        return r.status === 200;
      } catch {
        return false;
      }
    }, BASE_URL)
    .catch(() => false);
}

async function waitForCaptchaSolved(p: Page): Promise<void> {
  process.stderr.write(
    "[trainline] CAPTCHA detected — please solve it in the browser window (up to 5 min)…\n"
  );
  const deadline = Date.now() + CAPTCHA_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await p.waitForTimeout(2_000);
    if (!(await hasCaptcha(p))) {
      process.stderr.write("[trainline] CAPTCHA cleared — continuing\n");
      // Small grace period so DataDome cookie is finalised
      await p.waitForTimeout(2_000);
      return;
    }
  }
  throw new Error("[trainline] Timed out waiting for CAPTCHA to be solved");
}

async function ensureBrowser(): Promise<Page> {
  if (page && !page.isClosed()) return page;

  if (!initPromise) {
    initPromise = (async () => {
      process.stderr.write(
        `[trainline] Launching browser with profile: ${USER_DATA_DIR}\n`
      );

      browserCtx = (await chromiumExtra.launchPersistentContext(USER_DATA_DIR, {
        headless: false,
        channel: "chrome",
        userAgent: USER_AGENT,
        locale: LOCALE,
        viewport: { width: 1366, height: 820 },
        args: [
          "--disable-blink-features=AutomationControlled",
          "--disable-features=IsolateOrigins,site-per-process",
        ],
      })) as unknown as BrowserContext;

      await browserCtx.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => false });
      });

      const pages = browserCtx.pages();
      page = pages[0] ?? (await browserCtx.newPage());

      await page.goto(BASE_URL, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });

      // 1) Resolve CAPTCHA if DataDome is challenging right now
      if (await hasCaptcha(page)) {
        await waitForCaptchaSolved(page);
      }

      // 2) Make sure we're logged in
      if (!(await isLoggedIn(page))) {
        process.stderr.write(
          "[trainline] Not signed in — opening login page, please sign in…\n"
        );
        await page.goto(`${BASE_URL}/book/login?lang=en-us`, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
        try {
          await page.waitForURL(
            (url) => !url.toString().includes("/book/login"),
            { timeout: LOGIN_TIMEOUT_MS, waitUntil: "commit" }
          );
        } catch {
          throw new Error("[trainline] Login timed out");
        }
        await page.waitForTimeout(3_000);
        // Re-check for CAPTCHA after login
        if (await hasCaptcha(page)) await waitForCaptchaSolved(page);
      }

      process.stderr.write("[trainline] Browser session ready\n");
    })();
  }

  await initPromise;
  return page!;
}

/**
 * Make a POST request from within the browser context (uses real browser
 * network stack + authenticated session cookies → bypasses DataDome).
 *
 * On 403 (CAPTCHA challenge), navigates the visible browser page so
 * DataDome renders its CAPTCHA, waits for the user to solve it, then
 * retries the request once.
 */
export async function browserPost<T>(
  urlPath: string,
  body: unknown,
  isRetry = 0
): Promise<T> {
  const p = await ensureBrowser();

  const doFetch = () =>
    p.evaluate(
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
          const text = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
        }

        return (await res.json()) as unknown;
      },
      { url: `${BASE_URL}${urlPath}`, payload: body, locale: LOCALE }
    );

  try {
    return (await doFetch()) as T;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    const looksLikeCaptcha =
      msg.includes("403") &&
      (msg.includes("captcha-delivery") || msg.includes("datadome"));

    if (looksLikeCaptcha && isRetry < 3) {
      process.stderr.write(
        `[trainline] Got DataDome 403 (attempt ${isRetry + 1}) — triggering visible CAPTCHA for you to solve…\n`
      );
      // Navigate the visible page so DataDome renders its CAPTCHA inline
      await p
        .goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 30_000 })
        .catch(() => {});
      // CAPTCHA loads async — poll for up to 15s for it to appear
      let captchaAppeared = false;
      for (let i = 0; i < 15; i++) {
        await p.waitForTimeout(1_000);
        if (await hasCaptcha(p)) {
          captchaAppeared = true;
          break;
        }
      }
      if (captchaAppeared) {
        await waitForCaptchaSolved(p);
      } else {
        process.stderr.write(
          "[trainline] No CAPTCHA visible — waiting 20s before retrying…\n"
        );
        await p.waitForTimeout(20_000);
      }
      return browserPost<T>(urlPath, body, isRetry + 1);
    }

    throw err;
  }
}
