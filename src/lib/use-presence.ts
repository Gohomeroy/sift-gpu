"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Live online-status for an organization via a Supabase Realtime presence
 * channel. Returns the set of user ids currently connected. Ephemeral by
 * design — no schema, presence dies with the socket.
 */
export function useOrgPresence(organizationId: string, userId: string) {
  const [online, setOnline] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!organizationId || !userId) return;
    const supabase = createClient();
    const channel = supabase.channel(`rt-presence-${organizationId}`, {
      config: { presence: { key: userId } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        setOnline(new Set(Object.keys(channel.presenceState())));
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ online_at: new Date().toISOString() });
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [organizationId, userId]);

  return online;
}
