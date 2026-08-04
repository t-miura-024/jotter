import { useEffect, useState } from "react";

import { LoaderCircle } from "lucide-react";

import { apiFetch } from "@/lib/api";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type RepoEntry = {
  owner: string;
  name: string;
  fullName: string;
};

/** 「その他」自由入力モードを示すセレクタの値。 */
export const REPO_OTHER_VALUE = "__other__";

type RepoSelectorProps = {
  /**
   * 現在の選択値（コントロール値）。
   * ""（指定しない）| "owner/name"（repo 一覧の項目）| REPO_OTHER_VALUE（その他）。
   */
  selection: string;
  /** 「その他」選択時の自由入力値（owner/name 形式 or 空）。 */
  otherRepo: string;
  onSelectionChange: (selection: string) => void;
  onOtherRepoChange: (otherRepo: string) => void;
  disabled?: boolean;
};

/**
 * repo セレクタ: t-miura-024 配下から選択 + 「その他」自由入力 + 空（未指定）。
 *
 * - 未指定（デフォルト）→ note inbox + external/others
 * - t-miura-024/X 選択 → その repo に直接起票
 * - その他 + 自由入力 → note inbox + external/{owner}-{name}（空なら external/others）
 *
 * 選択状態は親（App）が保持し、localStorage への復元・永続化も親が行う。
 */
export function RepoSelector({
  selection,
  otherRepo,
  onSelectionChange,
  onOtherRepoChange,
  disabled,
}: RepoSelectorProps) {
  const [repos, setRepos] = useState<RepoEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/repos")
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<{ repos: RepoEntry[] }>;
      })
      .then((data) => {
        if (!cancelled) setRepos(data.repos);
      })
      .catch(() => {
        // 取得失敗時は空一覧でセレクタを表示（手動入力は可能）。
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isOther = selection === REPO_OTHER_VALUE;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Select
          value={selection}
          onValueChange={onSelectionChange}
          disabled={disabled || loading}
        >
          <SelectTrigger className="w-full" aria-label="リポジトリ">
            <SelectValue placeholder={loading ? "読み込み中…" : "リポジトリを選択"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">指定しない（note inbox へ）</SelectItem>
            {repos.map((repo) => (
              <SelectItem key={repo.fullName} value={repo.fullName}>
                {repo.fullName}
              </SelectItem>
            ))}
            <SelectItem value={REPO_OTHER_VALUE}>その他（自由入力）</SelectItem>
          </SelectContent>
        </Select>
        {loading && (
          <LoaderCircle
            aria-hidden
            className="size-4 shrink-0 animate-spin text-muted-foreground"
          />
        )}
      </div>
      {isOther && (
        <Input
          aria-label="リポジトリ名（owner/name 形式）"
          placeholder="owner/name（空なら note inbox へ）"
          value={otherRepo}
          onChange={(event) => onOtherRepoChange(event.target.value)}
          disabled={disabled}
        />
      )}
    </div>
  );
}
