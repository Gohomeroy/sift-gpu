"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function ChatRealtime({ organizationId }: { organizationId: string }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`rt-chat-${organizationId}`);

    channel.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "chat_messages",
        filter: `organization_id=eq.${organizationId}`,
      },
      () => router.refresh(),
    );

    channel.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "chat_channels",
        filter: `organization_id=eq.${organizationId}`,
      },
      () => router.refresh(),
    );

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [organizationId, router]);

  return null;
}
