"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

/** A small browser-only warning. It makes no claim about Supabase, Vercel, or
 * WhatsApp health; it only reports that this coordinator tab is offline. */
export function NetworkStatus() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (online) return null;
  return <div role="status" className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-foreground">
    <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
    <span><strong>Waiting for connection.</strong> Changes are not confirmed while this browser is offline. Typed inbox replies are kept in this browser; reconnect and send or retry the specific action.</span>
  </div>;
}
