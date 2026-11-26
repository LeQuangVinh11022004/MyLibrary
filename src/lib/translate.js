import { decodeHtmlEntities } from "./text-utils";
import { getSecurityHeaders } from "./security-shield";

const MAX_CHARS = 480;
const cache = new Map();
const VIETNAMESE_RE = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

export function detectDirection(text = "") {
  return VIETNAMESE_RE.test(text)
    ? { source: "vi", target: "en" }
    : { source: "en", target: "vi" };
}

export function prepareTranslationText(text = "") {
  const clean = text.replace(/\s+/g, " ").trim();
  return { text: clean.slice(0, MAX_CHARS), truncated: clean.length > MAX_CHARS };
}

async function translateViaApi(text, source, target, signal) {
  const response = await fetch("/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getSecurityHeaders() },
    body: JSON.stringify({ text, source, target }),
    signal,
  });
  if (response.status === 429) {
    const data = await response.json().catch(() => null);
    const error = new Error(data?.error || "Bạn dịch quá nhanh, vui lòng đợi một chút.");
    error.rateLimited = true;
    throw error;
  }
  if (!response.ok) return null;
  const data = await response.json().catch(() => null);
  return data?.translation || null;
}

async function translateDirect(text, source, target, signal) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${source}|${target}`;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("Dịch vụ dịch đang bận, thử lại sau.");
  const data = await response.json();
  const translation = data?.responseData?.translatedText;
  if (!translation || Number(data?.responseStatus) !== 200) {
    throw new Error(data?.responseDetails || "Không dịch được đoạn này.");
  }
  return decodeHtmlEntities(translation);
}

export async function translateText(rawText, source, target, signal) {
  const { text } = prepareTranslationText(rawText);
  if (!text) return "";
  const key = `${source}|${target}|${text}`;
  if (cache.has(key)) return cache.get(key);

  let translation = null;
  try {
    translation = await translateViaApi(text, source, target, signal);
  } catch (error) {
    if (error.name === "AbortError" || error.rateLimited) throw error;
  }
  if (!translation) translation = await translateDirect(text, source, target, signal);

  cache.set(key, translation);
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  return translation;
}
