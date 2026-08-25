"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Subscribes to row changes on the given tables for this org and refreshes
 * server components — boards and review rooms update without a reload.
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

  useEffect(() => {
    const supabase = createClient();
    const tableList = tableKey.split(",");
    const channel = supabase.channel(`rt-${tableKey}-${organizationId}`);

    for (const table of tableList) {
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          filter: `organization_id=eq.${organizationId}`,
        },
        () => router.refresh(),
      );
    }

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [organizationId, tableKey, router]);

  return null;
}
