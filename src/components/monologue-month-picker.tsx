import { Input } from "@/components/ui/input";

type MonologueMonthPickerProps = {
  /** 対象月（YYYY-MM）。 */
  value: string;
  onChange: (month: string) => void;
  disabled?: boolean;
};

/** 対象月の年月カレンダー入力（input type=month で最小実装）。 */
export function MonologueMonthPicker({ value, onChange, disabled }: MonologueMonthPickerProps) {
  return (
    <Input
      type="month"
      aria-label="対象月"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      className="w-auto"
    />
  );
}
