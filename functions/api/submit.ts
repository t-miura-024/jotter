import { GitHubClient } from "../_github/client";
import { addIssueToProject, type ProjectConfig } from "../_github/project";
import { submitDraft } from "../_github/submit-draft";
import { determineTarget, parseRepoRef } from "../_github/target";
import { formatJot } from "../_lib/gemini";
import type { Env } from "../_types";

type SubmitRequestBody = {
  /** テキストエリアから投げ込まれる生の走り書き。 */
  jot?: unknown;
  /** 優先 Gemini モデル名（M5 GUI セレクタから渡される。未指定時は flash-latest 優先）。 */
  preferredModel?: unknown;
  /**
   * 起票先リポジトリ指定（"owner/name" 形式）。
   * 空文字・未指定 → note inbox + external/others。
   * t-miura-024 配下 → その repo に直接起票。
   * 外部 repo → note inbox + external/{owner}-{name}。
   */
  repo?: unknown;
};

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/**
 * POST /api/submit — jot を受け取り、Gemini で整形して draft 計画 Issue を起票する。
 *
 * M2: LLM 整形（ADR 0007 忠実な記録のみ）→ GitHub 起票。
 * M3: repo パラメータで起票先を決定（determineTarget、draft.rs 由来）。
 * M4: 起票後に Project 連携（ProjectV2 へ item-add + Status=draft）。best-effort で、
 *     失敗しても起票は成功として扱い、結果は projectAdded で返す。
 * レスポンスに modelUsed / fallbackOccurred / projectAdded を含め、M5 UI が表示に消費する。
 * Cloudflare Access が手前で認証するため、この Function に認証コードはない（ADR 0001）。
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let payload: SubmitRequestBody;
  try {
    payload = (await request.json()) as SubmitRequestBody;
  } catch {
    return json({ error: "リクエストボディが不正な JSON です" }, 400);
  }

  const jot = typeof payload.jot === "string" ? payload.jot.trim() : "";
  if (jot.length === 0) {
    return json({ error: "jot が空です" }, 400);
  }

  // クライアントエラー（4xx）を先に確定させ、サーバー設定エラー（5xx）は最後に検査する。
  if (!env.GITHUB_PAT) {
    return json({ error: "サーバー設定エラー: GITHUB_PAT が設定されていません" }, 500);
  }
  if (!env.GEMINI_API_KEY) {
    return json({ error: "サーバー設定エラー: GEMINI_API_KEY が設定されていません" }, 500);
  }

  const preferredModel =
    typeof payload.preferredModel === "string" ? payload.preferredModel : undefined;

  // repo パラメータのパース（"owner/name" 形式 or 空 → null）
  const repoInput = typeof payload.repo === "string" ? payload.repo : "";
  const selectedRepo = parseRepoRef(repoInput);
  const target = determineTarget(selectedRepo);

  // LLM 整形（ADR 0007: タイトル抽出 + 読みやすい Markdown への清書のみ）
  let formatted;
  try {
    formatted = await formatJot(jot, {
      apiKey: env.GEMINI_API_KEY,
      preferredModel,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: `LLM 整形に失敗しました: ${message}` }, 502);
  }

  try {
    const client = new GitHubClient({ token: env.GITHUB_PAT });
    const result = await submitDraft(client, {
      repo: target.repo,
      title: formatted.title,
      body: formatted.body,
      externalLabel: target.externalLabel ?? undefined,
    });

    // M4: Project 連携（draft.rs add_to_project_and_set_status 相当）。
    // secret がすべて揃う場合のみ試行し、失敗は warn ログのみで起票は成功として返す。
    let projectAdded = false;
    const projectConfig: ProjectConfig | null =
      env.PROJECT_ID && env.STATUS_FIELD_ID && env.STATUS_OPTION_ID
        ? {
            projectId: env.PROJECT_ID,
            statusFieldId: env.STATUS_FIELD_ID,
            statusOptionId: env.STATUS_OPTION_ID,
          }
        : null;
    if (projectConfig) {
      try {
        await addIssueToProject(client, projectConfig, {
          ...target.repo,
          number: result.number,
        });
        projectAdded = true;
      } catch (error) {
        console.warn("Project 連携に失敗しました。起票は成功として扱います。", error);
      }
    }

    return json(
      {
        ...result,
        modelUsed: formatted.modelUsed,
        fallbackOccurred: formatted.fallbackOccurred,
        projectAdded,
      },
      201,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: `起票に失敗しました: ${message}` }, 502);
  }
};
