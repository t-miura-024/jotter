import { describe, expect, it } from "vitest";

import { onRequestGet } from "./return";

type ReturnContext = Parameters<typeof onRequestGet>[0];

function context(): ReturnContext {
  return {
    request: new Request("https://jotter.example/api/auth/return"),
  } as unknown as ReturnContext;
}

describe("GET /api/auth/return", () => {
  it("アプリトップへ 302 でリダイレクトする", async () => {
    const response = await onRequestGet(context());
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://jotter.example/");
  });
});
