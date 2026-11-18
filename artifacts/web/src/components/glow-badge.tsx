import { cn } from "@/lib/utils";

/**
 * A glowing badge for the menu: a dot ringed by a slow pulse, with an
 * optional count inside a pill. The dotted ring keeps it readable on the dark
 * sidebar and on the light header alike, and the motion stops for anyone who
 * has asked their system for reduced motion.
 */
export function GlowBadge({
  count, tone = "rose", label, className,
}: {
  count?: number;
  tone?: "rose" | "emerald" | "amber";
  label: string;
  className?: string;
}) {
  const tones = {
    rose: { dot: "bg-rose-500", ring: "border-rose-400/80", glow: "shadow-[0_0_10px_2px_rgba(244,63,94,0.65)]" },
    emerald: { dot: "bg-emerald-400", ring: "border-emerald-300/80", glow: "shadow-[0_0_10px_2px_rgba(52,211,153,0.65)]" },
    amber: { dot: "bg-amber-400", ring: "border-amber-300/80", glow: "shadow-[0_0_10px_2px_rgba(251,191,36,0.65)]" },
  }[tone];
  const hasCount = typeof count === "number" && count > 0;
  return (
    <span role="status" aria-label={label} title={label} className={cn("pointer-events-none inline-flex items-center justify-center", className)}>
      <span className="relative inline-flex items-center justify-center">
        <span aria-hidden className={cn("absolute rounded-full border-2 border-dotted motion-safe:animate-[spin_6s_linear_infinite]", tones.ring, hasCount ? "-inset-[5px]" : "-inset-[5px]")} />
        <span aria-hidden className={cn("absolute inset-0 rounded-full opacity-60 motion-safe:animate-ping", tones.dot)} />
        {hasCount ? (
          <span className={cn("relative min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-black leading-5 text-center text-white tabular-nums", tones.dot, tones.glow)}>
            {count! > 99 ? "99+" : count}
          </span>
        ) : (
          <span className={cn("relative h-2.5 w-2.5 rounded-full", tones.dot, tones.glow)} />
        )}
      </span>
    </span>
  );
}
