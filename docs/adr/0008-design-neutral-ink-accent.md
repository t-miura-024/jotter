---
status: accepted
---

# デザインを shadcn 無彩色 + 単一インクアクセント + light/dark に固定

kozo-share と同じ shadcn ニュートラル無彩色ベースに、jotter 専用のアクセント 1 色（インク青緑 = 走り書きのインク）だけを差し、light/dark に対応する。textarea を主役に一点集中し、focus/送信/成功の静かな motion で手触りを出す。表現寄り（グラデーション/動きの前面化）は「素早く jot する」本質と逆行するため不採用。フロントエンドの設計言語を固定する決定。

表示書体（ワードマーク / 見出し）は、独立した display 書体を追加せず、ADR 0004 の固定スタックである Geist の extrabold + tracking-tighter で表現する（`--font-heading` は `--font-sans` = Geist Variable を参照）。
