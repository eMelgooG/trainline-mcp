import axios, { type AxiosInstance } from "axios";

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
  timeout: 15_000,
});
