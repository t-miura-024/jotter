---
status: accepted
---

# repo stats を集約 endpoint と Cloudflare Cache API で提供する

repo sidebar は全内部 repo の `draft` / `refined` / `in-progress` / `done` / `unregistered` 件数を同時に表示する。Project 登録済み Status は Project items から解決できるが、open Issue だけを数え、Project 未登録の Issue を正確に算出するには repo ごとの open な `kind/plan` Issue 取得も必要になる。repo ごとに独立して Project items を取得すると GitHub API 呼び出しが重複する。

`GET /api/repo-stats` を設け、Project items は GraphQL で一度だけ全ページ取得し、取得時点の全内部 repo の open な `kind/plan` Issue は REST で並列取得して Status を集計する。repo の増減は自動で反映する。結果は Cloudflare Cache API で数分間キャッシュし、手動リフレッシュと jot 起票成功時は cache bypass で再取得する。`GET /api/repos` には集計を混ぜず、軽量な repo 一覧取得の責務を維持する。

通常表示の GitHub API 負荷を抑えながら、Project に未登録の Issue を含む正確な件数を提供できる。一方で短い期間は表示が古くなり得るため、明示操作では強制更新する。stats 取得失敗は repo 選択から分離し、件数を `–` として再取得導線を提供する。

## Considered Options

- `/api/repos` に件数集計を含める: repo navigation まで重くなり、stats 障害時の縮退ができないため却下
- repo ごとに stats endpoint を呼ぶ: Project items の取得が重複し、sidebar 初期表示の request 数も増えるため却下
- クライアントキャッシュだけを使う: セッションをまたいだ GitHub API 負荷を抑えられず、全 repo 集計には不十分なため却下
