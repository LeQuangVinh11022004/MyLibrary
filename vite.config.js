import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/MyLibrary/" : "/",
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        library: resolve(import.meta.dirname, "index.html"),
        reader: resolve(import.meta.dirname, "reader.html"),
      },
    },
  },
});
