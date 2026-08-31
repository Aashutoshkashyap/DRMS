import type { IncidentCategory, IncidentPriority } from "@/types";

export type IntakeState =
  | "start" | "collect_name" | "collect_location" | "collect_people"
  | "collect_details" | "confirm_request" | "edit_menu" | "edit_service"
  | "edit_location" | "edit_people" | "edit_details" | "restart_choice"
  | "collect_request_id" | "waiting_for_coordinator";

export interface IntakeData {
  category?: IncidentCategory;
  requesterName?: string;
  location?: string;
  latitude?: number;
  longitude?: number;
  peopleAffected?: number;
  description?: string;
  resumeState?: IntakeState;
}

export interface ChannelPrompt {
  kind: "text" | "buttons" | "list";
  body: string;
  buttons?: { id: string; title: string }[];
  sections?: { title?: string; rows: { id: string; title: string; description?: string }[] }[];
}

export type IntakeAction = "create_request" | "check_active_request" | "check_request_id" | null;
export interface IntakeTransition { state: IntakeState; data: IntakeData; prompt: ChannelPrompt; action: IntakeAction; }

const CATEGORIES: { id: IncidentCategory; title: string; description: string; aliases: string[] }[] = [
  { id: "rescue", title: "Rescue", description: "Rescue or evacuation", aliases: ["rescue", "evacuate", "evacuation", "trapped"] },
  { id: "food_water", title: "Food / Water", description: "Food or drinking water", aliases: ["food", "water", "drinking water", "ration"] },
  { id: "medicine", title: "Medical help", description: "Medicine or medical aid", aliases: ["medicine", "medical", "doctor", "ambulance", "hospital"] },
  { id: "shelter", title: "Shelter", description: "Safe shelter support", aliases: ["shelter", "housing", "temporary shelter"] },
  { id: "missing_person", title: "Missing person", description: "Report a missing person", aliases: ["missing person", "missing", "lost person"] },
  { id: "information", title: "Information", description: "Verified local information", aliases: ["disaster information", "information"] },
];

/** Fixed locality aliases only: this is not geocoding or semantic inference. */
const KNOWN_LOCATIONS = [
  "Kalanki", "Kathmandu", "Lalitpur", "Patan", "Bhaktapur", "Kirtipur",
  "Pokhara", "Dharan", "Biratnagar", "Bharatpur", "Butwal", "Nepalgunj",
  "Janakpur", "Hetauda", "Baneshwor", "Thamel", "Tokha", "Maitidevi",
];
const REQUIRED_DETAIL_CATEGORIES = new Set<IncidentCategory>(["rescue", "medicine", "missing_person"]);

function text(body: string): ChannelPrompt { return { kind: "text", body }; }
function categoryLabel(category: IncidentCategory | undefined): string { return CATEGORIES.find((item) => item.id === category)?.title ?? "Help"; }

function serviceMenu(includeStatus: boolean): ChannelPrompt {
  return {
    kind: "list", body: "What help do you need?",
    sections: [{ title: "Emergency services", rows: [
      ...CATEGORIES.map((category) => ({ id: `emergency:service:${category.id}`, title: category.title, description: category.description })),
      ...(includeStatus ? [{ id: "emergency:status", title: "Check my request", description: "View a current request status" }] : []),
    ] }],
  };
}
export function emergencyMenu(): ChannelPrompt { return serviceMenu(true); }

function peoplePrompt(): ChannelPrompt {
  return {
    kind: "list", body: "How many people are affected?",
    sections: [{ title: "People affected", rows: [
      { id: "emergency:people:1", title: "1 person" },
      { id: "emergency:people:2_5", title: "2–5 people" },
      { id: "emergency:people:6_10", title: "6–10 people" },
      { id: "emergency:people:10_plus", title: "More than 10" },
    ] }],
  };
}

function defaultDescription(category: IncidentCategory): string {
  switch (category) {
    case "food_water": return "Food / water assistance requested.";
    case "shelter": return "Shelter assistance requested.";
    case "information": return "Disaster information requested.";
    default: return "No additional details provided.";
  }
}
function needsDetails(category: IncidentCategory | undefined): boolean { return !!category && REQUIRED_DETAIL_CATEGORIES.has(category); }
function detailQuestion(category: IncidentCategory): string {
  switch (category) {
    case "rescue": return "Briefly describe the immediate danger. Reply NONE if there is no additional detail.";
    case "medicine": return "Briefly describe the medical need and urgency.";
    case "missing_person": return "Provide the missing person's name and identifying details if known.";
    default: return "Briefly describe what happened.";
  }
}
function priorityFor(category: IncidentCategory, description: string): IncidentPriority {
  if (category === "rescue" && /critical|unconscious|trapped|bleeding/i.test(description)) return "critical";
  if (category === "medicine" || category === "rescue") return "high";
  return "medium";
}
export function incidentPriority(data: IntakeData): IncidentPriority { return priorityFor(data.category!, data.description ?? ""); }

