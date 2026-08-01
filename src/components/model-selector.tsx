import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * GUI で選択可能な Gemini モデル（ADR 0005 の fallback chain と同一集合）。
 * value が /api/submit へ preferredModel として送信される。
 */
export const MODEL_OPTIONS = [
  { value: "gemini-flash-latest", label: "gemini-flash-latest", isDefault: true },
  { value: "gemini-flash-lite-latest", label: "gemini-flash-lite-latest", isDefault: false },
  { value: "gemini-pro-latest", label: "gemini-pro-latest", isDefault: false },
] as const;

/** 既定の優先モデル（スピード重視。サーバー側の既定順とも一致する）。 */
export const DEFAULT_MODEL = MODEL_OPTIONS[0].value;

type ModelSelectorProps = {
  value: string;
  onChange: (model: string) => void;
  disabled?: boolean;
};

/**
 * 優先モデルセレクタ。選択したモデルを先頭にした fallback chain で整形される。
 * 未送信時はサーバー側でも flash-latest 優先（buildModelChain）なので、
 * GUI の初期値と挙動が一致する。
 */
export function ModelSelector({ value, onChange, disabled }: ModelSelectorProps) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="w-full font-mono text-xs" aria-label="優先モデル">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {MODEL_OPTIONS.map((model) => (
          <SelectItem key={model.value} value={model.value}>
            <span className="font-mono text-xs">{model.label}</span>
            {model.isDefault && (
              <span className="text-xs text-muted-foreground">（デフォルト）</span>
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
