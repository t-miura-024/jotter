---
status: accepted
---

# MonologueのGoogle連携はService Account＋専用カレンダー共有にする

Monologue専用カレンダーへの書込は Service Account（秘密鍵JSONはPages secret保持、サーバー側のみ使用）で行い、対象カレンダーIDはenv（例: `MONOLOGUE_CALENDAR_ID`）で指定する。対象GCアカウントはCloudflare AccessのGoogle IdPとは別物であり混同しない。

OAuth refresh token方式も可能だが、失効・ローテーション管理が残る。Service Accountはリフレッシュ管理不要でstateless方針（ADR 0006）と最も相性がよい。専用カレンダー化により一覧判別マーカーが不要になり、中の終日予定は全てMonologue扱いできる。終日予定（date指定）のtimeZoneはGoogle Calendar APIで無視されるため送らず、対象カレンダー自体のタイムゾーンをJST（Asia/Tokyo）にすること。
