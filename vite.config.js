import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const CDN_ORIGIN = (process.env.VITE_CDN_URL || "").trim().replace(/\/$/, "");

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self'${CDN_ORIGIN ? ` ${CDN_ORIGIN}` : ""}`,
  `style-src 'self' 'unsafe-inline' blob: https://fonts.googleapis.com${CDN_ORIGIN ? ` ${CDN_ORIGIN}` : ""}`,
  `font-src 'self' data: blob: https://fonts.gstatic.com${CDN_ORIGIN ? ` ${CDN_ORIGIN}` : ""}`,
  `img-src 'self' data: blob:${CDN_ORIGIN ? ` ${CDN_ORIGIN}` : ""}`,
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.mymemory.translated.net",
  "worker-src 'self' blob:",
  "frame-src 'self' blob:",
  "media-src 'self' blob: data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join("; ");

function productionSecurityMeta() {
  return {
    name: "production-security-meta",
    apply: "build",
    transformIndexHtml(html) {
      const meta = [
        `<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`,
        '<meta name="referrer" content="strict-origin-when-cross-origin" />',
        '<meta name="robots" content="noindex, nofollow, noarchive, nosnippet, noimageindex" />',
      ].join("\n    ");
      return html.replace("</head>", `    ${meta}\n  </head>`);
    },
  };
}

export default defineConfig({
  base: CDN_ORIGIN ? `${CDN_ORIGIN}/` : process.env.GITHUB_ACTIONS ? "/MyLibrary/" : "/",
  plugins: [react(), productionSecurityMeta()],
  server: {
    proxy: {
      "/api": {
        target: process.env.API_PROXY_TARGET || "http://127.0.0.1:3001",
        changeOrigin: true,
      },
    },
  },
  preview: {
    proxy: {
      "/api": {
        target: process.env.API_PROXY_TARGET || "http://127.0.0.1:3001",
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      input: {
        library: resolve(import.meta.dirname, "index.html"),
        reader: resolve(import.meta.dirname, "reader.html"),
      },
    },
  },
});
