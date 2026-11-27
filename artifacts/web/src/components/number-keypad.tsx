import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Delete, X, Lock } from "lucide-react";

/**
 * Number pad for picking lottery numbers, 1-90.
 *
 * Built for one-handed use on a phone: every key is at least 44px, the grid
 * reflows by available width rather than a fixed column count, and the
 * selection, backspace and submit all sit within thumb reach at the bottom.
 *
 * The selection is strict. It stops at the bet type's count, and a tap past
 * it never replaces an earlier pick: a writer looking at the customer, not
 * the screen, must not have a number swapped out from under them. Taking a
 * number out is always deliberate - its chip, backspace or clear. A repeat
 * tap on a number already picked (or one held elsewhere, like the banker)
 * changes nothing either; the key and its chip pulse so the writer sees why.
 */

export interface NumberKeypadProps {
  selected: number[];
  onChange: (next: number[]) => void;
  /** How many numbers this bet type needs; drives the counter and submit state. */
  required?: number;
  /** Lower and upper bound when the count is a range rather than fixed. */
  min?: number;
  max?: number;
  /**
   * Numbers already used elsewhere on this bet - the banker, for the
   * against-numbers pad. Shown marked and cannot be picked here.
   */
  reserved?: number[];
  /** What to call a reserved number on its key, e.g. "Banker". */
  reservedLabel?: string;
  onSubmit?: () => void;
  /**
   * What sits beside backspace and clear. Left out, it is the pad's own
   * submit button; a node takes its place (the bet page puts the amount
   * there); false leaves just backspace and clear.
   */
  action?: ReactNode | false;
  submitLabel?: string;
  submitting?: boolean;
  disabled?: boolean;
}

const NUMBERS = Array.from({ length: 90 }, (_, i) => i + 1);
const PULSE_MS = 650;

