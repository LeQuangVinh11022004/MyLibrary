const CDN_BASE_URL = (import.meta.env.VITE_CDN_URL || "").replace(/\/$/, "");
const DEVICE_ID_KEY = "trang-sach-device-fingerprint";

export function getDeviceId() {
  try {
    let existing = window.localStorage.getItem(DEVICE_ID_KEY);
    if (!existing) {
      existing = crypto.randomUUID();
      window.localStorage.setItem(DEVICE_ID_KEY, existing);
    }
    return existing;
  } catch {
    return "ephemeral-device";
  }
}

export function getDeviceLabel() {
  const ua = window.navigator.userAgent || "";
  const platform = /Windows/i.test(ua)
    ? "Windows"
    : /Mac/i.test(ua)
      ? "macOS"
      : /Android/i.test(ua)
        ? "Android"
        : /iPhone|iPad/i.test(ua)
          ? "iOS"
          : "Linux/Web";
  const browser = /Edg\//i.test(ua)
    ? "Edge"
    : /Chrome\//i.test(ua)
      ? "Chrome"
      : /Firefox\//i.test(ua)
        ? "Firefox"
        : /Safari\//i.test(ua)
          ? "Safari"
          : "Browser";
  return `${browser} · ${platform}`;
}

export function resolveCdnAssetUrl(assetPath = "") {
  if (!assetPath) return assetPath;
  if (/^https?:\/\//i.test(assetPath) || !CDN_BASE_URL) return assetPath;
  return `${CDN_BASE_URL}/${assetPath.replace(/^\//, "")}`;
}

export function getSecurityHeaders() {
  return {
    "X-Client-Device-Id": getDeviceId(),
    "X-Client-Device-Label": getDeviceLabel(),
  };
}

async function sha256Hex(input) {
  const bytes = new TextEncoder().encode(input);
  const digest = await window.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Open-source client-side SHA-256 Proof-of-Work solver (zero third-party dependency).
 * Finds a counter such that SHA-256(`${nonce}:${counter}`) starts with `difficulty` hex zeros.
 */
export async function solvePowChallenge(nonce, difficulty = 3, maxIterations = 250_000) {
  if (!nonce || !window.crypto?.subtle) return null;
  const targetPrefix = "0".repeat(Math.min(5, Math.max(1, Number(difficulty) || 3)));
  for (let counter = 0; counter < maxIterations; counter += 1) {
    const hash = await sha256Hex(`${nonce}:${counter}`);
    if (hash.startsWith(targetPrefix)) {
      return { nonce, counter, hash };
    }
  }
  return null;
}
