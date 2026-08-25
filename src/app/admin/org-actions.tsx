"use client";

import { setOrgPlanAction, setOrgStatusAction } from "@/app/actions/admin";
import { DangerButton } from "@/components/ui/danger-button";
import type { Organization } from "@/lib/types";

export function PlanSelect({ org }: { org: Organization }) {
  return (
    <form action={setOrgPlanAction}>
      <input type="hidden" name="org_id" value={org.id} />
      <select
        name="plan"
        defaultValue={org.plan}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="h-7 cursor-pointer rounded-md border border-line bg-canvas px-2 font-mono text-[11px] text-ink"
        aria-label={`Plan for ${org.name}`}
      >
        <option value="free">free</option>
        <option value="pro">pro</option>
        <option value="studio">studio</option>
      </select>
    </form>
  );
}

export function OrgActions({ org }: { org: Organization }) {
  const suspend = org.status === "active";

  return (
    <form action={setOrgStatusAction} className="inline-flex">
      <input type="hidden" name="org_id" value={org.id} />
      <input type="hidden" name="status" value={suspend ? "suspended" : "active"} />
      <DangerButton
        label={suspend ? "SUSPEND" : "REACTIVATE"}
        confirmLabel={suspend ? "CONFIRM?" : "CONFIRM?"}
      />
    </form>
  );
}
