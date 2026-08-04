import type { Env } from "../../_types";

/**
 * GET /api/auth/return — Cloudflare Access 再ログイン後の帰還エンドポイント。
 * 保護範囲（/api/*）内にあるため未認証時は Access のログインへ遷移し、
 * 認証後にここへ戻ってからアプリトップ（/）へ 302 する。
 */
export const onRequestGet: PagesFunction<Env> = ({ request }) => {
  return Response.redirect(new URL("/", request.url).toString(), 302);
};
