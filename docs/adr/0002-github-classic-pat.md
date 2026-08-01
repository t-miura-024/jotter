---
status: accepted
---

# GitHub 連携を Classic PAT（repo+project）で実装する

Worker からの GitHub 操作（Issue/label 作成、ProjectV2 追加）は、Classic PAT（`repo` + `project` scope）を Cloudflare secret として用いる。Fine-grained PAT はリポジトリ単位の再付与が必要で動的な repo 候補一覧と相性が悪く、GitHub App は個人ツールには過剰なため不採用。権限は広めだが、Cloudflare Access で本人しか到達できない前提で許容する。
