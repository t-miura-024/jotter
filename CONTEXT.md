# Jotter

ブラウザから走り書き（jot）を送信し、LLM で整形して GitHub の draft 計画 Issue を自動起票する個人ツール。`mt plan draft` CLI の GUI 版。

## Language

**jot**:
テキストエリアから一度の送信で投げ込まれる生の走り書きテキスト 1 件。
_Avoid_: memo, note, draft

**draft Issue**:
`kind/plan` label + GitHub Project Status=`draft` で起票される計画 Issue。mt-plan が拾って refined へ昇格する起点。
_Avoid_: plan

**target repo**:
draft Issue が実際に作成されるリポジトリ。内部 repo（`t-miura-024/X`）か note inbox のいずれか。
_Avoid_: selected repo

**note inbox**:
`t-miura-024/note`。外部 repo 由来の draft Issue を受け取り、外部 repo 入力がない jot も直接起票できる既定の target repo。
_Avoid_: inbox, unspecified repo

**external label**:
note inbox に起票された Issue の外部 repo 由来を示す label。外部 repo が明示された場合のみ `external/{owner}-{name}` を付与する。`external/others` は新規付与しない。
_Avoid_: source label

**plan list**:
メイン画面。選択された repo のアクティブな計画 Issue を GitHub Project の Status 別にグルーピングして表示する。
_Avoid_: dashboard, board

**repo sidebar**:
内部 repo の選択と Status 別 Issue 件数の確認を行う plan list のナビゲーション。PC では固定左サイドバー、モバイルではドロワーとして表示する。
_Avoid_: repo selector, dropdown

**unregistered**:
`kind/plan` label を持ち open だが、GitHub Project に登録されていない計画 Issue のグループ。起票時の Project 連携は best-effort のため存在しうる。
_Avoid_: unknown, others
