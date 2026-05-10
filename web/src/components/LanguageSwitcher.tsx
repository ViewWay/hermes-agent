import { Button } from "@nous-research/ui/ui/components/button";
import { Typography } from "@/components/NouiTypography";
import { useI18n } from "@/i18n";

export function LanguageSwitcher() {
  const { locale, setLocale } = useI18n();
  const isZh = locale === "zh";

  return (
    <Button
      ghost
      onClick={() => setLocale(isZh ? "en" : "zh")}
      aria-label={isZh ? "Switch to English" : "切换到中文"}
      className="px-2 py-1 normal-case tracking-normal font-normal text-xs text-muted-foreground hover:text-foreground"
    >
      <span className="inline-flex items-center gap-1.5">
        <span className="text-base leading-none">
          {isZh ? "\u{1F1EC}\u{1F1E7}" : "\u{1F1E8}\u{1F1F3}"}
        </span>
        <Typography
          mondwest
          className="hidden sm:inline tracking-wide uppercase text-[0.65rem]"
        >
          {isZh ? "EN" : "中文"}
        </Typography>
      </span>
    </Button>
  );
}
