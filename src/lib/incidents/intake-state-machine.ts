import type { IncidentCategory, IncidentPriority } from "@/types";

export type IntakeState =
  | "start"
  | "collect_name"
  | "collect_location"
  | "collect_people"
  | "collect_details"
  | "confirm_request"
  | "collect_request_id"
  | "waiting_for_coordinator";

export interface IntakeData {
  category?: IncidentCategory;
  requesterName?: string;
  location?: string;
  latitude?: number;
  longitude?: number;
  peopleAffected?: number;
  description?: string;
}

export interface ChannelPrompt {
  kind: "text" | "buttons" | "list";
  body: string;
  buttons?: { id: string; title: string }[];
  sections?: { title?: string; rows: { id: string; title: string; description?: string }[] }[];
}

export type IntakeAction = "create_request" | "check_active_request" | "check_request_id" | null;
export interface IntakeTransition {
  state: IntakeState;
  data: IntakeData;
  prompt: ChannelPrompt;
  action: IntakeAction;
}

const CATEGORIES: { id: IncidentCategory; title: string; description: string }[] = [
  { id: "rescue", title: "Rescue", description: "Rescue or evacuation" },
  { id: "food_water", title: "Food / Water", description: "Food or drinking water" },
  { id: "medicine", title: "Medical help", description: "Medicine or medical aid" },
  { id: "shelter", title: "Shelter", description: "Safe shelter support" },
  { id: "missing_person", title: "Missing person", description: "Report a missing person" },
  { id: "information", title: "Information", description: "Verified local information" },
];

export function emergencyMenu(): ChannelPrompt {
  return {
    kind: "list",
    body: "Disaster response assistance. Select a service or check an existing request.",
    sections: [{
      title: "Services",
      rows: [
        ...CATEGORIES.map((category) => ({ id: `emergency:service:${category.id}`, title: category.title, description: category.description })),
        { id: "emergency:status", title: "Check my request", description: "View a current request status" },
      ],
    }],
  };
}

function text(body: string): ChannelPrompt { return { kind: "text", body }; }

function nextAfterLocation(category: IncidentCategory): IntakeState {
  return category === "medicine" || category === "missing_person" || category === "information"
    ? "collect_details" : "collect_people";
}

function detailQuestion(category: IncidentCategory): string {
  switch (category) {
    case "rescue": return "Briefly describe any immediate medical danger. Reply NONE if there is none.";
    case "food_water": return "What food or water support is needed?";
    case "medicine": return "What medicine or medical assistance is needed, and how urgent is it?";
    case "shelter": return "Briefly describe the shelter need.";
    case "missing_person": return "Provide the missing person's name, age if known, and identifying details.";
    default: return "What verified local information do you need?";
  }
}

function priorityFor(category: IncidentCategory, description: string): IncidentPriority {
  if (category === "rescue" && /critical|unconscious|trapped|bleeding/i.test(description)) return "critical";
  if (category === "medicine" || category === "rescue") return "high";
  return "medium";
}

export function incidentPriority(data: IntakeData): IncidentPriority {
  return priorityFor(data.category!, data.description ?? "");
}

/** Pure deterministic intake transition. It deliberately does not import a
 * transport, database, AI provider, or request service. */
export function transitionIntake(
  state: IntakeState | null,
  data: IntakeData,
  input: { text?: string | null; interactionId?: string | null; latitude?: number | null; longitude?: number | null },
): IntakeTransition | null {
  const value = (input.interactionId ?? input.text ?? "").trim();
  const normalized = value.toLowerCase();
  if (value.startsWith("emergency:service:")) {
    const category = value.slice("emergency:service:".length) as IncidentCategory;
    if (!CATEGORIES.some((item) => item.id === category)) return { state: "start", data: {}, prompt: emergencyMenu(), action: null };
    return { state: "collect_name", data: { category }, prompt: text("Please enter your name."), action: null };
  }
  if (value === "emergency:status") return { state: "collect_request_id", data, prompt: text("Checking your active request now."), action: "check_active_request" };
  if (!state || state === "start" || normalized === "start" || normalized === "help" || normalized === "/start") {
    return { state: "start", data: {}, prompt: emergencyMenu(), action: null };
  }
  if (state === "collect_name") {
    if (value.length < 2) return { state, data, prompt: text("Please enter a name with at least 2 characters."), action: null };
    return { state: "collect_location", data: { ...data, requesterName: value }, prompt: text("Share your location and a nearby landmark if possible."), action: null };
  }
  if (state === "collect_location") {
    if (value.length < 3) return { state, data, prompt: text("Please provide a location or nearby landmark."), action: null };
    const category = data.category!;
    const next = nextAfterLocation(category);
    return { state: next, data: { ...data, location: value, latitude: input.latitude ?? undefined, longitude: input.longitude ?? undefined }, prompt: text(next === "collect_people" ? "How many people are affected? Reply with a number." : detailQuestion(category)), action: null };
  }
  if (state === "collect_people") {
    const people = Number(value);
    if (!Number.isInteger(people) || people < 1 || people > 100000) return { state, data, prompt: text("Please reply with the number of affected people (at least 1)."), action: null };
    return { state: "collect_details", data: { ...data, peopleAffected: people }, prompt: text(detailQuestion(data.category!)), action: null };
  }
  if (state === "collect_details") {
    if (value.length < 2) return { state, data, prompt: text("Please provide the requested details, or reply NONE if there are no additional details."), action: null };
    const completed = { ...data, description: value, peopleAffected: data.peopleAffected ?? 1 };
    return { state: "confirm_request", data: completed, prompt: { kind: "buttons", body: `Please confirm: ${completed.category?.replaceAll("_", " ")} request for ${completed.peopleAffected} person(s) at ${completed.location}.`, buttons: [{ id: "emergency:confirm", title: "Submit request" }, { id: "emergency:cancel", title: "Cancel" }] }, action: null };
  }
  if (state === "confirm_request") {
    if (value === "emergency:confirm") return { state: "waiting_for_coordinator", data, prompt: text("Creating your request."), action: "create_request" };
    if (value === "emergency:cancel") return { state: "start", data: {}, prompt: text("Request cancelled. Reply START whenever you need assistance."), action: null };
    return { state, data, prompt: text("Please use Submit request or Cancel."), action: null };
  }
  if (state === "collect_request_id") {
    if (!value) return { state, data, prompt: text("Please enter your Request ID, for example DRMS-ABC1234567."), action: null };
    return { state: "waiting_for_coordinator", data: { ...data, description: value }, prompt: text("Checking that Request ID."), action: "check_request_id" };
  }
  if (state === "waiting_for_coordinator") {
    return { state, data, prompt: text("Your follow-up has been recorded in the coordinator conversation. Reply START for a new request or send HELP for the menu."), action: null };
  }
  return null;
}
