---
status: accepted
---

# plan list の repo 選択を内部 repo sidebar に限定する

現行 UI は閲覧対象と target repo を 1 つのプルダウンで兼ね、未指定・内部 repo・外部 repo を同じ選択モデルで扱っている。しかし Jotter の plan list は個人用の内部 repo だけを閲覧対象とし、外部 repo 指定は note inbox 上の external label 生成にしか必要ない。

plan list の repo 選択を内部 repo 専用の repo sidebar に変更し、note inbox を既定値かつ一覧の先頭にする。PC では固定左 sidebar、モバイルでは左から開く drawer とする。外部 repo 入力は note inbox 選択時の JotDialog に限定し、target repo ではなく external label の有無だけを決める。入力がなければ label を付けず、入力があれば `external/{owner}-{name}` を付ける。

これにより閲覧対象、target repo、外部由来情報の責務が分離される。一方で、外部 repo の plan list 閲覧、未指定選択、repo 選択 UI の自由入力、および `external/others` の新規付与は廃止する。既存 Issue の `external/others` label は変更しない。

## Considered Options

- 現行プルダウンへ Status 件数だけ追加する: 閲覧対象と外部由来情報の責務混在が残るため却下
- 外部 repo も sidebar に表示・入力可能にする: plan list の実際の利用範囲を超え、stats と navigation を複雑にするため却下
- 外部 repo 入力を常に JotDialog に表示する: 内部 repo への直接起票時には意味がなく、target repo との関係が曖昧になるため却下
