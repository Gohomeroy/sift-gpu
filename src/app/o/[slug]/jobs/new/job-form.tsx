"use client";

import { useActionState, useState } from "react";
import { Trash2, UploadCloud } from "lucide-react";
import { createJobAction } from "@/app/actions/jobs";
import { emptyState } from "@/lib/action-state";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Chip } from "@/components/ui/chip";
import { Field, Input, Select, Textarea } from "@/components/ui/field";

const CATEGORIES = [
  "Promo / Ad",
  "Music Video",
  "YouTube Edit",
  "Short-form / Verticals",
  "Podcast Clips",
  "Gaming",
  "Corporate",
  "Event Recap",
  "Other",
];

const SKILL_IDEAS = [
  "Premiere Pro",
  "DaVinci Resolve",
  "After Effects",
  "CapCut",
  "Sound design",
  "Color grading",
  "Motion graphics",
];

type Uploaded = { path: string; name: string; size: number };

export function JobForm({ slug, organizationId }: { slug: string; organizationId: string }) {
  const [state, action, pending] = useActionState(createJobAction, emptyState);
  const [uploads, setUploads] = useState<Uploaded[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setUploadError(null);
    setUploading(true);
    const supabase = createClient();
    const next: Uploaded[] = [];

    for (const file of Array.from(fileList)) {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${organizationId}/${Date.now()}-${safe}`;
      const { error } = await supabase.storage.from("briefs").upload(path, file);
      if (error) {
        setUploadError(`Upload failed for “${file.name}”: ${error.message}`);
        break;
      }
      next.push({ path, name: file.name, size: file.size });
    }

    setUploads((prev) => [...prev, ...next]);
    setUploading(false);
  }

  async function removeFile(path: string) {
    const supabase = createClient();
    await supabase.storage.from("briefs").remove([path]);
    setUploads((prev) => prev.filter((u) => u.path !== path));
  }

  return (
    <form action={action} className="grid gap-5">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="organization_id" value={organizationId} />
      <input
        type="hidden"
        name="attachments"
        value={JSON.stringify(uploads)}
      />

      <Field label="Title" htmlFor="j-title">
        <Input
          id="j-title"
          name="title"
          required
          minLength={3}
          maxLength={120}
          placeholder="60s brand promo — fitness app launch"
        />
      </Field>

      <Field
        label="Brief"
        hint="Scope, references, deliverables, aspect ratios — everything an editor needs before claiming."
        htmlFor="j-desc"
      >
        <Textarea id="j-desc" name="description" rows={7} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category" htmlFor="j-cat">
          <Select id="j-cat" name="category" required defaultValue="">
            <option value="" disabled>
              Pick one…
            </option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Skills"
          hint={`Comma separated — e.g. ${SKILL_IDEAS.slice(0, 2).join(", ")}`}
          htmlFor="j-skills"
        >
          <Input id="j-skills" name="required_skills" placeholder="Premiere Pro, Sound design" />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_120px_1fr]">
        <Field label="Budget" htmlFor="j-pay">
          <Input
            id="j-pay"
            name="pay_amount"
            type="number"
            min={0}
            step="1"
            placeholder="400"
          />
        </Field>
        <Field label="Currency" htmlFor="j-cur">
          <Select id="j-cur" name="pay_currency" defaultValue="USD">
            <option>USD</option>
            <option>EUR</option>
            <option>GBP</option>
          </Select>
        </Field>
        <Field label="Pay note (optional)" htmlFor="j-paynote">
          <Input id="j-paynote" name="pay_note" placeholder="or $50/hr, 2 revision rounds" />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Deadline" hint="Soft delivery target." htmlFor="j-deadline">
          <Input id="j-deadline" name="deadline" type="date" />
        </Field>
        <Field
          label="Claim mode"
          hint="Direct: first editor to claim wins instantly. Application: you approve who gets it."
          htmlFor="j-mode"
        >
          <Select id="j-mode" name="claim_mode" defaultValue="application">
            <option value="application">Applications — I pick the editor</option>
            <option value="direct">Direct claim — first come, first served</option>
          </Select>
        </Field>
      </div>

      {/* Brief attachments */}
      <fieldset>
        <legend className="mb-1.5 text-xs font-medium tracking-wide text-muted">
          Brief files (optional)
        </legend>
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-line-strong px-4 py-6 text-sm text-muted transition-colors hover:border-accent hover:text-accent">
          <UploadCloud size={18} />
          {uploading ? "Uploading…" : "Add reference files"}
          <input
            type="file"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
            disabled={uploading}
          />
        </label>
        {uploadError && (
          <Alert kind="error" className="mt-2">
            {uploadError}
          </Alert>
        )}
        {uploads.length > 0 && (
          <ul className="mt-2 grid gap-1">
            {uploads.map((u) => (
              <li
                key={u.path}
                className="flex items-center justify-between gap-2 rounded-md border border-line bg-panel px-3 py-1.5"
              >
                <span className="min-w-0 truncate font-mono text-xs">{u.name}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <Chip dot={false}>{Math.max(1, Math.round(u.size / 1024))} KB</Chip>
                  <button
                    type="button"
                    onClick={() => removeFile(u.path)}
                    aria-label={`Remove ${u.name}`}
                    className="cursor-pointer rounded p-1 text-faint transition-colors hover:bg-raised hover:text-err"
                  >
                    <Trash2 size={13} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      {state.error && <Alert kind="error">{state.error}</Alert>}
      <Button type="submit" loading={pending} className="justify-self-start">
        Publish job
      </Button>
    </form>
  );
}
