---
status: accepted
---

# Monologueのnote出力はmain直書き（PRなし）日次追記にする

`📝daily-note/YYYY-MM-DD.md` の `# 💬 Monologue` セクション末尾へ `- HH:MM`＋indent `###`＋indent箇条書きで追記し、Contents APIのsha付きPUT＋競合時再読込1回リトライで反映する。ファイル不存在時は `🔖template/📝daily-note/📝daily-note-template.md` を実行時取得して複製し今回分を追記する。

日々のメモ用途にPRフローは重く即時性を損なう。個人単独運用であり、main直書きの危険性より記録の軽さを優先する。判別はセクション配下の `###` 単位とし、追加マーカーでthino互換性を崩さない。
