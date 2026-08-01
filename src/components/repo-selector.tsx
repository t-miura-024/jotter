import { useEffect, useState } from "react";

import { LoaderCircle } from "lucide-react";

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

/** 「その他」自由入力モードを示すセレクタの内部値。 */
const OTHER_VALUE = "__other__";

type RepoSelectorProps = {
  /** API に送信する repo 文字列（"owner/name" 形式 or 空）が変化すると呼び出される。 */
  onChange: (repo: string) => void;
  disabled?: boolean;
};

/**
 * repo セレクタ: t-miura-024 配下から選択 + 「その他」自由入力 + 空（未指定）。
 *
 * - 未指定（デフォルト）→ note inbox + external/others
 * - t-miura-024/X 選択 → その repo に直接起票
 * - その他 + 自由入力 → note inbox + external/{owner}-{name}（空なら external/others）
 */
export function RepoSelector({ onChange, disabled }: RepoSelectorProps) {
  const [repos, setRepos] = useState<RepoEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selection, setSelection] = useState<string>("");
  const [otherRepo, setOtherRepo] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/repos")
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

  function handleSelectionChange(next: string): void {
    setSelection(next);
    if (next === OTHER_VALUE) {
      onChange(otherRepo);
    } else if (next === "") {
      onChange("");
    } else {
      onChange(next);
    }
  }

  function handleOtherChange(next: string): void {
    setOtherRepo(next);
    onChange(next);
  }

  const isOther = selection === OTHER_VALUE;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Select
          value={selection}
          onValueChange={handleSelectionChange}
          disabled={disabled || loading}
        >
          <SelectTrigger className="w-full" aria-label="起票先リポジトリ">
            <SelectValue placeholder={loading ? "読み込み中…" : "リポジトリを選択"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">指定しない（note inbox へ）</SelectItem>
            {repos.map((repo) => (
              <SelectItem key={repo.fullName} value={repo.fullName}>
                {repo.fullName}
              </SelectItem>
            ))}
            <SelectItem value={OTHER_VALUE}>その他（自由入力）</SelectItem>
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
          onChange={(event) => handleOtherChange(event.target.value)}
          disabled={disabled}
        />
      )}
    </div>
  );
}
