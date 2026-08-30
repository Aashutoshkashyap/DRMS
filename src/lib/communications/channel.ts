/** Provider-neutral message shape used by disaster communication services.
 * WhatsApp adapts it today; an SMS adapter can be added later. */
export type CommunicationChannel = "whatsapp" | "sms";

export interface ChannelReply {
  kind: "text" | "buttons" | "list";
  body: string;
  buttons?: { id: string; title: string }[];
  sections?: { title?: string; rows: { id: string; title: string; description?: string }[] }[];
}

export interface ChannelInboundMessage {
  text?: string | null;
  interactionId?: string | null;
  location?: { latitude: number; longitude: number; name?: string; address?: string } | null;
}
