/**
 * Cloudflare Pages Functions の環境バインディング。
 *
 * secret はすべてサーバー側（env）に留め、ブラウザには一切出さない（ADR 0002 / 0003）。
 */
export type Env = {
  /** GitHub Classic PAT（scope: repo + project）。Cloudflare secret / .dev.vars で設定。 */
  GITHUB_PAT: string;
  /** Gemini API key。Cloudflare secret / .dev.vars で設定。ブラウザには一切出さない（ADR 0003）。 */
  GEMINI_API_KEY: string;
  /** ProjectV2 の node ID（PVT_...）。未設定なら Project 連携をスキップ（best-effort）。 */
  PROJECT_ID?: string;
  /** Project の Status フィールドの node ID（PVTSSF_...）。 */
  STATUS_FIELD_ID?: string;
  /** Status フィールドの `draft` オプションの node ID。 */
  STATUS_OPTION_ID?: string;
};