function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function categoryFromText(value: string): IncidentCategory | undefined {
  return CATEGORIES.find((category) => category.aliases.some((alias) => new RegExp(`(^|\\W)${escapeRegex(alias)}($|\\W)`, "i").test(value)))?.id;
}
function knownLocationFromText(value: string): string | undefined {
  return KNOWN_LOCATIONS.find((location) => new RegExp(`(^|\\W)${escapeRegex(location)}($|\\W)`, "i").test(value));
}
function coordinatesFromText(value: string): { location: string; latitude: number; longitude: number } | null {
  const match = /(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/.exec(value);
  if (!match) return null;
  const latitude = Number(match[1]); const longitude = Number(match[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { location: `${latitude},${longitude}`, latitude, longitude };
}
function peopleFromText(value: string): number | undefined {
  const match = /\b(\d{1,6})\s*(?:people|persons?|families|family|affected)\b/i.exec(value);
  const people = match ? Number(match[1]) : undefined;
  return people && people >= 1 && people <= 100000 ? people : undefined;
}

export interface DeterministicIntakeFields { category?: IncidentCategory; location?: string; latitude?: number; longitude?: number; peopleAffected?: number; }
/** Extract only exact keywords, numeric patterns, local aliases and coordinates. */
export function extractDeterministicIntakeFields(value: string | null | undefined): DeterministicIntakeFields {
  const input = value?.trim() ?? "";
  if (!input) return {};
  const coordinate = coordinatesFromText(input);
  const location = coordinate ?? (knownLocationFromText(input) ? { location: knownLocationFromText(input)! } : {});
  return { category: categoryFromText(input), peopleAffected: peopleFromText(input), ...location };
}
export function hasDeterministicEmergencyIntent(value: string | null | undefined): boolean { return !!extractDeterministicIntakeFields(value).category; }
export function isUsableCitizenName(value: string | null | undefined): boolean {
  const name = value?.trim() ?? "";
  return name.length >= 2 && name.length <= 120 && /[A-Za-z\p{L}]/u.test(name) && !/^\+?\d[\d\s-]*$/.test(name);
}

function withDetectedFields(data: IntakeData, value: string): IntakeData {
  const extracted = extractDeterministicIntakeFields(value);
  return {
    ...data,
    ...(data.category ? {} : extracted.category ? { category: extracted.category } : {}),
    ...(data.location ? {} : extracted.location ? { location: extracted.location } : {}),
    ...(data.latitude != null ? {} : extracted.latitude != null ? { latitude: extracted.latitude } : {}),
    ...(data.longitude != null ? {} : extracted.longitude != null ? { longitude: extracted.longitude } : {}),
    ...(data.peopleAffected ? {} : extracted.peopleAffected ? { peopleAffected: extracted.peopleAffected } : {}),
  };
}
function normaliseDetails(value: string): string { return /^(none|no|n\/a)$/i.test(value.trim()) ? "No additional details provided." : value.trim(); }
function completedData(data: IntakeData): IntakeData {
  if (!data.category || data.description || needsDetails(data.category)) return data;
  return { ...data, description: defaultDescription(data.category) };
}

function summaryPrompt(data: IntakeData): ChannelPrompt {
  const complete = completedData(data);
  return {
    kind: "buttons",
    body: ["REQUEST SUMMARY", `Help needed: ${categoryLabel(complete.category)}`, `Location: ${complete.location ?? "Not provided"}`, `People affected: ${complete.peopleAffected ?? "Not provided"}`, `Details: ${complete.description ?? "Not provided"}`, "Confirm this request?"].join("\n"),
    buttons: [{ id: "emergency:confirm", title: "Confirm" }, { id: "emergency:edit", title: "Edit" }, { id: "emergency:cancel", title: "Cancel" }],
  };
}
function editPrompt(): ChannelPrompt {
  return {
    kind: "list", body: "What would you like to change?",
    sections: [{ title: "Edit request", rows: [
      { id: "emergency:edit:service", title: "Change service" }, { id: "emergency:edit:location", title: "Change location" },
      { id: "emergency:edit:people", title: "Change people affected" }, { id: "emergency:edit:details", title: "Change details" },
      { id: "emergency:cancel", title: "Cancel request" },
    ] }],
  };
}
function promptForState(state: IntakeState, data: IntakeData): ChannelPrompt {
  switch (state) {
    case "collect_name": return text("What is your name?");
    case "collect_location": return text("Where is help needed? Share a map pin or reply with a locality.");
    case "collect_people": return peoplePrompt();
    case "collect_details": return text(detailQuestion(data.category!));
    case "confirm_request": return summaryPrompt(completedData(data));
    case "edit_menu": return editPrompt();
    case "edit_service": return serviceMenu(false);
    case "edit_location": return text("Share the corrected location pin or locality.");
    case "edit_people": return peoplePrompt();
    case "edit_details": return text("Briefly provide the corrected details. Reply NONE if there are none.");
    case "restart_choice": return { kind: "buttons", body: "You have an unfinished request. What would you like to do?", buttons: [{ id: "emergency:restart", title: "Restart" }, { id: "emergency:continue", title: "Continue" }, { id: "emergency:cancel", title: "Cancel" }] };
    default: return emergencyMenu();
  }
}
function nextMissingState(data: IntakeData): IntakeState {
  if (!data.category) return "start";
  if (!isUsableCitizenName(data.requesterName)) return "collect_name";
  if (!data.location) return "collect_location";
  if (!data.peopleAffected || data.peopleAffected < 1) return "collect_people";
  if (needsDetails(data.category) && !data.description) return "collect_details";
  return "confirm_request";
}
function continueToNext(data: IntakeData): IntakeTransition {
  const complete = completedData(data); const state = nextMissingState(complete);
  return { state, data: complete, prompt: promptForState(state, complete), action: null };
}
function isStartCommand(value: string): boolean { return ["start", "help", "/start", "emergency"].includes(value.trim().toLowerCase()); }
function selectedPeople(value: string): number | null | undefined {
  return ({ "emergency:people:1": 1, "emergency:people:2_5": null, "emergency:people:6_10": null, "emergency:people:10_plus": null } as Record<string, number | null>)[value];
}

/** Pure deterministic intake transition. No transport, database, AI or geocoder imports. */
export function transitionIntake(
  state: IntakeState | null,
  data: IntakeData,
  input: { text?: string | null; interactionId?: string | null; latitude?: number | null; longitude?: number | null },
): IntakeTransition | null {
  const value = (input.interactionId ?? input.text ?? "").trim();
  const detected = withDetectedFields(data, input.text ?? "");

  if (state && state !== "start" && state !== "waiting_for_coordinator" && state !== "restart_choice" && isStartCommand(value)) {
    const restartData = { ...data, resumeState: state };
    return { state: "restart_choice", data: restartData, prompt: promptForState("restart_choice", restartData), action: null };
  }
  if (state === "restart_choice") {
    if (value === "emergency:restart") return { state: "start", data: {}, prompt: emergencyMenu(), action: null };
    if (value === "emergency:continue") {
      const resume = data.resumeState ?? nextMissingState(data); const resumed = { ...data }; delete resumed.resumeState;
      return { state: resume, data: resumed, prompt: promptForState(resume, resumed), action: null };
    }
    if (value === "emergency:cancel") return { state: "start", data: {}, prompt: text("Request cancelled. Reply START whenever you need assistance."), action: null };
    return { state, data, prompt: text("Choose Restart, Continue, or Cancel."), action: null };
  }
  if (value === "emergency:status") return { state: "collect_request_id", data, prompt: text("Checking your active request now."), action: "check_active_request" };
  if (value.startsWith("emergency:service:")) {
    const category = value.slice("emergency:service:".length) as IncidentCategory;
    if (!CATEGORIES.some((item) => item.id === category)) return { state: "start", data: {}, prompt: emergencyMenu(), action: null };
    const previousDefault = data.category ? defaultDescription(data.category) : null;
    const updated = { ...data, category, ...(data.description === previousDefault ? { description: undefined } : {}) };
    return state === "edit_service" ? { state: "confirm_request", data: completedData(updated), prompt: summaryPrompt(updated), action: null } : continueToNext(updated);
  }
  if (state === "edit_menu") {
    const next = ({ "emergency:edit:service": "edit_service", "emergency:edit:location": "edit_location", "emergency:edit:people": "edit_people", "emergency:edit:details": "edit_details" } as Record<string, IntakeState>)[value];
    if (value === "emergency:cancel") return { state: "start", data: {}, prompt: text("Request cancelled. Reply START whenever you need assistance."), action: null };
    return next ? { state: next, data, prompt: promptForState(next, data), action: null } : { state, data, prompt: text("Choose one of the edit options."), action: null };
  }
  if (state === "start" || !state || state === "waiting_for_coordinator") {
    if (detected.category) return continueToNext(detected);
    if (isStartCommand(value)) return { state: "start", data: { requesterName: data.requesterName }, prompt: emergencyMenu(), action: null };
    if (state === "waiting_for_coordinator") return { state, data, prompt: text("Your follow-up has been recorded in the coordinator conversation. Reply START for a new request or send HELP for the menu."), action: null };
    return null;
  }
  if (state === "collect_name") {
    const extracted = extractDeterministicIntakeFields(input.text ?? "");
    const hasEmergencyFields = !!(extracted.category || extracted.location || extracted.peopleAffected);
    if (hasEmergencyFields && !isUsableCitizenName(data.requesterName)) return { state, data: detected, prompt: promptForState(state, detected), action: null };
    if (!isUsableCitizenName(value)) return { state, data: detected, prompt: text("Please enter a short name."), action: null };
    return continueToNext({ ...detected, requesterName: value });
  }
  if (state === "collect_location" || state === "edit_location") {
    const extracted = extractDeterministicIntakeFields(input.text ?? "");
    const isMultiFieldMessage = !!(extracted.category || extracted.peopleAffected);
    const locationFromPin = input.latitude != null && input.longitude != null ? { location: value || `${input.latitude.toFixed(5)}, ${input.longitude.toFixed(5)}`, latitude: input.latitude, longitude: input.longitude } : null;
    const locationFromText = isMultiFieldMessage && extracted.location
      ? { location: extracted.location, ...(extracted.latitude != null ? { latitude: extracted.latitude } : {}), ...(extracted.longitude != null ? { longitude: extracted.longitude } : {}) }
      : (value.length >= 3 ? { location: value } : null);
    const location = locationFromPin ?? locationFromText;
    if (!location) return { state, data: detected, prompt: text("I still need the location where help is required."), action: null };
    const updated = { ...detected, ...location };
    return state === "edit_location" ? { state: "confirm_request", data: completedData(updated), prompt: summaryPrompt(updated), action: null } : continueToNext(updated);
  }
  if (state === "collect_people" || state === "edit_people") {
    const choice = selectedPeople(value);
    if (choice === null) return { state, data: detected, prompt: text("Please reply with the exact number of people affected."), action: null };
    const number = choice ?? detected.peopleAffected ?? (() => { const parsed = Number(value); return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100000 ? parsed : undefined; })();
    if (!number) return { state, data: detected, prompt: text("I still need the number of people affected."), action: null };
    const updated = { ...detected, peopleAffected: number };
    return state === "edit_people" ? { state: "confirm_request", data: completedData(updated), prompt: summaryPrompt(updated), action: null } : continueToNext(updated);
  }
  if (state === "collect_details" || state === "edit_details") {
    if (value.length < 2) return { state, data: detected, prompt: text("Please briefly describe what happened, or reply NONE."), action: null };
    const updated = { ...detected, description: normaliseDetails(value) };
    return state === "edit_details" ? { state: "confirm_request", data: completedData(updated), prompt: summaryPrompt(updated), action: null } : continueToNext(updated);
  }
  if (state === "confirm_request") {
    if (value === "emergency:confirm") return { state: "waiting_for_coordinator", data: completedData(data), prompt: text("Creating your request."), action: "create_request" };
    if (value === "emergency:edit") return { state: "edit_menu", data, prompt: editPrompt(), action: null };
    if (value === "emergency:cancel") return { state: "start", data: {}, prompt: text("Request cancelled. Reply START whenever you need assistance."), action: null };
    return { state, data, prompt: text("Choose Confirm, Edit, or Cancel."), action: null };
  }
  if (state === "collect_request_id") {
    if (!value) return { state, data, prompt: text("Please enter your Request ID, for example DRMS-ABC1234567."), action: null };
    return { state: "waiting_for_coordinator", data: { ...data, description: value }, prompt: text("Checking that Request ID."), action: "check_request_id" };
  }
  return null;
}
