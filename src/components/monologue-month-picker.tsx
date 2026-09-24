import { useState } from "react";

import { Calendar, ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type MonologueMonthPickerProps = {
  /** 対象月（YYYY-MM）。 */
  value: string;
  onChange: (month: string) => void;
  disabled?: boolean;
};

function parseYearMonth(value: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

function formatYearMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function shiftMonth(value: string, delta: number): string | null {
  const parsed = parseYearMonth(value);
  if (!parsed) return null;
  const total = parsed.year * 12 + (parsed.month - 1) + delta;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return formatYearMonth(year, month);
}

/** JST の今月（YYYY-MM）。「今月に戻る」の基準。 */
function currentMonthJST(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}`;
}

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

/** 対象月の選択 UI（前後月ボタン＋モーダルの月グリッド）。 */
export function MonologueMonthPicker({ value, onChange, disabled }: MonologueMonthPickerProps) {
  const parsed = parseYearMonth(value);
  const [open, setOpen] = useState(false);
  const [viewingYear, setViewingYear] = useState<number>(
    () => parsed?.year ?? Number(currentMonthJST().slice(0, 4)),
  );

  function handleOpenChange(next: boolean): void {
    setOpen(next);
    if (next) {
      const current = parseYearMonth(value);
      if (current) setViewingYear(current.year);
    }
  }

  function move(delta: number): void {
    const next = shiftMonth(value, delta);
    if (next) onChange(next);
  }

  function selectMonth(month: number): void {
    onChange(formatYearMonth(viewingYear, month));
    setOpen(false);
  }

  function backToCurrentMonth(): void {
    onChange(currentMonthJST());
    setOpen(false);
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        aria-label="前月へ"
        disabled={disabled}
        onClick={() => move(-1)}
      >
        <ChevronLeft aria-hidden />
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="outline"
            aria-label={
              parsed ? `対象月を選択（現在${parsed.year}年${parsed.month}月）` : "対象月を選択"
            }
            disabled={disabled}
          >
            <Calendar aria-hidden />
            {parsed ? `${parsed.year}年${parsed.month}月` : "対象月を選択"}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>対象月を選択</DialogTitle>
          </DialogHeader>

          <div className="flex items-center justify-between">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="前の年へ"
              onClick={() => setViewingYear((year) => year - 1)}
            >
              <ChevronLeft aria-hidden />
            </Button>
            <p aria-live="polite" className="text-base font-medium">
              {viewingYear}年
            </p>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="次の年へ"
              onClick={() => setViewingYear((year) => year + 1)}
            >
              <ChevronRight aria-hidden />
            </Button>
          </div>

          <div
            className="grid grid-cols-3 gap-2"
            role="group"
            aria-label={`${viewingYear}年の月を選択`}
          >
            {MONTHS.map((month) => {
              const selected = parsed?.year === viewingYear && parsed?.month === month;
              return (
                <Button
                  key={month}
                  type="button"
                  variant={selected ? "default" : "outline"}
                  aria-pressed={selected}
                  onClick={() => selectMonth(month)}
                >
                  {month}月
                </Button>
              );
            })}
          </div>

          <Button type="button" variant="ghost" onClick={backToCurrentMonth}>
            <RotateCcw aria-hidden />
            今月に戻る
          </Button>
        </DialogContent>
      </Dialog>

      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        aria-label="次月へ"
        disabled={disabled}
        onClick={() => move(1)}
      >
        <ChevronRight aria-hidden />
      </Button>
    </div>
  );
}
