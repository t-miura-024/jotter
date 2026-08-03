/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // PWA: generateSW で Service Worker を生成。更新は prompt 型（サイレント自動更新しない）。
    // dev サーバーでは SW を登録しない（PWA 挙動の確認は pnpm pages:dev で行う）。
    VitePWA({
      registerType: "prompt",
      devOptions: { enabled: false },
      // manifest 非参照の public アセットも precache する（manifest の icons には追加されない）。
      includeAssets: ["apple-touch-icon-180x180.png"],
      manifest: {
        name: "Jotter",
        short_name: "Jotter",
        // プラグイン既定の "en" ではなく、UI・html lang="ja" に合わせる。
        lang: "ja",
        description: "走り書きをそのまま。送信すると GitHub に draft 計画 Issue が起票されます。",
        display: "standalone",
        start_url: "/",
        background_color: "#ffffff",
        // theme_color は light 値。OS テーマ追従は index.html の theme-color 二重 meta が担う。
        theme_color: "#ffffff",
        icons: [
          { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // 静的アセット（app shell）を precache。woff2 は Geist Variable フォント。
        // manifest とその icons はプラグインが自動で precache に加えるため、
        // 重複を避けて png / webmanifest は globPatterns に含めない。
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        // オフラインの SPA ナビゲーションを precache 済み index.html で支える。
        navigateFallback: "index.html",
        // /api/* は Pages Functions のため SW から完全に除外する（denylist により
        // ナビゲーションハンドラがマッチせず、そのままネットワークへ通過する）。
        // また runtimeCaching は一切設定しないため、/api/* の fetch() レスポンスや
        // Cloudflare Access のログインリダイレクト（cross-origin）はキャッシュされない。
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
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
