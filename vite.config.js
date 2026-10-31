import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' blob: https://fonts.googleapis.com",
  "font-src 'self' data: blob: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
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
      ].join("\n    ");
      return html.replace("</head>", `    ${meta}\n  </head>`);
    },
  };
}

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/MyLibrary/" : "/",
  plugins: [react(), productionSecurityMeta()],
  build: {
    rollupOptions: {
      input: {
        library: resolve(import.meta.dirname, "index.html"),
        reader: resolve(import.meta.dirname, "reader.html"),
      },
    },
  },
});
