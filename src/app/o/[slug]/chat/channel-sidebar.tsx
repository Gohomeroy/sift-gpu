"use client";

import { useState, useActionState } from "react";
import { Pencil, Plus } from "lucide-react";
import {
  createChannelAction,
  deleteChannelAction,
  renameChannelAction,
} from "@/app/actions/chat";
import { emptyState } from "@/lib/action-state";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { DangerButton } from "@/components/ui/danger-button";
import type { ChatChannel } from "@/lib/types";

export function ChannelSidebar({
  slug,
  organizationId,
  channels,
  activeSlug,
  canModerate,
}: {
  slug: string;
  organizationId: string;
  channels: ChatChannel[];
  activeSlug: string | null;
  canModerate: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<ChatChannel | null>(null);

  return (
    <nav aria-label="Channels" className="grid content-start gap-1">
      <div className="flex items-center justify-between px-2">
        <h2 className="font-mono text-[10px] tracking-[0.08em] text-faint uppercase">
          Channels
        </h2>
        {canModerate && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            title="New channel"
            aria-label="New channel"
            className="cursor-pointer rounded p-0.5 text-faint transition-colors hover:bg-raised hover:text-ink"
          >
            <Plus size={14} />
          </button>
        )}
      </div>

      {channels.map((ch) => {
        const active = ch.slug === activeSlug;
        return (
          <div key={ch.id} className="group relative">
            <a
              href={`/o/${slug}/chat?c=${ch.slug}`}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
                active
                  ? "bg-raised font-medium text-accent"
                  : "text-muted hover:bg-raised hover:text-ink"
              }`}
            >
              <span className="text-faint">#</span>
              <span className="truncate">{ch.name}</span>
            </a>
            {canModerate && (
              <span className="absolute top-1/2 right-1.5 hidden -translate-y-1/2 items-center gap-0.5 group-hover:flex">
                <button
                  type="button"
                  onClick={() => setRenaming(ch)}
                  title="Rename channel"
                  aria-label={`Rename ${ch.name}`}
                  className="cursor-pointer rounded bg-panel p-1 text-faint hover:text-ink"
                >
                  <Pencil size={12} />
                </button>
                <form action={deleteChannelAction}>
                  <input type="hidden" name="channel_id" value={ch.id} />
                  <input type="hidden" name="channel_slug" value={ch.slug} />
                  <input type="hidden" name="slug" value={slug} />
                  <DangerButton label="DEL" confirmLabel="SURE?" />
                </form>
              </span>
            )}
          </div>
        );
      })}

      <CreateChannelModal
        open={creating}
        onClose={() => setCreating(false)}
        organizationId={organizationId}
        slug={slug}
      />
      <RenameChannelModal
        channel={renaming}
        onClose={() => setRenaming(null)}
        slug={slug}
      />
    </nav>
  );
}

function CreateChannelModal({
  open,
  onClose,
  organizationId,
  slug,
}: {
  open: boolean;
  onClose: () => void;
  organizationId: string;
  slug: string;
}) {
  const [state, action, pending] = useActionState(createChannelAction, emptyState);

  return (
    <Modal open={open} onClose={onClose} title="New channel">
      <form action={action} className="grid gap-4">
        <input type="hidden" name="organization_id" value={organizationId} />
        <input type="hidden" name="slug" value={slug} />
        <Field label="Name" hint="Lowercase handle is derived from this." htmlFor="ch-name">
          <Input id="ch-name" name="name" required maxLength={40} placeholder="edits-lounge" />
        </Field>
        <Field label="Topic (optional)" htmlFor="ch-topic">
          <Input id="ch-topic" name="topic" maxLength={200} placeholder="What is this channel for?" />
        </Field>
        {state.error && <Alert kind="error">{state.error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={pending}>
            Create channel
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function RenameChannelModal({
  channel,
  onClose,
  slug,
}: {
  channel: ChatChannel | null;
  onClose: () => void;
  slug: string;
}) {
  return (
    <Modal open={channel !== null} onClose={onClose} title="Rename channel">
      {channel && (
        <form action={renameChannelAction} className="grid gap-4">
          <input type="hidden" name="channel_id" value={channel.id} />
          <input type="hidden" name="slug" value={slug} />
          <Field label="Name" htmlFor="ch-rename">
            <Input
              id="ch-rename"
              name="name"
              required
              maxLength={40}
              defaultValue={channel.name}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
