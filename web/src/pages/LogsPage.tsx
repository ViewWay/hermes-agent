import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
} from "react";
import { FileText, RefreshCw, Search } from "lucide-react";
import { api } from "@/lib/api";
import { Badge } from "@nous-research/ui/ui/components/badge";
import { Button } from "@nous-research/ui/ui/components/button";
import { FilterGroup, Segmented } from "@nous-research/ui/ui/components/segmented";
import { Spinner } from "@nous-research/ui/ui/components/spinner";
import { Switch } from "@nous-research/ui/ui/components/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/i18n";
import { usePageHeader } from "@/contexts/usePageHeader";
import { PluginSlot } from "@/plugins";

const FILES = ["agent", "errors", "gateway"] as const;
const LEVELS = ["ALL", "DEBUG", "INFO", "WARNING", "ERROR"] as const;
const COMPONENTS = ["all", "gateway", "agent", "tools", "cli", "cron"] as const;
const LINE_COUNTS = [50, 100, 200, 500] as const;

function classifyLine(line: string): "error" | "warning" | "info" | "debug" {
  const upper = line.toUpperCase();
  if (
    upper.includes("ERROR") ||
    upper.includes("CRITICAL") ||
    upper.includes("FATAL")
  )
    return "error";
  if (upper.includes("WARNING") || upper.includes("WARN")) return "warning";
  if (upper.includes("DEBUG")) return "debug";
  return "info";
}

const LINE_COLORS: Record<string, string> = {
  error: "text-destructive",
  warning: "text-warning",
  info: "text-foreground",
  debug: "text-muted-foreground/60",
};

const toOptions = <T extends string>(values: readonly T[]) =>
  values.map((v) => ({ value: v, label: v }));

export default function LogsPage() {
  const [file, setFile] = useState<(typeof FILES)[number]>("agent");
  const [level, setLevel] = useState<(typeof LEVELS)[number]>("ALL");
  const [component, setComponent] =
    useState<(typeof COMPONENTS)[number]>("all");
  const [lineCount, setLineCount] = useState<(typeof LINE_COUNTS)[number]>(100);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [useRegex, setUseRegex] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  const { setAfterTitle, setEnd } = usePageHeader();

  const fetchLogs = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .getLogs({ file, lines: lineCount, level, component })
      .then((resp) => {
        setLines(resp.lines);
        setTimeout(() => {
          if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
          }
        }, 50);
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [file, lineCount, level, component]);

  useLayoutEffect(() => {
    setAfterTitle(
      <span className="flex items-center gap-2">
        {loading && <Spinner className="shrink-0 text-base text-primary" />}
        <Badge tone="secondary" className="text-[10px]">
          {file} · {level} · {component}
        </Badge>
      </span>,
    );
    setEnd(
      <div className="flex w-full min-w-0 flex-wrap items-center justify-end gap-2 sm:gap-3">
        <div className="flex items-center gap-2">
          <Switch
            checked={autoRefresh}
            onCheckedChange={setAutoRefresh}
            id="logs-auto-refresh"
          />
          <Label htmlFor="logs-auto-refresh" className="text-xs cursor-pointer">
            {t.logs.autoRefresh}
          </Label>
          {autoRefresh && (
            <Badge tone="success" className="text-[10px]">
              <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
              {t.common.live}
            </Badge>
          )}
        </div>
        <Button
          type="button"
          size="sm"
          outlined
          onClick={fetchLogs}
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
  }, [
    autoRefresh,
    component,
    file,
    level,
    loading,
    setAfterTitle,
    setEnd,
    t.common.live,
    t.common.refresh,
    t.logs.autoRefresh,
    fetchLogs,
  ]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchLogs]);

  const filteredLines = useMemo(() => {
    if (!searchQuery.trim()) return lines;
    try {
      const re = useRegex
        ? new RegExp(searchQuery, "i")
        : new RegExp(searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      return lines.filter((line) => re.test(line));
    } catch {
      const lower = searchQuery.toLowerCase();
      return lines.filter((line) => line.toLowerCase().includes(lower));
    }
  }, [lines, searchQuery, useRegex]);

  return (
    <div className="flex flex-col gap-4">
      <PluginSlot name="logs:top" />
      <div
        role="toolbar"
        aria-label={t.logs.title}
        className="flex flex-wrap items-center gap-x-6 gap-y-2"
      >
        <FilterGroup label={t.logs.file}>
          <Segmented
            value={file}
            onChange={setFile}
            options={toOptions(FILES)}
          />
        </FilterGroup>

        <FilterGroup label={t.logs.level}>
          <Segmented
            value={level}
            onChange={setLevel}
            options={toOptions(LEVELS)}
          />
        </FilterGroup>

        <FilterGroup label={t.logs.component}>
          <Segmented
            value={component}
            onChange={setComponent}
            options={toOptions(COMPONENTS)}
          />
        </FilterGroup>

        <FilterGroup label={t.logs.lines}>
          <Segmented
            value={String(lineCount)}
            onChange={(v) =>
              setLineCount(Number(v) as (typeof LINE_COUNTS)[number])
            }
            options={LINE_COUNTS.map((n) => ({
              value: String(n),
              label: String(n),
            }))}
          />
        </FilterGroup>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t.common.search}
            className="h-8 w-full rounded-md border border-current/15 bg-transparent pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-current/30"
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer whitespace-nowrap">
          <input
            type="checkbox"
            checked={useRegex}
            onChange={(e) => setUseRegex(e.target.checked)}
            className="rounded border-current/30"
          />
          Regex
        </label>
        {searchQuery && (
          <span className="text-xs text-muted-foreground">
            {filteredLines.length}/{lines.length}
          </span>
        )}
      </div>

      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="h-4 w-4" />
            {file}.log
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {error && (
            <div className="bg-destructive/10 border-b border-destructive/20 p-3">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          <div
            ref={scrollRef}
            className="p-4 font-mono-ui text-xs leading-5 overflow-auto min-h-[400px] max-h-[calc(100vh-280px)]"
          >
            {filteredLines.length === 0 && !loading && (
              <p className="text-muted-foreground text-center py-8">
                {searchQuery ? t.common.noResults : t.logs.noLogLines}
              </p>
            )}
            {filteredLines.map((line, i) => {
              const cls = classifyLine(line);
              let content: ReactNode = line;
              if (searchQuery.trim()) {
                try {
                  const re = useRegex
                    ? new RegExp(`(${searchQuery})`, "gi")
                    : new RegExp(`(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
                  const parts = line.split(re);
                  content = parts.map((part, j) =>
                    re.test(part) ? (
                      <mark key={j} className="bg-yellow-500/30 text-foreground rounded px-0.5">
                        {part}
                      </mark>
                    ) : (
                      part
                    ),
                  );
                } catch {
                  content = line;
                }
              }
              return (
                <div
                  key={i}
                  className={`${LINE_COLORS[cls]} hover:bg-secondary/20 px-1 -mx-1`}
                >
                  {content}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
      <PluginSlot name="logs:bottom" />
    </div>
  );
}
