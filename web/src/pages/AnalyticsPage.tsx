import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BarChart3,
  Brain,
  ChevronDown,
  Cpu,
  RefreshCw,
  TrendingUp,
  Trophy,
  Wrench,
} from "lucide-react";
import { api } from "@/lib/api";
import type {
  AnalyticsResponse,
  AnalyticsDailyEntry,
  AnalyticsModelEntry,
  AnalyticsSkillEntry,
  SkillActivityResponse,
  SkillActivityEntry,
} from "@/lib/api";
import { timeAgo } from "@/lib/utils";
import { Button } from "@nous-research/ui/ui/components/button";
import { Spinner } from "@nous-research/ui/ui/components/spinner";
import { Stats } from "@nous-research/ui/ui/components/stats";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@nous-research/ui/ui/components/badge";
import { usePageHeader } from "@/contexts/usePageHeader";
import { useI18n } from "@/i18n";
import { PluginSlot } from "@/plugins";

const PERIODS = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
] as const;

const DEFAULT_PAGE_SIZE = 15;

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCost(n: number): string {
  return `$${n.toFixed(2)}`;
}

function formatDate(day: string): string {
  try {
    const d = new Date(day + "T00:00:00");
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return day;
  }
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

function useTableSort<T>(
  data: T[],
  defaultKey: keyof T & string,
  defaultDir: "asc" | "desc" = "desc",
) {
  const [sortKey, setSortKey] = useState<string>(defaultKey);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(defaultDir);

  const sorted = useMemo(() => {
    return [...data].sort((a, b) => {
      const aVal = a[sortKey as keyof T];
      const bVal = b[sortKey as keyof T];
      // Nulls always last regardless of direction
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      if (aVal === bVal) return 0;
      const cmp = aVal > bVal ? 1 : -1;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir]);

  const toggle = useCallback(
    (key: string) => {
      if (key === sortKey) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDir("desc");
      }
    },
    [sortKey],
  );

  return { sorted, sortKey, sortDir, toggle };
}

function SortHeader({
  label,
  col,
  sortKey,
  sortDir,
  toggle,
  className,
}: {
  label: string;
  col: string;
  sortKey: string;
  sortDir: "asc" | "desc";
  toggle: (key: string) => void;
  className?: string;
}) {
  const active = col === sortKey;
  return (
    <th
      onClick={() => toggle(col)}
      className={`cursor-pointer select-none ${className ?? ""}`}
    >
      <span className="inline-flex items-center gap-1.5 rounded px-1 -mx-1 py-0.5 hover:bg-secondary/20 transition-colors">
        {label}
        {active ? (
          sortDir === "asc" ? (
            <ArrowUp className="h-3.5 w-3.5 text-foreground/80 shrink-0" />
          ) : (
            <ArrowDown className="h-3.5 w-3.5 text-foreground/80 shrink-0" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 text-muted-foreground/40 shrink-0" />
        )}
      </span>
    </th>
  );
}

// ---------------------------------------------------------------------------
// Pagination hook
// ---------------------------------------------------------------------------

function usePagination(pageSize = DEFAULT_PAGE_SIZE) {
  const [page, setPage] = useState(0);

  const reset = useCallback(() => setPage(0), []);

  const paginate = useCallback(
    <T,>(items: T[]): { pageItems: T[]; start: number; end: number; totalPages: number } => {
      const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
      const safePage = Math.min(page, totalPages - 1);
      const start = safePage * pageSize;
      const end = Math.min(start + pageSize, items.length);
      return { pageItems: items.slice(start, end), start, end, totalPages };
    },
    [page, pageSize],
  );

  return { page, setPage, reset, paginate };
}

function PaginationBar({
  total,
  start,
  end,
  totalPages,
  page,
  onPage,
}: {
  total: number;
  start: number;
  end: number;
  totalPages: number;
  page: number;
  onPage: (p: number) => void;
}) {
  const { t } = useI18n();
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  if (total <= DEFAULT_PAGE_SIZE) return null;

  const jump = () => {
    const n = parseInt(input, 10);
    if (!isNaN(n) && n >= 1 && n <= totalPages) {
      onPage(n - 1);
    }
    setInput("");
    inputRef.current?.blur();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { jump(); }
    if (e.key === "Escape") { setInput(""); inputRef.current?.blur(); }
  };

  return (
    <div className="flex items-center justify-between pt-3 mt-3 border-t border-border/50">
      <span className="text-xs text-muted-foreground">
        {t.analytics.showing
          .replace("{start}", String(start + 1))
          .replace("{end}", String(end))
          .replace("{total}", String(total))}
      </span>
      <div className="flex items-center gap-1.5">
        <Button
          size="xs"
          outlined
          disabled={page === 0}
          onClick={() => onPage(page - 1)}
        >
          {t.analytics.prev}
        </Button>
        {totalPages <= 7 ? (
          /* Few pages: show all page buttons */
          <div className="flex items-center gap-0.5">
            {Array.from({ length: totalPages }, (_, i) => (
              <button
                key={i}
                onClick={() => onPage(i)}
                className={`min-w-[1.75rem] h-6 text-xs rounded transition-colors ${
                  i === page
                    ? "bg-primary text-primary-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/30"
                }`}
              >
                {i + 1}
              </button>
            ))}
          </div>
        ) : (
          /* Many pages: show current/total + jump input */
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground tabular-nums">
              {page + 1} / {totalPages}
            </span>
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              value={input}
              onChange={(e) => setInput(e.target.value.replace(/\D/g, ""))}
              onKeyDown={handleKeyDown}
              onBlur={() => { if (!input) return; jump(); }}
              placeholder={String(page + 1)}
              className="w-12 h-6 text-xs text-center bg-secondary/30 border border-border rounded
                         text-foreground placeholder:text-muted-foreground/50
                         focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
            <Button size="xs" outlined disabled={!input} onClick={jump}>
              Go
            </Button>
          </div>
        )}
        <Button
          size="xs"
          outlined
          disabled={page >= totalPages - 1}
          onClick={() => onPage(page + 1)}
        >
          {t.analytics.next}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CollapsibleCard — wraps Card with collapse/expand in header
// ---------------------------------------------------------------------------

function CollapsibleCard({
  icon,
  title,
  children,
  defaultOpen = true,
  headerExtra,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  headerExtra?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Card>
      <CardHeader
        className="cursor-pointer select-none"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {icon}
            <CardTitle className="text-base">{title}</CardTitle>
            <ChevronDown
              className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${open ? "" : "-rotate-90"}`}
            />
          </div>
          {headerExtra}
        </div>
      </CardHeader>
      <CardContent style={{ display: open ? undefined : "none" }}>{children}</CardContent>
    </Card>
  );
}


function TokenBarChart({ daily }: { daily: AnalyticsDailyEntry[] }) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!containerRef.current || daily.length === 0) return;
    const el = containerRef.current;
    el.innerHTML = "";

    const data = daily.flatMap((d) => [
      { day: d.day, tokens: d.input_tokens ?? 0, type: t.analytics.input },
      { day: d.day, tokens: d.cache_read_tokens ?? 0, type: t.analytics.cacheReadTokens },
      { day: d.day, tokens: d.reasoning_tokens ?? 0, type: t.analytics.reasoningTokens },
      { day: d.day, tokens: d.output_tokens ?? 0, type: t.analytics.output },
    ]);

    const tokenColors: Record<string, string> = {
      [t.analytics.input]: "#64748b",
      [t.analytics.cacheReadTokens]: "#34d399",
      [t.analytics.reasoningTokens]: "#c084fc",
      [t.analytics.output]: "#fb923c",
    };

    const typeOrder = [t.analytics.input, t.analytics.cacheReadTokens, t.analytics.reasoningTokens, t.analytics.output];

    import("@observablehq/plot").then((Obs) => {
      if (!el.isConnected) return;
      const chart = Obs.plot({
        marks: [
          Obs.areaY(data, {
            x: "day",
            y: "tokens",
            fill: "type",
            curve: "monotone-x",
            sort: { reduce: "sum", reverse: true },
            tip: true,
          }),
          Obs.ruleY([0]),
        ],
        x: {
          tickRotate: -45,
          tickFormat: (d: string) => formatDate(d),
          label: null,
        },
        y: {
          grid: true,
          tickFormat: (d: number) => formatTokens(d),
          label: t.analytics.tokens,
        },
        color: {
          legend: true,
          domain: typeOrder,
          range: typeOrder.map((k) => tokenColors[k]),
        },
        width: el.clientWidth,
        height: 260,
        marginLeft: 55,
        marginRight: 12,
        marginTop: 8,
        marginBottom: 55,
        style: {
          background: "transparent",
          color: "var(--color-foreground, #ffe6cb)",
          fontSize: "11px",
        },
      });
      el.appendChild(chart);
    });
    return () => { el.innerHTML = ""; };
  }, [daily, t]);

  if (daily.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-base">{t.analytics.dailyTokenUsage}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div ref={containerRef} className="observable-plot-chart w-full overflow-hidden [&_svg]:max-w-full" />
      </CardContent>
    </Card>
  );
}

function DailyTable({ daily }: { daily: AnalyticsDailyEntry[] }) {
  const { t } = useI18n();
  const { sorted, sortKey, sortDir, toggle } = useTableSort(daily, "day", "desc");
  const { page, setPage, reset, paginate } = usePagination();

  // Reset page when sort changes or data changes
  useEffect(() => { reset(); }, [daily, reset]);

  if (daily.length === 0) return null;

  const { pageItems, start, end, totalPages } = paginate(sorted);

  return (
    <CollapsibleCard
      icon={<TrendingUp className="h-5 w-5 text-muted-foreground" />}
      title={t.analytics.dailyBreakdown}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground text-xs">
              <SortHeader label={t.analytics.date} col="day" sortKey={sortKey} sortDir={sortDir} toggle={toggle} className="text-left py-2 pr-4 font-medium" />
              <SortHeader label={t.sessions.title} col="sessions" sortKey={sortKey} sortDir={sortDir} toggle={toggle} className="text-right py-2 px-4 font-medium" />
              <SortHeader label={t.analytics.input} col="input_tokens" sortKey={sortKey} sortDir={sortDir} toggle={toggle} className="text-right py-2 px-4 font-medium" />
              <SortHeader label={t.analytics.output} col="output_tokens" sortKey={sortKey} sortDir={sortDir} toggle={toggle} className="text-right py-2 pl-4 font-medium" />
              <SortHeader label={t.analytics.cacheReadTokens} col="cache_read_tokens" sortKey={sortKey} sortDir={sortDir} toggle={toggle} className="text-right py-2 px-4 font-medium" />
              <SortHeader label={t.analytics.reasoningTokens} col="reasoning_tokens" sortKey={sortKey} sortDir={sortDir} toggle={toggle} className="text-right py-2 px-4 font-medium" />
              <SortHeader label={t.analytics.cost} col="estimated_cost" sortKey={sortKey} sortDir={sortDir} toggle={toggle} className="text-right py-2 pl-4 font-medium" />
            </tr>
          </thead>
          <tbody>
            {pageItems.map((d) => (
              <tr
                  key={d.day}
                  className="border-b border-border/50 hover:bg-secondary/20 transition-colors"
                >
                <td className="py-2 pr-4 font-medium">
                    {formatDate(d.day)}
                </td>
                <td className="text-right py-2 px-4 text-muted-foreground">
                    {d.sessions}
                </td>
                <td className="text-right py-2 px-4">
                    <span className="text-[var(--midground)]">
                        {formatTokens(d.input_tokens)}
                    </span>
                </td>
                <td className="text-right py-2 pl-4">
                    <span className="text-[var(--color-success)]">
                        {formatTokens(d.output_tokens)}
                    </span>
                </td>
                <td className="text-right py-2 px-4">
                    <span className="text-emerald-400">
                        {formatTokens(d.cache_read_tokens ?? 0)}
                    </span>
                </td>
                <td className="text-right py-2 px-4">
                    <span className="text-purple-400">
                        {formatTokens(d.reasoning_tokens ?? 0)}
                    </span>
                </td>
                <td className="text-right py-2 pl-4 text-muted-foreground">
                    {formatCost(d.estimated_cost ?? 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <PaginationBar
        total={sorted.length}
        start={start}
        end={end}
        totalPages={totalPages}
        page={page}
        onPage={setPage}
      />
    </CollapsibleCard>
  );
}

function ModelTable({ models }: { models: AnalyticsModelEntry[] }) {
  const { t } = useI18n();
  const { sorted, sortKey, sortDir, toggle } = useTableSort(models, "input_tokens", "desc");
  const { page, setPage, reset, paginate } = usePagination();

  useEffect(() => { reset(); }, [models, reset]);

  if (models.length === 0) return null;

  const { pageItems, start, end, totalPages } = paginate(sorted);

  return (
    <CollapsibleCard
      icon={<Cpu className="h-5 w-5 text-muted-foreground" />}
      title={t.analytics.perModelBreakdown}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground text-xs">
              <SortHeader label={t.analytics.model} col="model" sortKey={sortKey} sortDir={sortDir} toggle={toggle} className="text-left py-2 pr-4 font-medium" />
              <SortHeader label={t.sessions.title} col="sessions" sortKey={sortKey} sortDir={sortDir} toggle={toggle} className="text-right py-2 px-4 font-medium" />
              <SortHeader label={t.analytics.tokens} col="input_tokens" sortKey={sortKey} sortDir={sortDir} toggle={toggle} className="text-right py-2 pl-4 font-medium" />
              <SortHeader label={t.analytics.cacheHit} col="cache_read_tokens" sortKey={sortKey} sortDir={sortDir} toggle={toggle} className="text-right py-2 px-4 font-medium" />
              <SortHeader label={t.analytics.cacheMiss} col="cache_miss" sortKey={sortKey} sortDir={sortDir} toggle={toggle} className="text-right py-2 px-4 font-medium" />
              <SortHeader label={t.analytics.apiCalls} col="api_calls" sortKey={sortKey} sortDir={sortDir} toggle={toggle} className="text-right py-2 pl-4 font-medium" />
              <SortHeader label={t.analytics.estimatedCost} col="estimated_cost" sortKey={sortKey} sortDir={sortDir} toggle={toggle} className="text-right py-2 pl-4 font-medium" />
            </tr>
          </thead>
          <tbody>
            {pageItems.map((m) => (
              <tr
                key={m.model}
                className="border-b border-border/50 hover:bg-secondary/20 transition-colors"
              >
                <td className="py-2 pr-4">
                    <span className="font-mono-ui text-xs">{m.model}</span>
                </td>
                <td className="text-right py-2 px-4 text-muted-foreground">
                    {m.sessions}
                </td>
                <td className="text-right py-2 pl-4">
                    <span className="text-[var(--midground)]">
                        {formatTokens(m.input_tokens)}
                    </span>
                    {" / "}
                    <span className="text-[var(--color-success)]">
                        {formatTokens(m.output_tokens)}
                    </span>
                </td>
                <td className="text-right py-2 px-4">
                    <span className="text-emerald-400">
                        {formatTokens(m.cache_read_tokens ?? 0)}
                    </span>
                </td>
                <td className="text-right py-2 px-4">
                    <span className="text-muted-foreground">
                        {formatTokens(Math.max(0, (m.input_tokens ?? 0) - (m.cache_read_tokens ?? 0)))}
                    </span>
                </td>
                <td className="text-right py-2 px-4 text-muted-foreground">
                    {m.api_calls ?? 0}
                </td>
                <td className="text-right py-2 pl-4 text-muted-foreground">
                    {formatCost(m.estimated_cost ?? 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <PaginationBar
        total={sorted.length}
        start={start}
        end={end}
        totalPages={totalPages}
        page={page}
        onPage={setPage}
      />
    </CollapsibleCard>
  );
}

function SkillTable({ skills }: { skills: AnalyticsSkillEntry[] }) {
  const { t } = useI18n();
  const { sorted, sortKey, sortDir, toggle } = useTableSort(skills, "total_count", "desc");
  const { page, setPage, reset, paginate } = usePagination();

  useEffect(() => { reset(); }, [skills, reset]);

  if (skills.length === 0) return null;

  const { pageItems, start, end, totalPages } = paginate(sorted);

  return (
    <CollapsibleCard
      icon={<Brain className="h-5 w-5 text-muted-foreground" />}
      title={t.analytics.topSkills}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground text-xs">
              <SortHeader label={t.analytics.skill} col="skill" sortKey={sortKey} sortDir={sortDir} toggle={toggle} className="text-left py-2 pr-4 font-medium" />
              <SortHeader label={t.analytics.loads} col="view_count" sortKey={sortKey} sortDir={sortDir} toggle={toggle} className="text-right py-2 px-4 font-medium" />
              <SortHeader label={t.analytics.edits} col="manage_count" sortKey={sortKey} sortDir={sortDir} toggle={toggle} className="text-right py-2 px-4 font-medium" />
              <SortHeader label={t.analytics.total} col="total_count" sortKey={sortKey} sortDir={sortDir} toggle={toggle} className="text-right py-2 px-4 font-medium" />
              <SortHeader label={t.analytics.lastUsed} col="last_used_at" sortKey={sortKey} sortDir={sortDir} toggle={toggle} className="text-right py-2 pl-4 font-medium" />
            </tr>
          </thead>
          <tbody>
            {pageItems.map((skill) => (
              <tr
                key={skill.skill}
                className="border-b border-border/50 hover:bg-secondary/20 transition-colors"
              >
                <td className="py-2 pr-4">
                    <span className="font-mono-ui text-xs">{skill.skill}</span>
                </td>
                <td className="text-right py-2 px-4 text-muted-foreground">
                    {skill.view_count}
                </td>
                <td className="text-right py-2 px-4 text-muted-foreground">
                    {skill.manage_count}
                </td>
                <td className="text-right py-2 px-4">{skill.total_count}</td>
                <td className="text-right py-2 pl-4 text-muted-foreground">
                    {skill.last_used_at ? timeAgo(skill.last_used_at) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <PaginationBar
        total={sorted.length}
        start={start}
        end={end}
        totalPages={totalPages}
        page={page}
        onPage={setPage}
      />
    </CollapsibleCard>
  );
}

// ---------------------------------------------------------------------------
// Skill Activity Panel — usage stats + enable/disable management
// ---------------------------------------------------------------------------

function SkillActivityPanel({ days }: { days: number }) {
  const { t } = useI18n();
  const [data, setData] = useState<SkillActivityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [cleanupPreview, setCleanupPreview] = useState<{ count: number; names: string[] } | null>(null);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { page, setPage, reset, paginate } = usePagination(DEFAULT_PAGE_SIZE);

  const load = useCallback(() => {
    setLoading(true);
    api.getSkillActivity(days)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [days]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { reset(); setSelected(new Set()); }, [days, reset]);

  const handleToggle = async (name: string, enabled: boolean) => {
    setToggling(name);
    try {
      await api.toggleSkill(name, enabled);
      setData((prev) => prev ? {
        ...prev,
        skills: prev.skills.map((s) => s.name === name ? { ...s, enabled } : s),
        summary: {
          ...prev.summary,
          enabled_count: prev.summary.enabled_count + (enabled ? 1 : -1),
          disabled_count: prev.summary.disabled_count + (enabled ? -1 : 1),
        },
      } : null);
    } catch { /* ignore */ }
    setToggling(null);
  };

  const handleCleanupPreview = async () => {
    setCleanupLoading(true);
    try {
      const res = await api.autoCleanupSkills(days, true);
      setCleanupPreview({ count: res.count, names: res.would_disable ?? [] });
    } catch { /* ignore */ }
    setCleanupLoading(false);
  };

  const handleCleanupConfirm = async () => {
    setCleanupLoading(true);
    try {
      await api.autoCleanupSkills(days, false);
      setCleanupPreview(null);
      load();
    } catch { /* ignore */ }
    setCleanupLoading(false);
  };

  const batchToggle = async (enabled: boolean) => {
    const names = [...selected];
    setToggling("batch");
    await Promise.all(names.map((n) => api.toggleSkill(n, enabled)));
    setSelected(new Set());
    load();
    setToggling(null);
  };

  const toggleAll = () => {
    const filtered = statusFilter
      ? skills.filter((s) => matchFilter(s, statusFilter))
      : skills;
    const { pageItems } = paginate(filtered);
    const allSelected = pageItems.every((s) => selected.has(s.name));
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(pageItems.map((s) => s.name)));
    }
  };

  const matchFilter = (s: SkillActivityEntry, filter: string) => {
    if (filter === "enabled") return s.enabled;
    if (filter === "disabled") return !s.enabled;
    return s.status === filter;
  };

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      active: "bg-[var(--color-success)]/15 text-[var(--color-success)]",
      idle: "bg-[var(--color-warning)]/15 text-[var(--color-warning)]",
      never_used: "bg-muted text-muted-foreground",
    };
    const labels: Record<string, string> = {
      active: t.analytics.skillActive,
      idle: t.analytics.skillIdle,
      never_used: t.analytics.skillNeverUsed,
    };
    return <Badge tone="secondary" className={`text-[10px] px-1.5 ${colors[status] ?? ""}`}>{labels[status] ?? status}</Badge>;
  };

  if (loading && !data) return <Spinner className="mx-auto my-8 text-primary" />;
  if (!data) return null;

  const { summary, skills } = data;
  const filtered = statusFilter ? skills.filter((s) => matchFilter(s, statusFilter)) : skills;
  const { pageItems, start, end, totalPages } = paginate(filtered);
  const allPageSelected = pageItems.length > 0 && pageItems.every((s) => selected.has(s.name));

  return (
    <CollapsibleCard
      icon={<Brain className="h-5 w-5 text-muted-foreground" />}
      title={t.analytics.skillActivity}
      defaultOpen={true}
      headerExtra={
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {summary.never_used_count > 0 && (
            <>
              {cleanupPreview ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">
                    {t.analytics.skillCleanupPreview}: {cleanupPreview.count}
                  </span>
                  <Button size="sm" onClick={handleCleanupConfirm} disabled={cleanupLoading} prefix={cleanupLoading ? <Spinner /> : undefined}>
                    {t.analytics.skillCleanupConfirm}
                  </Button>
                  <Button size="sm" ghost onClick={() => setCleanupPreview(null)}>✕</Button>
                </div>
              ) : (
                <Button size="sm" outlined onClick={handleCleanupPreview} disabled={cleanupLoading} prefix={cleanupLoading ? <Spinner /> : undefined}>
                  {t.analytics.skillCleanup}
                </Button>
              )}
            </>
          )}
          <Button size="sm" outlined onClick={load} prefix={loading ? <Spinner /> : <RefreshCw />}>
            {t.common.refresh}
          </Button>
        </div>
      }
    >
      {/* Summary pills — clickable to filter */}
      <div className="flex flex-wrap gap-2 mb-4">
        {[
          { key: "active", label: t.analytics.skillActive, count: summary.active_count, color: "bg-[var(--color-success)]/15 text-[var(--color-success)]" },
          { key: "idle", label: t.analytics.skillIdle, count: summary.idle_count, color: "bg-[var(--color-warning)]/15 text-[var(--color-warning)]" },
          { key: "never_used", label: t.analytics.skillNeverUsed, count: summary.never_used_count, color: "bg-muted text-muted-foreground" },
          { key: "enabled", label: t.analytics.skillEnabled, count: summary.enabled_count, color: "bg-primary/15 text-primary" },
          { key: "disabled", label: "Disabled", count: summary.disabled_count, color: "bg-[var(--color-destructive)]/15 text-[var(--color-destructive)]" },
        ].map((pill) => {
          const active = statusFilter === pill.key;
          return (
            <span
              key={pill.key}
              onClick={() => { setStatusFilter(active ? null : pill.key); setSelected(new Set()); }}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium cursor-pointer select-none transition-all ${pill.color} ${active ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : "opacity-80 hover:opacity-100"}`}
            >
              {pill.count} {pill.label}
            </span>
          );
        })}
      </div>

      {/* Batch action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 mb-3 px-1">
          <span className="text-xs text-muted-foreground">{t.analytics.selected.replace("{count}", String(selected.size))}</span>
          <Button size="sm" outlined onClick={() => batchToggle(true)} disabled={toggling === "batch"}>
            {t.analytics.enableSelected}
          </Button>
          <Button size="sm" outlined onClick={() => batchToggle(false)} disabled={toggling === "batch"}>
            {t.analytics.disableSelected}
          </Button>
          <Button size="sm" ghost onClick={() => setSelected(new Set())}>
            {t.analytics.clearSelection}
          </Button>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground text-xs">
              <th className="py-2 pr-2 w-8">
                <input type="checkbox" checked={allPageSelected} onChange={toggleAll} className="cursor-pointer" />
              </th>
              <th className="text-left py-2 pr-2 font-medium">{t.analytics.skillEnabled}</th>
              <th className="text-left py-2 pr-2 font-medium">{t.analytics.skill}</th>
              <th className="text-left py-2 pr-2 font-medium">{t.analytics.skillStatus}</th>
              <th className="text-right py-2 px-2 font-medium">{t.analytics.loads}</th>
              <th className="text-right py-2 px-2 font-medium">{t.analytics.edits}</th>
              <th className="text-right py-2 px-2 font-medium">{t.analytics.total}</th>
              <th className="text-right py-2 pl-2 font-medium">{t.analytics.lastUsed}</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((s) => (
              <tr key={s.name} className="border-b border-border/50 hover:bg-secondary/20 transition-colors">
                <td className="py-2 pr-2 w-8">
                  <input
                    type="checkbox"
                    checked={selected.has(s.name)}
                    onChange={() => setSelected((prev) => {
                      const next = new Set(prev);
                      next.has(s.name) ? next.delete(s.name) : next.add(s.name);
                      return next;
                    })}
                    className="cursor-pointer"
                  />
                </td>
                <td className="py-2 pr-2">
                  <button
                    onClick={() => handleToggle(s.name, !s.enabled)}
                    disabled={toggling === s.name}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                      s.enabled
                        ? "bg-primary"
                        : "bg-muted-foreground/30"
                    } ${toggling === s.name ? "opacity-50" : ""}`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 rounded-full bg-card-foreground shadow-sm transition-transform ${s.enabled ? "translate-x-4.5" : "translate-x-0.5"}`} />
                  </button>
                </td>
                <td className="py-2 pr-2">
                  <span className="font-mono-ui text-xs">{s.name}</span>
                </td>
                <td className="py-2 pr-2">{statusBadge(s.status)}</td>
                <td className="text-right py-2 px-2 text-muted-foreground">{s.view_count}</td>
                <td className="text-right py-2 px-2 text-muted-foreground">{s.manage_count}</td>
                <td className="text-right py-2 px-2 font-medium">{s.total_count}</td>
                <td className="text-right py-2 pl-2 text-muted-foreground">
                  {s.last_used_at ? timeAgo(s.last_used_at) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <PaginationBar
        total={filtered.length}
        start={start}
        end={end}
        totalPages={totalPages}
        page={page}
        onPage={setPage}
      />
    </CollapsibleCard>
  );
}

function HourlyConsumptionChart({ hourly }: { hourly: Array<{ hour: number; model: string; input_tokens: number; output_tokens: number; cache_read_tokens: number; reasoning_tokens: number; sessions: number }> }) {
  const { t } = useI18n();
  const [viewMode, setViewMode] = useState<"token" | "model">("token");
  const [selectedModels, setSelectedModels] = useState<Set<string> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  if (!hourly || hourly.length === 0) return null;

  const allModels = useMemo(() => {
    const set = new Set<string>();
    hourly.forEach((h) => { if (h.model && h.model !== "unknown") set.add(h.model); });
    return [...set].sort();
  }, [hourly]);

  // Aggregate hourly totals for token-type view
  const hourlyTotals = useMemo(() => {
    const map = new Map<number, { input_tokens: number; output_tokens: number; cache_read_tokens: number; reasoning_tokens: number }>();
    const source = selectedModels ? hourly.filter((h) => selectedModels.has(h.model)) : hourly;
    source.forEach((h) => {
      const cur = map.get(h.hour) ?? { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, reasoning_tokens: 0 };
      cur.input_tokens += h.input_tokens;
      cur.cache_read_tokens += h.cache_read_tokens;
      cur.reasoning_tokens += h.reasoning_tokens;
      cur.output_tokens += h.output_tokens;
      map.set(h.hour, cur);
    });
    return Array.from(map.entries()).map(([hour, v]) => ({ hour, ...v })).sort((a, b) => a.hour - b.hour);
  }, [hourly, selectedModels]);

  const hasData = hourlyTotals.some((h) => h.input_tokens + h.output_tokens + h.cache_read_tokens + h.reasoning_tokens > 0);
  if (!hasData) return null;

  const toggleModel = (model: string) => {
    setSelectedModels((prev) => {
      if (!prev) return new Set([model]);
      const next = new Set(prev);
      next.has(model) ? next.delete(model) : next.add(model);
      return next.size === 0 ? null : next;
    });
  };

  // Token type stacked area chart
  useLayoutEffect(() => {
    if (viewMode !== "token" || !containerRef.current) return;
    const el = containerRef.current;
    el.innerHTML = "";

    const typeOrder = [t.analytics.input, t.analytics.cacheReadTokens, t.analytics.reasoningTokens, t.analytics.output];
    const tokenColors: Record<string, string> = {
      [t.analytics.input]: "#64748b",
      [t.analytics.cacheReadTokens]: "#34d399",
      [t.analytics.reasoningTokens]: "#c084fc",
      [t.analytics.output]: "#fb923c",
    };

    const data = hourlyTotals.flatMap((h) => [
      { hour: h.hour, tokens: h.input_tokens, type: t.analytics.input },
      { hour: h.hour, tokens: h.cache_read_tokens, type: t.analytics.cacheReadTokens },
      { hour: h.hour, tokens: h.reasoning_tokens, type: t.analytics.reasoningTokens },
      { hour: h.hour, tokens: h.output_tokens, type: t.analytics.output },
    ]);

    import("@observablehq/plot").then((Obs) => {
      if (!el.isConnected) return;
      const chart = Obs.plot({
        marks: [
          Obs.areaY(data, {
            x: "hour",
            y: "tokens",
            fill: "type",
            curve: "monotone-x",
            sort: { reduce: "sum", reverse: true },
            tip: true,
            fillOpacity: 0.75,
          }),
          Obs.ruleY([0]),
        ],
        x: {
          domain: [0, 23],
          ticks: [0, 3, 6, 9, 12, 15, 18, 21],
          tickFormat: (d: number) => `${d}:00`,
          label: null,
        },
        y: {
          grid: true,
          tickFormat: (d: number) => formatTokens(d),
          label: t.analytics.hourlyTokens,
        },
        color: {
          legend: true,
          domain: typeOrder,
          range: typeOrder.map((k) => tokenColors[k]),
        },
        width: el.clientWidth,
        height: 280,
        marginLeft: 55,
        marginRight: 12,
        marginTop: 8,
        marginBottom: 32,
        style: { background: "transparent", color: "var(--color-foreground, #ffe6cb)", fontSize: "11px" },
      });
      el.appendChild(chart);
    });
    return () => { el.innerHTML = ""; };
  }, [viewMode, hourlyTotals, t]);

  // Per-model stacked area chart
  useLayoutEffect(() => {
    if (viewMode !== "model" || !containerRef.current) return;
    const el = containerRef.current;
    el.innerHTML = "";

    const filtered = selectedModels ? hourly.filter((h) => selectedModels.has(h.model)) : hourly;
    const data = filtered.map((h) => ({
      hour: h.hour,
      tokens: h.input_tokens + h.output_tokens + h.cache_read_tokens + h.reasoning_tokens,
      model: h.model,
    }));

    const modelDomain = [...new Set(data.map((d) => d.model))].sort();
    const modelRange = modelDomain.map((_, i) => MODEL_COLORS[i % MODEL_COLORS.length]);

    import("@observablehq/plot").then((Obs) => {
      if (!el.isConnected) return;
      const chart = Obs.plot({
        marks: [
          Obs.areaY(data, {
            x: "hour",
            y: "tokens",
            fill: "model",
            curve: "monotone-x",
            tip: true,
            fillOpacity: 0.75,
          }),
          Obs.ruleY([0]),
        ],
        x: {
          domain: [0, 23],
          ticks: [0, 3, 6, 9, 12, 15, 18, 21],
          tickFormat: (d: number) => `${d}:00`,
          label: null,
        },
        y: {
          grid: true,
          tickFormat: (d: number) => formatTokens(d),
          label: t.analytics.hourlyTokens,
        },
        color: {
          legend: true,
          domain: modelDomain,
          range: modelRange,
        },
        width: el.clientWidth,
        height: 280,
        marginLeft: 55,
        marginRight: 12,
        marginTop: 8,
        marginBottom: 32,
        style: { background: "transparent", color: "var(--color-foreground, #ffe6cb)", fontSize: "11px" },
      });
      el.appendChild(chart);
    });
    return () => { el.innerHTML = ""; };
  }, [viewMode, hourly, selectedModels, t]);

  return (
    <CollapsibleCard
      icon={<BarChart3 className="h-5 w-5 text-muted-foreground" />}
      title={t.analytics.hourlyConsumption}
      defaultOpen={true}
      headerExtra={
        <div className="flex flex-col gap-2" onClick={(e) => e.stopPropagation()}>
          {/* View mode toggle */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setViewMode("token")}
              className={`rounded-md px-2 py-0.5 text-[10px] font-medium cursor-pointer transition-all ${
                viewMode === "token"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >{t.analytics.hourlyTokens}</button>
            <button
              onClick={() => setViewMode("model")}
              className={`rounded-md px-2 py-0.5 text-[10px] font-medium cursor-pointer transition-all ${
                viewMode === "model"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >{t.analytics.model}</button>
          </div>
          {/* Model filter pills (model view) */}
          {viewMode === "model" && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                onClick={() => setSelectedModels(null)}
                className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium cursor-pointer transition-all ${!selectedModels ? "ring-2 ring-primary ring-offset-1 ring-offset-background text-foreground" : "text-muted-foreground hover:text-foreground opacity-60"}`}
              >All</span>
              {allModels.slice(0, 8).map((m) => {
                const active = selectedModels?.has(m) ?? false;
                return (
                  <span
                    key={m}
                    onClick={() => toggleModel(m)}
                    className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium cursor-pointer transition-all truncate max-w-[120px] ${active ? "ring-2 ring-primary ring-offset-1 ring-offset-background text-foreground" : "text-muted-foreground hover:text-foreground opacity-60"}`}
                    title={m}
                  >
                    <span className="w-1.5 h-1.5 rounded-sm shrink-0" style={{ backgroundColor: MODEL_COLORS[allModels.indexOf(m) % MODEL_COLORS.length] }} />
                    {m}
                  </span>
                );
              })}
              {allModels.length > 8 && <span className="text-[10px] text-muted-foreground">+{allModels.length - 8}</span>}
            </div>
          )}
        </div>
      }
    >
      <div ref={containerRef} className="observable-plot-chart w-full overflow-hidden [&_svg]:max-w-full" />
    </CollapsibleCard>
  );
}

