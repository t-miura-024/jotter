/**
 * Cloudflare Access のセッション切れ（ログイン URL への 302 リダイレクト）を検出したことを表すエラー。
 * UI 側で再ログインを促すために使う。
 */
export class AuthExpiredError extends Error {
  constructor() {
    super("Cloudflare Access のセッションが切れています。再ログインしてください。");
    this.name = "AuthExpiredError";
  }
}

/**
 * fetch のラッパ。redirect: "manual" にして Access の 302 を追いかけず、
 * opaqueredirect として受け取り AuthExpiredError へ変換する。
 * 通常時はレスポンスをそのまま返す。これによりセッション切れのとき
 * 「Failed to fetch（CORS エラー）」ではなく意味のあるエラーになる。
 */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(path, { ...init, redirect: "manual" });
  if (response.type === "opaqueredirect") {
    throw new AuthExpiredError();
  }
  return response;
}