import { useEffect, useState } from "react";
import { formatTokenCount } from "@/lib/format";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SessionHudProps {
  usage?: {
    input?: number;
    output?: number;
    cache_read?: number;
    reasoning?: number;
    context_used?: number;
    context_max?: number;
    context_percent?: number;
    total?: number;
    cost_usd?: number;
    calls?: number;
    compressions?: number;
  };
  sessionStart?: string; // ISO timestamp
  model?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Colour thresholds mirror the TUI `ctxBarColor` logic. */
function barColor(pct: number): string {
  if (pct >= 95) return "bg-red-500";
  if (pct > 80) return "bg-orange-500";
  if (pct >= 50) return "bg-yellow-500";
  return "bg-emerald-500";
}

function barTextColor(pct: number): string {
  if (pct >= 95) return "text-red-400";
  if (pct > 80) return "text-orange-400";
  if (pct >= 50) return "text-yellow-400";
  return "text-emerald-400";
}

/** Clamp 0-100 and round to one decimal. */
function clampPct(v: number | undefined): number {
  if (v == null) return 0;
  return Math.round(Math.max(0, Math.min(100, v)) * 10) / 10;
}

/** Format seconds into a compact "Xm Ys" string. */
function fmtDuration(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SessionHud({ usage, sessionStart, model }: SessionHudProps) {
  const [elapsed, setElapsed] = useState<string | null>(null);

  // Live session timer — tick every second.
  useEffect(() => {
    if (!sessionStart) return;

    const start = new Date(sessionStart).getTime();
    if (Number.isNaN(start)) return;

    const tick = () => {
      const sec = (Date.now() - start) / 1000;
      setElapsed(fmtDuration(sec));
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [sessionStart]);

  // Nothing to show yet.
  if (!usage && !model && !sessionStart) return null;

  const pct = clampPct(usage?.context_percent);
  const hasBar = (usage?.context_max ?? 0) > 0;
  const hasCompressions =
    typeof usage?.compressions === "number" && usage.compressions > 0;
  const hasCost =
    typeof usage?.cost_usd === "number" && usage.cost_usd > 0;

  // Token breakdown — only show non-zero values.
  const tokens: { label: string; value: number; color: string }[] = [];
  if ((usage?.input ?? 0) > 0)
    tokens.push({ label: "in", value: usage!.input!, color: "text-blue-400" });
  if ((usage?.output ?? 0) > 0)
    tokens.push({ label: "out", value: usage!.output!, color: "text-fuchsia-400" });
  if ((usage?.cache_read ?? 0) > 0)
    tokens.push({ label: "cache", value: usage!.cache_read!, color: "text-cyan-400" });
  if ((usage?.reasoning ?? 0) > 0)
    tokens.push({ label: "think", value: usage!.reasoning!, color: "text-violet-400" });

  return (
    <div className="space-y-2 px-1 py-1 text-xs">
      {/* Model + timer row */}
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium text-muted-foreground">
          {model ? model.split("/").slice(-1)[0] : null}
        </span>

        <div className="flex shrink-0 items-center gap-2 text-muted-foreground">
          {hasCompressions && (
            <span
              className={
                usage!.compressions! >= 10
                  ? "text-red-400"
                  : usage!.compressions! >= 5
                    ? "text-yellow-400"
                    : "text-muted-foreground"
              }
            >
              cmp {usage!.compressions}
            </span>
          )}
          {hasCost && (
            <span className="font-mono">
              ${usage!.cost_usd!.toFixed(2)}
            </span>
          )}
          {elapsed && <span>{elapsed}</span>}
        </div>
      </div>

      {/* Context usage bar */}
      {hasBar && (
        <div className="space-y-0.5">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>
              {formatTokenCount(usage!.context_used!)} /{" "}
              {formatTokenCount(usage!.context_max!)}
            </span>
            <span className={barTextColor(pct)}>{pct}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/50">
            <div
              className={`h-full rounded-full transition-all duration-500 ${barColor(pct)}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {/* Token breakdown badges */}
      {tokens.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {tokens.map((tk) => (
            <span key={tk.label} className="inline-flex items-center gap-1">
              <span className="text-muted-foreground">{tk.label}</span>
              <span className={`font-mono ${tk.color}`}>
                {formatTokenCount(tk.value)}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
