import { Button } from "@/components/ui/button";
import { Delete, X } from "lucide-react";

/**
 * Number pad for picking lottery numbers, 1-90.
 *
 * Built for one-handed use on a phone: every key is at least 44px, the grid
 * reflows by available width rather than a fixed column count, and the
 * selection, backspace and submit all sit within thumb reach at the bottom.
 */

export interface NumberKeypadProps {
  selected: number[];
  onChange: (next: number[]) => void;
  /** How many numbers this bet type needs; drives the counter and submit state. */
  required?: number;
  /** Lower and upper bound when the count is a range rather than fixed. */
  min?: number;
  max?: number;
  onSubmit?: () => void;
  submitLabel?: string;
  submitting?: boolean;
  disabled?: boolean;
}

const NUMBERS = Array.from({ length: 90 }, (_, i) => i + 1);

export function NumberKeypad({
  selected,
  onChange,
  required,
  min,
  max,
  onSubmit,
  submitLabel = "Place Bet",
  submitting = false,
  disabled = false,
}: NumberKeypadProps) {
  const lower = min ?? required;
  const upper = max ?? required;
  const atLimit = upper !== undefined && selected.length >= upper;

  const toggle = (n: number) => {
    if (disabled) return;
    if (selected.includes(n)) {
      onChange(selected.filter((x) => x !== n));
      return;
    }
    // Silently ignoring a tap at the limit feels broken; drop the oldest pick
    // so the pad keeps responding and the newest tap is always honoured.
    if (atLimit) {
      onChange([...selected.slice(1), n]);
      return;
    }
    onChange([...selected, n]);
  };

  const backspace = () => {
    if (disabled || selected.length === 0) return;
    onChange(selected.slice(0, -1));
  };

  const clear = () => {
    if (disabled) return;
    onChange([]);
  };

  const complete =
    lower === undefined
      ? selected.length > 0
      : selected.length >= lower && (upper === undefined || selected.length <= upper);

  return (
    <div className="space-y-3">
      {/* Selections, in the order they were picked */}
      <div className="rounded-xl border bg-muted/30 px-3 py-2.5">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] uppercase tracking-wide font-bold text-muted-foreground">
            Selections
          </span>
          <span className="text-[11px] font-bold tabular-nums text-muted-foreground">
            {selected.length}
            {lower !== undefined
              ? lower === upper
                ? ` / ${lower}`
                : ` of ${lower}\u2013${upper ?? "\u221e"}`
              : ""}{" "}
            selected
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5 min-h-[2.25rem] items-center">
          {selected.length === 0 ? (
            <span className="text-xs text-muted-foreground">Tap numbers below to pick.</span>
          ) : (
            selected.map((n, i) => (
              <span
                key={`${n}-${i}`}
                className="inline-flex items-center justify-center h-9 min-w-[2.25rem] px-2 rounded-lg bg-primary text-primary-foreground text-sm font-bold font-mono tabular-nums"
              >
                {String(n).padStart(2, "0")}
              </span>
            ))
          )}
        </div>
      </div>

      {/* 1-90. auto-fill so the row count follows the screen width. */}
      <div
        className="grid gap-1.5"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(2.75rem, 1fr))" }}
      >
        {NUMBERS.map((n) => {
          const isOn = selected.includes(n);
          return (
            <button
              key={n}
              type="button"
              disabled={disabled}
              aria-pressed={isOn}
              aria-label={`Number ${n}`}
              onClick={() => toggle(n)}
              className={[
                "h-11 rounded-full text-sm font-bold font-mono tabular-nums border transition-colors",
                "select-none touch-manipulation active:scale-95",
                isOn
                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                  : "bg-background text-foreground border-border/70 hover:bg-muted",
                disabled ? "opacity-50 pointer-events-none" : "",
              ].join(" ")}
            >
              {String(n).padStart(2, "0")}
            </button>
          );
        })}
      </div>

      {/* Backspace, clear, submit */}
      <div className="grid grid-cols-4 gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-12"
          onClick={backspace}
          disabled={disabled || selected.length === 0}
          aria-label="Delete last selection"
        >
          <Delete className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-12"
          onClick={clear}
          disabled={disabled || selected.length === 0}
          aria-label="Clear all selections"
        >
          <X className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          className="h-12 col-span-2 font-bold tracking-wide"
          onClick={onSubmit}
          disabled={disabled || submitting || !complete || !onSubmit}
        >
          {submitting ? "Placing…" : submitLabel}
        </Button>
      </div>
    </div>
  );
}
