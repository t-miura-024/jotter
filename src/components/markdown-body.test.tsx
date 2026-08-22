/**
 * @vitest-environment happy-dom
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MarkdownBody } from "./markdown-body";

afterEach(cleanup);

describe("MarkdownBody", () => {
  it("言語指定付きコードブロックを hljs クラスでハイライトする", () => {
    render(<MarkdownBody markdown={"```ts\nconst x = 1;\n```"} />);
    expect(document.querySelector("pre code .hljs-keyword")).not.toBeNull();
  });

  it("コードブロックの言語バッジに info string の言語名を表示する", () => {
    render(<MarkdownBody markdown={"```bash\necho hi\n```"} />);
    const pre = document.querySelector("pre");
    const badge = pre?.parentElement?.querySelector(":scope > span");
    expect(badge?.textContent).toBe("bash");
  });

  it("未知言語でもバッジは言語名を表示する（ハイライトは付かない）", () => {
    render(<MarkdownBody markdown={"```foo\nstuff\n```"} />);
    expect(document.querySelector(".hljs-keyword")).toBeNull();
    const pre = document.querySelector("pre");
    const badge = pre?.parentElement?.querySelector(":scope > span");
    expect(badge?.textContent).toBe("foo");
  });

  it("言語指定なしコードブロックにはハイライトもバッジも出さない", () => {
    render(<MarkdownBody markdown={"```\nplain\n```"} />);
    expect(document.querySelector("code.hljs")).toBeNull();
    const pre = document.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre?.parentElement?.querySelector(":scope > span")).toBeNull();
  });

  it("インラインコードはハイライトせずバッジも出さない", () => {
    const { container } = render(<MarkdownBody markdown={"text `const x = 1;` end"} />);
    expect(container.querySelector("code")).not.toBeNull();
    expect(container.querySelector("code.hljs")).toBeNull();
    expect(container.querySelector("span")).toBeNull();
  });
});
