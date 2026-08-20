import { Skeleton } from "@/components/ui/skeleton";

/**
 * repo sidebar / Drawer 用スケルトン（grill-map R2-Q7）。
 * repo 行 5 本（repo名 + inbox badge は1本目のみ示唆 + StatusCounts 5個）を固定で描画。
 */
export function RepoNavSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-2">
      <span role="status" className="sr-only">
        リポジトリ一覧を読み込み中…
      </span>
      <div className="flex items-center justify-between px-1" aria-hidden>
        <Skeleton className="h-3 w-10" />
      </div>
      <ul className="flex flex-col gap-1" aria-hidden>
        {[0, 1, 2, 3, 4].map((idx) => (
          <li key={idx} className="flex flex-col gap-1 rounded-lg px-2 py-1.5">
            <span className="flex items-center justify-between gap-2">
              <Skeleton className="h-3.5 w-20" />
              {idx === 0 && <Skeleton className="h-4 w-7 rounded-full" />}
            </span>
            <span className="flex items-center gap-1.5">
              {[0, 1, 2, 3, 4].map((dot) => (
                <span key={dot} className="flex items-center gap-0.5">
                  <Skeleton className="size-3 rounded-full" />
                  <Skeleton className="h-3 w-3" />
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** MobileRepoButton の loading 置換用スケルトン（h-9 のボタン矩形） */
export function MobileRepoButtonSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite" className="flex min-w-0 flex-1 md:hidden">
      <span role="status" className="sr-only">
        リポジトリ一覧を読み込み中…
      </span>
      <Skeleton className="h-9 w-full rounded-lg" aria-hidden />
    </div>
  );
}

/** stats 部分だけのスケルトン（repo 行は確定済みだが stats 未取得のフォールバック用） */
export function RepoStatsSkeleton() {
  return (
    <span aria-hidden className="flex items-center gap-1.5">
      {[0, 1, 2, 3, 4].map((dot) => (
        <span key={dot} className="flex items-center gap-0.5">
          <Skeleton className="size-3 rounded-full" />
          <Skeleton className="h-3 w-3" />
        </span>
      ))}
    </span>
  );
}
