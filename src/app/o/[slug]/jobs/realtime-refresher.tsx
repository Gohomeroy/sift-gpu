"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Subscribes to row changes on the given tables for this org and refreshes
 * server components — boards and review rooms update without a reload.
 * Debounced to avoid hammering the server on rapid updates.
 */
export function RealtimeRefresher({
  organizationId,
  tables,
}: {
  organizationId: string;
  tables: string[];
}) {
  const router = useRouter();
  const tableKey = tables.join(",");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const tableList = tableKey.split(",");
    const channel = supabase.channel(`rt-${tableKey}-${organizationId}`);

    const debouncedRefresh = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => router.refresh(), 300);
    };

    for (const table of tableList) {
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          filter: `organization_id=eq.${organizationId}`,
        },
        debouncedRefresh,
      );
    }

    channel.subscribe();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      supabase.removeChannel(channel);
    };
  }, [organizationId, tableKey, router]);

  return null;
}
