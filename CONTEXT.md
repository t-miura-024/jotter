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
`t-miura-024/note`。外部 repo 指定・repo 未指定の draft Issue を受け取る固定の集約先。
_Avoid_: inbox

**external label**:
note inbox に起票された Issue の由来を示す label。`external/{owner}-{name}`（外部 repo 指定）または `external/others`（repo 未指定）。
_Avoid_: source label
