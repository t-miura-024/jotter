import { GitHubClient } from "../_github/client";
import { validateExternalRepo } from "../_github/external-repo";
import { addIssueToProject, type ProjectConfig } from "../_github/project";
import { submitDraft } from "../_github/submit-draft";
import { INTERNAL_OWNER, determineTarget, parseRepoRef } from "../_github/target";
import { formatJot } from "../_lib/gemini";
import type { Env } from "../_types";

type SubmitRequestBody = {
  jot?: unknown;
  preferredModel?: unknown;
  /** 選択中の内部 repo（"owner/name"）。note inbox なら外部 repo 入力が意味を持つ。 */
  repo?: unknown;
  /** 外部 repo 入力（note inbox 選択時のみ。target repo と解釈しない）。 */
  externalRepo?: unknown;
};

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function sseResponse(stream: ReadableStream): Response {
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

/**
 * POST /api/submit — jot を受け取り、Gemini で整形して draft 計画 Issue を起票する。
 *
 * 新 semantics（ADR 0010）:
 * - repo は選択中の内部 repo。外部 repo 指定や未指定の自由入力は受け付けない。
 * - externalRepo は note inbox 選択時にだけ意味を持つ外部由来情報で、
 *   target repo と解釈しない。検証は LLM・GitHub API 呼び出しより先に完了させる。
 * - 検証エラー（4xx）は SSE に乗せず通常の JSON で返す。
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

  if (!env.GITHUB_PAT) {
    return json({ error: "サーバー設定エラー: GITHUB_PAT が設定されていません" }, 500);
  }
  if (!env.GEMINI_API_KEY) {
    return json({ error: "サーバー設定エラー: GEMINI_API_KEY が設定されていません" }, 500);
  }

  // ---- 起票先・外部 repo の検証（LLM 呼び出しより先に完了させる）----
  const repoInput = typeof payload.repo === "string" ? payload.repo : "";
  const selectedRepo = parseRepoRef(repoInput);
  if (selectedRepo && selectedRepo.owner !== INTERNAL_OWNER) {
    return json({ error: "repo には内部 repo（t-miura-024/*）のみ指定できます" }, 400);
  }

  const externalInput =
    typeof payload.externalRepo === "string" ? payload.externalRepo.trim() : "";
  const externalValidation = validateExternalRepo(externalInput);
  if (!externalValidation.ok) {
    return json({ error: externalValidation.error }, 400);
  }

  const target = determineTarget(selectedRepo, externalValidation.repo);

  const preferredModel =
    typeof payload.preferredModel === "string" ? payload.preferredModel : undefined;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(sseEvent(event, data)));
      };

      try {
        send("formatting", {});
        let formatted;
        try {
          formatted = await formatJot(jot, {
            apiKey: env.GEMINI_API_KEY,
            preferredModel,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`LLM 整形に失敗しました: ${message}`);
        }

        send("creating", {});
        const client = new GitHubClient({ token: env.GITHUB_PAT });
        const result = await submitDraft(client, {
          repo: target.repo,
          title: formatted.title,
          body: formatted.body,
          externalLabel: target.externalLabel ?? undefined,
        });

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

        send("done", {
          ...result,
          body: formatted.body,
          modelUsed: formatted.modelUsed,
          fallbackOccurred: formatted.fallbackOccurred,
          projectAdded,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        send("error", { error: message });
      } finally {
        controller.close();
      }
    },
  });

  return sseResponse(stream);
};