export function NumberKeypad({
  selected,
  onChange,
  required,
  min,
  max,
  reserved = [],
  reservedLabel = "In use",
  onSubmit,
  action,
  submitLabel = "Place Bet",
  submitting = false,
  disabled = false,
}: NumberKeypadProps) {
  const lower = min ?? required;
  const upper = max ?? required;
  const atLimit = upper !== undefined && selected.length >= upper;

  /*
   * The quiet feedback. `pulse` is the number whose key and chip flash after a
   * repeat tap; `full` makes the counter flash after a tap on a full pad. Both
   * clear themselves, and a fresh tap restarts the animation.
   */
  const [pulse, setPulse] = useState<{ n: number; seq: number } | null>(null);
  const [full, setFull] = useState(0);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
  const flashNumber = (n: number) => {
    const seq = Date.now();
    setPulse({ n, seq });
    timers.current.push(window.setTimeout(() => setPulse((p) => (p?.seq === seq ? null : p)), PULSE_MS));
  };
  const flashFull = () => {
    const seq = Date.now();
    setFull(seq);
    timers.current.push(window.setTimeout(() => setFull((f) => (f === seq ? 0 : f)), PULSE_MS));
  };

  const tap = (n: number) => {
    if (disabled) return;
    // Already picked, or held elsewhere on this bet: say so, change nothing.
    if (selected.includes(n) || reserved.includes(n)) {
      flashNumber(n);
      return;
    }
    // Full: the picks are locked until the writer removes one.
    if (atLimit) {
      flashFull();
      return;
    }
    onChange([...selected, n]);
  };

  const remove = (n: number) => {
    if (disabled) return;
    onChange(selected.filter((x) => x !== n));
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

  const counter =
    lower !== undefined
      ? lower === upper
        ? `${selected.length} / ${lower}`
        : `${selected.length} of ${lower}–${upper ?? "∞"}`
      : `${selected.length}`;

  return (
    <div className="space-y-3">
      {/* Selections, in the order they were picked. Each chip removes itself. */}
      <div className="rounded-xl border bg-muted/30 px-3 py-2.5">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] uppercase tracking-wide font-bold text-muted-foreground">
            Selections
          </span>
          <span
            aria-live="polite"
            className={[
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums transition-colors",
              full
                ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 animate-[keypad-nudge_0.35s_ease-in-out]"
                : atLimit
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground",
            ].join(" ")}
          >
            {atLimit && <Lock className="h-3 w-3" />}
            {counter} selected
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5 min-h-[2.25rem] items-center">
          {selected.length === 0 ? (
            <span className="text-xs text-muted-foreground">Tap numbers below to pick.</span>
          ) : (
            selected.map((n) => (
              <button
                key={n}
                type="button"
                disabled={disabled}
                onClick={() => remove(n)}
                aria-label={`Remove ${n}`}
                title="Tap to remove"
                className={[
                  "group inline-flex items-center gap-1 h-9 min-w-[2.25rem] pl-2 pr-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-bold font-mono tabular-nums transition-shadow",
                  pulse?.n === n ? "ring-2 ring-amber-400 ring-offset-1 ring-offset-background animate-pulse" : "",
                ].join(" ")}
              >
                {String(n).padStart(2, "0")}
                <X className="h-3 w-3 opacity-60 group-hover:opacity-100" />
              </button>
            ))
          )}
        </div>
        {/* Said once, quietly, only when it matters. */}
        <p
          className={[
            "mt-1.5 text-[11px] leading-snug transition-colors",
            full ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground",
            atLimit ? "" : "hidden",
          ].join(" ")}
        >
          {upper === 1 ? "Number picked." : "All numbers picked."} Remove one, or clear, to change.
        </p>
      </div>

      {/* 1-90. auto-fill so the row count follows the screen width. */}
      <div
        className="grid gap-1.5"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(2.75rem, 1fr))" }}
      >
        {NUMBERS.map((n) => {
          const isOn = selected.includes(n);
          const isReserved = !isOn && reserved.includes(n);
          const locked = atLimit && !isOn && !isReserved;
          const pulsing = pulse?.n === n;
          return (
            <button
              key={n}
              type="button"
              disabled={disabled}
              aria-pressed={isOn}
              aria-disabled={locked || isReserved || undefined}
              aria-label={isReserved ? `Number ${n} (${reservedLabel})` : `Number ${n}`}
              title={isReserved ? reservedLabel : isOn ? "Already picked" : undefined}
              onClick={() => tap(n)}
              className={[
                "relative h-11 rounded-full text-sm font-bold font-mono tabular-nums border transition-colors",
                "select-none touch-manipulation active:scale-95",
                isOn
                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                  : isReserved
                    ? "bg-amber-50 text-amber-700 border-amber-300 border-dashed dark:bg-amber-950/30 dark:text-amber-300"
                    : locked
                      ? "bg-background text-foreground/35 border-border/40"
                      : "bg-background text-foreground border-border/70 hover:bg-muted",
                pulsing ? "ring-2 ring-amber-400 ring-offset-1 ring-offset-background animate-pulse" : "",
                disabled ? "opacity-50 pointer-events-none" : "",
              ].join(" ")}
            >
              {String(n).padStart(2, "0")}
              {isReserved && (
                <span className="absolute -top-1 -right-1 h-3.5 min-w-3.5 rounded-full bg-amber-500 text-[8px] leading-3.5 text-white px-0.5">
                  {reservedLabel.charAt(0)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Backspace, clear, and the submit button or whatever replaces it */}
      <div className={action === false ? "grid grid-cols-2 gap-2" : "grid grid-cols-4 gap-2"}>
        <Button
          type="button"
          variant="outline"
          className="h-12 rounded-xl"
          onClick={backspace}
          disabled={disabled || selected.length === 0}
          aria-label="Delete last selection"
        >
          <Delete className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-12 rounded-xl"
          onClick={clear}
          disabled={disabled || selected.length === 0}
          aria-label="Clear all selections"
        >
          <X className="h-4 w-4" />
        </Button>
        {action === undefined ? (
          <Button
            type="button"
            className="h-12 rounded-xl col-span-2 font-bold tracking-wide"
            onClick={onSubmit}
            disabled={disabled || submitting || !complete || !onSubmit}
          >
            {submitting ? "Placing…" : submitLabel}
          </Button>
        ) : action === false ? null : (
          <div className="col-span-2">{action}</div>
        )}
      </div>
    </div>
  );
}
