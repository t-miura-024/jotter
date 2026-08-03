import { useEffect, useState } from "react";

import { Monitor, Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";

type Theme = "system" | "light" | "dark";

/** index.html の FOUC 防止スクリプトと共通のキー・判定ロジックを参照する。 */
const STORAGE_KEY = "jotter-theme";

/** index.html の theme-color 二重 meta と同じ色値（light 既定 / dark は OS 追従）。 */
const THEME_COLOR = {
  light: "#ffffff",
  dark: "#0a0a0a",
} as const;

const NEXT_THEME: Record<Theme, Theme> = {
  system: "light",
  light: "dark",
  dark: "system",
};

const THEME_LABEL: Record<Theme, string> = {
  system: "テーマ: システム設定に従う",
  light: "テーマ: ライト",
  dark: "テーマ: ダーク",
};

const THEME_ICON: Record<Theme, typeof Monitor> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};

function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  } catch {
    // localStorage 利用不可（プライベートモード等）はシステム設定にフォールバック。
  }
  return "system";
}

/**
 * theme-color meta を解決済みテーマへ同期する。index.html では light 既定 +
 * prefers-color-scheme 条件の二重 meta を置くが、手動設定が OS テーマと異なる
 * 場合に備え、JS 解決後は条件付き meta を除去して先頭 meta に解決値を固定する。
 */
function applyThemeColor(dark: boolean): void {
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  if (metas.length === 0) return;
  metas[0].content = dark ? THEME_COLOR.dark : THEME_COLOR.light;
  for (let i = 1; i < metas.length; i += 1) metas[i].remove();
}

function applyTheme(theme: Theme): void {
  const dark =
    theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  applyThemeColor(dark);
}

/**
 * light/dark トグル。システム追従（既定）+ 手動オーバーライドの 3 状態サイクル。
 * 手動設定は localStorage に永続化し、system 選択中は prefers-color-scheme の
 * 変更を追従する。初期描画の dark クラスは index.html インラインスクリプトが
 * 同じロジックで適用済み（FOUC 防止）。
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readStoredTheme);

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // 永続化できなくても当セッションのテーマは維持される。
    }
    if (theme !== "system") return;
    const query = matchMedia("(prefers-color-scheme: dark)");
    const sync = (): void => applyTheme("system");
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, [theme]);

  const Icon = THEME_ICON[theme];

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={THEME_LABEL[theme]}
      title={THEME_LABEL[theme]}
      onClick={() => setTheme(NEXT_THEME[theme])}
    >
      <Icon aria-hidden />
    </Button>
  );
}
