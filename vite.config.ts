/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    proxy: {
      // フロントエンド単独開発（pnpm dev）時、API を `pnpm pages:dev`（8788）へ転送する。
      "/api": "http://localhost:8788",
    },
  },
  test: {
    environment: "node",
    include: ["functions/**/*.test.ts"],
  },
});
