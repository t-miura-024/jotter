/** Gemini で失敗したモデルの記録。成功モデルは含めない。 */
export type FallbackEvent = {
  model: string;
  status: number;
  /** error.message（空なら statusText）を 120 文字以内に切り詰めたもの。 */
  message: string;
};

/** /api/submit の done ペイロード。サーバーと結果 UI で共有する。 */
export type SubmitResult = {
  number: number;
  title: string;
  url: string;
  repo: string;
  body: string;
  modelUsed: string;
  /** 試行順の失敗履歴。空配列＝フォールバックなし。 */
  fallbacks: FallbackEvent[];
  projectAdded: boolean;
};
