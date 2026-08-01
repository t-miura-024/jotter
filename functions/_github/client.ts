/**
 * GitHub REST API クライアント。
 *
 * Classic PAT（ADR 0002）を保持し、共通ヘッダを付与する薄いラッパ。
 * トークンは Cloudflare secret（env.GITHUB_PAT）から受け取り、ブラウザには出さない。
 */
export type GitHubClientOptions = {
  token: string;
  /** API のベース URL。既定は https://api.github.com 。 */
  baseUrl?: string;
  /** fetch 実装。既定はグローバル fetch。テストで注入可能。 */
  fetch?: typeof fetch;
};

/** GitHub API 呼び出しの失敗。status に HTTP ステータスを保持する。 */
export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

export class GitHubClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly doFetch: typeof fetch;

  constructor(options: GitHubClientOptions) {
    this.token = options.token;
    this.baseUrl = options.baseUrl ?? "https://api.github.com";
    // グローバル fetch はそのまま変数へ代入して呼ぶと workerd が
    // "Illegal invocation" を投げるため、アロー関数で包んで束縛を保つ。
    this.doFetch = options.fetch ?? ((input, init) => fetch(input, init));
  }

  /** 共通ヘッダを付与して GitHub API を呼び出す。成否判定は呼び出し側で行う。 */
  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.token}`);
    headers.set("Accept", "application/vnd.github+json");
    headers.set("X-GitHub-Api-Version", "2022-11-28");
    headers.set("User-Agent", "jotter");

    return this.doFetch(`${this.baseUrl}${path}`, { ...init, headers });
  }
}

/** エラーレスポンスの body を読み取り、読みやすい GitHubError に変換する。 */
export async function toGitHubError(response: Response, action: string): Promise<GitHubError> {
  let detail = `${response.status} ${response.statusText}`;
  try {
    const body = (await response.json()) as {
      message?: string;
      errors?: Array<{ message?: string; code?: string }>;
    };
    if (body.message) {
      const sub = (body.errors ?? [])
        .map((entry) => entry.message ?? entry.code)
        .filter((entry): entry is string => Boolean(entry))
        .join(", ");
      detail = sub ? `${body.message} (${sub})` : body.message;
    }
  } catch {
    // body の解析に失敗したらステータス行をそのまま使う。
  }
  return new GitHubError(`${action}: ${detail}`, response.status);
}
