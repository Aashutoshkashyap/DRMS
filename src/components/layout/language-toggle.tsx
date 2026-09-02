"use client";

import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";

/** A compact, device-persisted operational-language selector. */
export function LanguageToggle({ className }: { className?: string }) {
  const { language, setLanguage } = useTheme();

  return (
    <div
      aria-label="Display language"
      className={cn("flex h-9 items-center rounded-md border border-border bg-muted/50 p-0.5 text-xs font-medium", className)}
      role="group"
    >
      <button
        type="button"
        aria-pressed={language === "en"}
        onClick={() => setLanguage("en")}
        className={cn("h-7 rounded px-2 transition-colors", language === "en" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
      >
        English
      </button>
      <button
        type="button"
        aria-pressed={language === "ne"}
        onClick={() => setLanguage("ne")}
        className={cn("h-7 rounded px-2 transition-colors", language === "ne" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
      >
        नेपाली
      </button>
    </div>
  );
}
