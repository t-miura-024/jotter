---
status: accepted
---

# Gemini fallback をスピード重視（flash → flash-lite → pro）にする

fallback チェーンを `gemini-flash-latest → gemini-flash-lite-latest → gemini-pro-latest` の固定順にする。移植元 Issue の「賢いモデルから順にフォールバック」方針を意図的に転換する。jotter は「素早く登録できること」が本質のため、品質より速度を優先する。`-latest` エイリアスで最新安定版を追従し、GUI セレクタで優先（先頭）モデルを指定可能にする。
