import { StrictMode } from "react";

import { createRoot } from "react-dom/client";

import App from "./App";
import "./index.css";

// テーマ（light/dark）は ThemeToggle が担当: 手動設定（localStorage）+ システム追従。
// 初期描画の dark クラスは index.html のインラインスクリプトが担保する（FOUC 防止）。

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
