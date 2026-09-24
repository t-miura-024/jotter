import { describe, expect, it, vi } from "vitest";

import { base64ToBytes, base64UrlEncode, getAccessToken, parseServiceAccountJson } from "./auth";

/** テスト用 RSA 鍵ペアを生成し、秘密鍵 PEM と公開鍵を返す。 */
async function generateTestKey(): Promise<{ privatePem: string; publicKey: CryptoKey }> {
  const pair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const der = new Uint8Array(
    (await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer,
  );
  let binary = "";
  for (let i = 0; i < der.length; i++) binary += String.fromCharCode(der[i]);
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(binary)}\n-----END PRIVATE KEY-----\n`;
  return { privatePem: pem, publicKey: pair.publicKey };
}

const base64UrlDecode = (input: string): string => new TextDecoder().decode(base64ToBytes(input));

describe("parseServiceAccountJson", () => {
  it("client_email / private_key / token_uri を抜き出す", () => {
    const key = parseServiceAccountJson(
      JSON.stringify({
        client_email: "monologue@example.iam.gserviceaccount.com",
        private_key: "pem",
        token_uri: "https://oauth2.googleapis.com/token",
      }),
    );
    expect(key).toEqual({
      clientEmail: "monologue@example.iam.gserviceaccount.com",
      privateKey: "pem",
      tokenUri: "https://oauth2.googleapis.com/token",
    });
  });

  it("token_uri 欠落時は固定値を使う", () => {
    const key = parseServiceAccountJson(
      JSON.stringify({ client_email: "a@b", private_key: "pem" }),
    );
    expect(key.tokenUri).toBe("https://oauth2.googleapis.com/token");
  });

  it("JSON 内の token_uri が正規値と異なっても固定値を使い無視する（JWT 漏洩防止）", () => {
    const key = parseServiceAccountJson(
      JSON.stringify({
        client_email: "a@b",
        private_key: "pem",
        token_uri: "https://evil.example/token",
      }),
    );
    expect(key.tokenUri).toBe("https://oauth2.googleapis.com/token");
  });

  it.each(["not json", "[]", "{}", '{"client_email": "a"}'])(
    "不正な JSON・鍵欠落は投げる（%s）",
    (json) => {
      expect(() => parseServiceAccountJson(json)).toThrow("GOOGLE_SERVICE_ACCOUNT_JSON");
    },
  );
});

describe("base64UrlEncode", () => {
  it("パディングなし・URL 安全に符号化する", () => {
    expect(base64UrlEncode(new TextEncoder().encode("???"))).not.toContain("=");
    expect(base64UrlEncode(new Uint8Array([0xfb, 0xff]))).not.toMatch(/[+/=]/);
  });
});

describe("getAccessToken", () => {
  it("JWT 自己署名を token_uri へ送り access_token を返す", async () => {
    const { privatePem, publicKey } = await generateTestKey();
    const serviceAccountJson = JSON.stringify({
      client_email: "monologue@example.iam.gserviceaccount.com",
      private_key: privatePem,
    });

    let sentBody = "";
    let sentUrl = "";
    const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
      sentUrl = String(url);
      sentBody = String((init as RequestInit).body);
      return new Response(JSON.stringify({ access_token: "ya29.test" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const token = await getAccessToken({
      serviceAccountJson,
      scopes: ["https://www.googleapis.com/auth/calendar"],
      fetch: fetchMock,
      nowSeconds: 1_700_000_000,
    });
    expect(token).toBe("ya29.test");
    expect(sentUrl).toBe("https://oauth2.googleapis.com/token");

    const params = new URLSearchParams(sentBody);
    expect(params.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const assertion = params.get("assertion") ?? "";
    const [headerB64, claimB64, sigB64] = assertion.split(".");
    expect(JSON.parse(base64UrlDecode(headerB64))).toEqual({ alg: "RS256", typ: "JWT" });
    const claim = JSON.parse(base64UrlDecode(claimB64)) as Record<string, unknown>;
    expect(claim).toMatchObject({
      iss: "monologue@example.iam.gserviceaccount.com",
      scope: "https://www.googleapis.com/auth/calendar",
      aud: "https://oauth2.googleapis.com/token",
      iat: 1_700_000_000,
      exp: 1_700_003_600,
    });
    // 自己署名を公開鍵で検証する
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      base64ToBytes(sigB64),
      new TextEncoder().encode(`${headerB64}.${claimB64}`),
    );
    expect(valid).toBe(true);
  });

  it("token 取得失敗は投げる", async () => {
    const { privatePem } = await generateTestKey();
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response("denied", { status: 400, statusText: "Bad Request" }),
    );
    await expect(
      getAccessToken({
        serviceAccountJson: JSON.stringify({ client_email: "a@b", private_key: privatePem }),
        fetch: fetchMock,
      }),
    ).rejects.toThrow("access_token の取得に失敗しました: 400");
  });

  it("秘密鍵が読めないときは投げる", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    await expect(
      getAccessToken({
        serviceAccountJson: JSON.stringify({ client_email: "a@b", private_key: "not-a-key" }),
        fetch: fetchMock,
      }),
    ).rejects.toThrow("private_key");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
