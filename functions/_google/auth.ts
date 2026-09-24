/**
 * Google Service Account クライアント（ADR 0013）。
 *
 * JWT 自己署名（RS256）→ OAuth2 access_token 交換を fetch 直呼びで行う。
 * 新規依存（googleapis）は追加しない（既存 gemini.ts / client.ts 方式）。
 * 秘密鍵 JSON は Pages secret（GOOGLE_SERVICE_ACCOUNT_JSON）由来の文字列として受け取り、
 * ブラウザには一切出さない。
 */

const GOOGLE_FIXED_TOKEN_URI = "https://oauth2.googleapis.com/token";
/** Calendar 読み書きに必要な最小スコープ。 */
export const GOOGLE_CALENDAR_SCOPES = ["https://www.googleapis.com/auth/calendar"] as const;

export type ServiceAccountKey = {
  clientEmail: string;
  privateKey: string;
  tokenUri: string;
};

export type AccessTokenOptions = {
  /** GOOGLE_SERVICE_ACCOUNT_JSON の生文字列。 */
  serviceAccountJson: string;
  scopes?: readonly string[];
  /** fetch 実装。テストで注入可能。 */
  fetch?: typeof fetch;
  /** 署名時刻（秒）。テストで注入可能。 */
  nowSeconds?: number;
};

/** Service Account JSON を検証して抜き出す。形式不正は Error を投げる。 */
export function parseServiceAccountJson(json: string): ServiceAccountKey {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON が不正な JSON です");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON が不正な JSON です");
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.client_email !== "string" || typeof record.private_key !== "string") {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON に client_email / private_key がありません");
  }
  // token_uri は JSON 内の値を信用せず固定値のみ使う。任意 URL を許すと、
  // 秘密鍵で署名した JWT アサーション（≒クレデンシャル）を攻撃者 URL へ POST して
  // 漏洩させる SSRF 的な危険があるため。Google の正規値と異なる値が入っていても無視する。
  return {
    clientEmail: record.client_email,
    privateKey: record.private_key,
    tokenUri: GOOGLE_FIXED_TOKEN_URI,
  };
}

/** バイト列 → base64url（パディングなし）。 */
export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** base64url/標準 base64 → バイト列。 */
export function base64ToBytes(base64: string): Uint8Array {
  const normalized = base64.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** PEM（PKCS#8）→ DER バイト列。 */
function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  if (!body) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON の private_key が空です");
  return base64ToBytes(body);
}

/**
 * Service Account の JWT に自己署名し、access_token と交換する。
 * stateless 方針のためトークンキャッシュは持たない（呼び出しごとに取得する）。
 */
export async function getAccessToken(options: AccessTokenOptions): Promise<string> {
  const key = parseServiceAccountJson(options.serviceAccountJson);
  const scopes = options.scopes ?? GOOGLE_CALENDAR_SCOPES;
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);

  const header = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })),
  );
  const claim = base64UrlEncode(
    new TextEncoder().encode(
      JSON.stringify({
        iss: key.clientEmail,
        scope: [...scopes].join(" "),
        aud: key.tokenUri,
        iat: now,
        exp: now + 3600,
      }),
    ),
  );
  const signingInput = `${header}.${claim}`;

  let privateKey: CryptoKey;
  try {
    privateKey = await crypto.subtle.importKey(
      "pkcs8",
      pemToDer(key.privateKey).slice().buffer as ArrayBuffer,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON の private_key を読み込めません");
  }
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(signingInput),
  );
  const assertion = `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;

  // workerd の "Illegal invocation" を避けるためアロー関数で束縛を保つ（client.ts と同じ方針）。
  const doFetch: typeof fetch = options.fetch ?? ((input, init) => fetch(input, init));
  const response = await doFetch(key.tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:
      `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}` +
      `&assertion=${encodeURIComponent(assertion)}`,
  });
  if (!response.ok) {
    throw new Error(
      `Google access_token の取得に失敗しました: ${response.status} ${response.statusText}`,
    );
  }
  const data = (await response.json()) as { access_token?: unknown };
  if (typeof data.access_token !== "string" || data.access_token.length === 0) {
    throw new Error("Google access_token の取得に失敗しました: 応答の形式が不正です");
  }
  return data.access_token;
}
