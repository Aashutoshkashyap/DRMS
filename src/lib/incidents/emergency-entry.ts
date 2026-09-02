/** Explicit emergency entry words only. They are intentionally not a broad
 * intent dictionary: ordinary descriptions such as "flood" or "help me"
 * must remain available to coordinators until the citizen explicitly starts
 * an intake. */
const EMERGENCY_ENTRY_TRIGGERS = new Set([
  "start", "help", "sos", "emergency", "rescue", "urgent", "relief",
  "सहयोग", "मद्दत", "उद्धार", "आपतकाल", "आपतकालीन", "बचाऊ",
  "sahayog", "maddat", "madad", "uddhar", "apatkal", "apatkaal", "bachau",
]);

/** Trim whitespace and only surrounding punctuation, then match one complete
 * explicit command. Internal words are never removed or interpreted. */
export function normalizeEmergencyEntry(value: string | null | undefined) {
  return (value ?? "").trim().replace(/^\p{P}+/u, "").replace(/\p{P}+$/u, "").trim().toLowerCase();
}

export function isExplicitEmergencyTrigger(value: string | null | undefined) {
  return EMERGENCY_ENTRY_TRIGGERS.has(normalizeEmergencyEntry(value));
}

export type CitizenLanguageCharacteristic = "ne" | "en" | "mixed" | "unknown";

/** This is deliberately conservative: Devanagari is recognisable, but a
 * Romanized sentence may be English or Nepali and is therefore unknown. */
export function classifyCitizenLanguage(value: string | null | undefined): CitizenLanguageCharacteristic {
  const text = value ?? "";
  const hasDevanagari = /\p{Script=Devanagari}/u.test(text);
  const hasLatin = /[A-Za-z]/.test(text);
  if (hasDevanagari && hasLatin) return "mixed";
  if (hasDevanagari) return "ne";
  if (hasLatin) return "en";
  return "unknown";
}

export const BILINGUAL_EMERGENCY_OPENING = `राहत/उद्धार आवश्यक छ?
आफ्नो समस्या सिधै लेख्नुहोस्।

Need emergency relief or rescue?
Simply describe your request.

तपाईं text, photo, voice message वा location पठाउन सक्नुहुन्छ।
You can send text, a photo, voice message, or a WhatsApp location.

एक वा धेरै सन्देश पठाउन सक्नुहुन्छ।
You may send one or more.`;

export const BILINGUAL_LOCATION_PROMPT = `धन्यवाद। अब सहायता चाहिएको स्थान पठाउनुहोस्।
Map pin पठाउनुहोस्, वा ठाउँ/landmark अथवा Google Maps link लेख्नुहोस्।

Thank you. Now send the location where help is needed.
Share a map pin, or reply with a place/landmark or Google Maps link.`;
