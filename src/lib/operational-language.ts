import type { DisplayLanguage } from "@/lib/themes";

/**
 * High-frequency shell vocabulary available without changing the deployed
 * next-intl locale. Longer detailed screens retain their source language
 * until they receive reviewed Nepalese translations.
 */
const NEPALI_SHELL_LABELS: Record<string, string> = {
  dashboard: "सञ्चालन अवलोकन",
  pipelines: "घटनाहरू",
  inbox: "सन्देशहरू",
  followUp: "फलो-अप आवश्यक",
  activity: "गतिविधि र जवाफदेहिता",
  team: "टोलीहरू",
  settings: "सेटिङहरू",
};

export function operationalLabel(language: DisplayLanguage, key: string, english: string) {
  return language === "ne" ? NEPALI_SHELL_LABELS[key] ?? english : english;
}
