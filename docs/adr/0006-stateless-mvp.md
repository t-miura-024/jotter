---
status: accepted
---

# MVP はステートレス（永続化 DB なし）にする

投稿履歴の永続化（D1 等）は行わず、fire-and-forget とする。履歴は起票先の GitHub（対象 repo または `t-miura-024/note`）に自然に残る。永続化は後から追加可能であり、MVP では「何を持たないか」を明示してスコープを絞る。