const MODEL_COLORS = ["#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b", "#34d399", "#6366f1", "#14b8a6", "#fb923c"];

function ToolRanking({ tools }: { tools: Array<{ tool: string; count: number; percentage: number }> }) {
  const { t } = useI18n();
  if (!tools || tools.length === 0) return null;
  const top = [...tools].sort((a, b) => b.count - a.count).slice(0, 15);
  const maxCount = Math.max(top[0]?.count ?? 1, 1);
  return (
    <CollapsibleCard icon={<Wrench className="h-5 w-5 text-muted-foreground" />} title={t.analytics.topTools} defaultOpen={false}>
      <div className="flex flex-col gap-1.5">
        {top.map((item) => (
          <div key={item.tool} className="flex items-center gap-2 text-xs">
            <span className="font-mono-ui text-[11px] text-muted-foreground truncate shrink-0" style={{ maxWidth: "40%" }} title={item.tool}>{item.tool}</span>
            <div className="flex-1 min-w-0 h-4 bg-secondary/30 rounded-sm overflow-hidden">
              <div className="h-full bg-primary/60 rounded-sm" style={{ width: `${Math.max((item.count / maxCount) * 100, item.count > 0 ? 2 : 0)}%` }} />
            </div>
            <span className="tabular-nums text-foreground w-12 text-right shrink-0">{item.count}</span>
            <span className="tabular-nums text-muted-foreground w-12 text-right shrink-0">{item.percentage.toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </CollapsibleCard>
  );
}

function ActivityChart({ activity }: { activity: { by_day?: Array<{ day: string; count: number }>; by_hour?: Array<{ hour: number; count: number }>; busiest_day?: any; busiest_hour?: any; active_days?: number; max_streak?: number } }) {
  const { t } = useI18n();
  const dayRef = useRef<HTMLDivElement>(null);
  const hourRef = useRef<HTMLDivElement>(null);

  if (!activity || ((!activity.by_day || activity.by_day.length === 0) && (!activity.by_hour || activity.by_hour.length === 0))) return null;
  const byDay = activity.by_day ?? [];
  const byHour = activity.by_hour ?? [];

  // Day-of-week bar chart
  useLayoutEffect(() => {
    if (!dayRef.current || byDay.length === 0) return;
    const el = dayRef.current;
    el.innerHTML = "";
    const busiestDay = activity.busiest_day && typeof activity.busiest_day !== "string" ? activity.busiest_day.day : null;
    const data = byDay.map((d) => ({ day: d.day, count: d.count, busiest: d.day === busiestDay }));

    import("@observablehq/plot").then((Obs) => {
      if (!el.isConnected) return;
      const chart = Obs.plot({
        marks: [
          Obs.barY(data, { x: "day", y: "count", fill: "busiest", tip: true }),
          Obs.ruleY([0]),
        ],
        x: { label: null, tickRotate: 0 },
        y: { grid: true, label: null },
        color: {
          domain: [true, false],
          range: ["var(--color-primary, #3b82f6)", "var(--color-muted-foreground, #888)"],
          legend: false,
        },
        width: el.clientWidth,
        height: 180,
        marginLeft: 30,
        marginRight: 12,
        marginTop: 8,
        marginBottom: 28,
        style: { background: "transparent", color: "var(--color-foreground, #ffe6cb)", fontSize: "11px" },
      });
      el.appendChild(chart);
    });
    return () => { el.innerHTML = ""; };
  }, [byDay, activity.busiest_day]);

  // Hourly bar chart
  useLayoutEffect(() => {
    if (!hourRef.current || byHour.length === 0) return;
    const el = hourRef.current;
    el.innerHTML = "";

    import("@observablehq/plot").then((Obs) => {
      if (!el.isConnected) return;
      const chart = Obs.plot({
        marks: [
          Obs.barY(byHour, { x: "hour", y: "count", fill: "var(--color-primary, #3b82f6)", tip: true }),
          Obs.ruleY([0]),
        ],
        x: {
          domain: [0, 23],
          ticks: [0, 3, 6, 9, 12, 15, 18, 21],
          tickFormat: (d: number) => `${d}:00`,
          label: null,
        },
        y: { grid: true, label: null },
        width: el.clientWidth,
        height: 180,
        marginLeft: 30,
        marginRight: 12,
        marginTop: 8,
        marginBottom: 28,
        style: { background: "transparent", color: "var(--color-foreground, #ffe6cb)", fontSize: "11px" },
      });
      el.appendChild(chart);
    });
    return () => { el.innerHTML = ""; };
  }, [byHour]);

  return (
    <CollapsibleCard icon={<BarChart3 className="h-5 w-5 text-muted-foreground" />} title={t.analytics.activityPatterns} defaultOpen={false}>
      {byDay.length > 0 && (
        <div className="mb-2">
          <div className="text-xs font-medium text-muted-foreground mb-1">{t.analytics.byDayOfWeek}</div>
          <div ref={dayRef} className="observable-plot-chart w-full overflow-hidden [&_svg]:max-w-full" />
        </div>
      )}
      {byHour.length > 0 && (
        <div className="mb-4">
          <div className="text-xs font-medium text-muted-foreground mb-1">{t.analytics.byHour}</div>
          <div ref={hourRef} className="observable-plot-chart w-full overflow-hidden [&_svg]:max-w-full" />
        </div>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground pt-2 border-t border-border/50">
        <span>{t.analytics.busiestDay}: <span className="text-foreground font-medium">{activity.busiest_day ? (typeof activity.busiest_day === "string" ? activity.busiest_day : `${activity.busiest_day.day} (${activity.busiest_day.count})`) : "—"}</span></span>
        <span>{t.analytics.busiestHour}: <span className="text-foreground font-medium">{activity.busiest_hour ? (typeof activity.busiest_hour === "string" ? activity.busiest_hour : `${activity.busiest_hour.hour}:00 (${activity.busiest_hour.count})`) : "—"}</span></span>
        {activity.active_days != null && <span>{t.analytics.activeDays}: <span className="text-foreground font-medium">{activity.active_days}</span></span>}
        {activity.max_streak != null && <span>{t.analytics.maxStreak}: <span className="text-foreground font-medium">{activity.max_streak}</span></span>}
      </div>
    </CollapsibleCard>
  );
}

function NotableSessions({ sessions }: { sessions: Array<{ label: string; value: string; date: string }> }) {
  const { t } = useI18n();
  if (!sessions || sessions.length === 0) return null;
  return (
    <CollapsibleCard icon={<Trophy className="h-5 w-5 text-muted-foreground" />} title={t.analytics.notableSessions} defaultOpen={false}>
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
        {sessions.map((s, i) => (
          <Card key={i}><CardContent className="p-3">
            <div className="text-[11px] text-muted-foreground mb-1">{s.label}</div>
            <div className="text-lg font-semibold leading-tight">{s.value}</div>
            <div className="text-[10px] text-muted-foreground mt-1">{s.date}</div>
          </CardContent></Card>
        ))}
      </div>
    </CollapsibleCard>
  );
}

function PlatformBreakdown({ platforms }: { platforms: Array<{ platform: string; sessions: number; messages: number; total_tokens: number }> }) {
  const { t } = useI18n();
  if (!platforms || platforms.length <= 1) return null;
  return (
    <CollapsibleCard icon={<BarChart3 className="h-5 w-5 text-muted-foreground" />} title={t.analytics.platformBreakdown} defaultOpen={false}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-border text-muted-foreground text-xs">
            <th className="text-left py-2 pr-4 font-medium">{t.analytics.platforms}</th>
            <th className="text-right py-2 px-4 font-medium">{t.sessions.title}</th>
            <th className="text-right py-2 px-4 font-medium">{t.analytics.totalMessages}</th>
            <th className="text-right py-2 pl-4 font-medium">{t.analytics.tokens}</th>
          </tr></thead>
          <tbody>
            {[...platforms].sort((a, b) => b.sessions - a.sessions).map((p) => (
              <tr key={p.platform} className="border-b border-border/50 hover:bg-secondary/20 transition-colors">
                <td className="py-2 pr-4 font-mono-ui text-xs">{p.platform}</td>
                <td className="text-right py-2 px-4 text-muted-foreground">{p.sessions}</td>
                <td className="text-right py-2 px-4 text-muted-foreground">{p.messages}</td>
                <td className="text-right py-2 pl-4">{formatTokens(p.total_tokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CollapsibleCard>
  );
}

export default function AnalyticsPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { t } = useI18n();
  const { setAfterTitle, setEnd } = usePageHeader();

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .getAnalytics(days)
      .then(setData)
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [days]);

  useLayoutEffect(() => {
    const periodLabel =
      PERIODS.find((p) => p.days === days)?.label ?? `${days}d`;
    setAfterTitle(
      <span className="flex items-center gap-2">
        {loading && <Spinner className="shrink-0 text-base text-primary" />}
        <Badge tone="secondary" className="text-[10px]">
          {periodLabel}
        </Badge>
      </span>,
    );
    setEnd(
      <div className="flex w-full min-w-0 flex-wrap items-center justify-end gap-2 sm:gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {PERIODS.map((p) => (
            <Button
              key={p.label}
              type="button"
              size="sm"
              outlined={days !== p.days}
              onClick={() => setDays(p.days)}
            >
              {p.label}
            </Button>
          ))}
        </div>
        <Button
          type="button"
          size="sm"
          outlined
          onClick={load}
          disabled={loading}
          prefix={loading ? <Spinner /> : <RefreshCw />}
        >
          {t.common.refresh}
        </Button>
      </div>,
    );
    return () => {
      setAfterTitle(null);
      setEnd(null);
    };
  }, [days, loading, load, setAfterTitle, setEnd, t.common.refresh]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="flex flex-col gap-6">
      <PluginSlot name="analytics:top" />
      {loading && !data && (
        <div className="flex items-center justify-center py-24">
          <Spinner className="text-2xl text-primary" />
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="py-6">
            <p className="text-sm text-destructive text-center">{error}</p>
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardContent className="py-6">
                <Stats
                  items={[
                    {
                      label: t.analytics.totalTokens,
                      value: formatTokens(
                        data.totals.total_input + data.totals.total_output,
                      ),
                    },
                    {
                      label: t.analytics.input,
                      value: formatTokens(data.totals.total_input),
                    },
                    {
                      label: t.analytics.output,
                      value: formatTokens(data.totals.total_output),
                    },
                    {
                      label: t.analytics.totalSessions,
                      value: `${data.totals.total_sessions} (~${(data.totals.total_sessions / days).toFixed(1)}${t.analytics.perDayAvg})`,
                    },
                    {
                      label: t.analytics.apiCalls,
                      value: String(
                        data.totals.total_api_calls ??
                          data.daily.reduce((sum, d) => sum + d.sessions, 0),
                      ),
                    },
                    {
                      label: t.analytics.totalCost,
                      value: data.totals.total_actual_cost ? formatCost(data.totals.total_actual_cost) : data.totals.total_estimated_cost ? formatCost(data.totals.total_estimated_cost) : "$0.00",
                    },
                    ...(data.overview?.total_messages ? [{ label: t.analytics.totalMessages, value: String(data.overview.total_messages) }] : []),
                    ...(data.overview?.total_tool_calls ? [{ label: t.analytics.toolCalls, value: String(data.overview.total_tool_calls) }] : []),
                    ...(data.overview?.total_hours ? [{ label: t.analytics.totalHours, value: `${data.overview.total_hours.toFixed(1)}h` }] : []),
                    ...(data.overview?.avg_session_duration ? [{ label: t.analytics.avgSession, value: `${Math.round(data.overview.avg_session_duration / 60)}m` }] : []),
                  ]}
                />
              </CardContent>
            </Card>

            <TokenBarChart daily={data.daily} />
          </div>

          <DailyTable daily={data.daily} />
          <ModelTable models={data.by_model} />
          <SkillTable skills={data.skills.top_skills} />
          <SkillActivityPanel days={days} />
          <HourlyConsumptionChart hourly={data.hourly_tokens ?? []} />
          <ToolRanking tools={data.tools ?? []} />
          <ActivityChart activity={data.activity ?? {}} />
          <NotableSessions sessions={data.top_sessions ?? []} />
          <PlatformBreakdown platforms={data.platforms ?? []} />
        </>
      )}

      {data &&
        data.daily.length === 0 &&
        data.by_model.length === 0 &&
        data.skills.top_skills.length === 0 && (
          <Card>
            <CardContent className="py-12">
              <div className="flex flex-col items-center text-muted-foreground">
                <BarChart3 className="h-8 w-8 mb-3 opacity-40" />
                <p className="text-sm font-medium">{t.analytics.noUsageData}</p>
                <p className="text-xs mt-1 text-muted-foreground/60">
                  {t.analytics.startSession}
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      <PluginSlot name="analytics:bottom" />
    </div>
  );
}
