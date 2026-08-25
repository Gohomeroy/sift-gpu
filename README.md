# SIFT

**The operating desk for editing teams.** A multi-tenant SaaS where each video
editing agency gets an isolated workspace: a job board, Drive-link submission
review with **timestamp-anchored comments**, and a Discord-style community —
governed by custom, stackable roles with a per-organization permission matrix.

---

## Current build stage

**Stage 1 — Multi-tenant foundation (complete).**
Auth · organizations · stacked roles · permission matrix · invites · kick/ban ·
audit log · global profiles · full RLS enforcement.

**Stage 2 — Job board (complete).**
Job listings with budgets/deadlines/skills · direct-claim (atomic RPC) and
apply-and-approve modes · application queue with auto-decline on assignment ·
private brief-attachment bucket · realtime board updates · plan-based job caps.

**Stage 3 — Submissions & revisions (complete).**
Versioned Drive-link deliveries (v1, v2…) via atomic RPC · revision rounds
with permission-gated request/redeliver cycle · review room with custom
player and timestamp-pinned comments · approval closes the job ·
application queue settles via DB trigger on assignment.

**Stage 4 — Chat (complete).**
Per-org text channels (#general seeded on creation) · realtime messages ·
send gated by send_chat, channel management + message moderation by
moderate_chat · author-only edits with "edited" tag · author-or-mod deletes ·
photo/video attachments (≤5MB, private org-gated bucket) · emoji picker ·
reply-to threading · @mentions with bell pings.

**Stage 4b — Identity & branding (complete).**
Profile photo upload (public avatars bucket) · optional workspace banner
(owner-managed, shown on the overview).

**Stage 4c — Direct messages (complete).**
1:1 threads between org members (participant-only RLS — invisible even to
mods) · find-or-create via atomic RPC · broadcast realtime, attachments,
replies · DM pings through the notification bell.

**Stage 4d — Clipping & UGC campaigns (complete).**
Whop-style campaigns: manage_campaigns holders post briefs with banners
(SIFT default assigned when absent) · structured payouts — rate per 1k views
with a hard per-video cap, computed and shown per entry · platform-tracked
views (refresh buttons, no self-reporting) · account verification: clippers
link TikTok/YouTube/IG handles via a bio code scan, and entries must come
from a verified linked account · 13th permission key in the matrix.

**Stage 9 — AI Clipper (shell complete, worker pending).**
Paste a long-form link → queued clip jobs with live status · plan-gated
(free = 3 videos, the Stripe paywall hook) · clips gallery with viral score,
caption-style presets and signed-URL playback · worker contract in
WORKER.md — an external GPU service (open-source models: scene detection,
whisper transcription scoring, ffmpeg cutting, Remotion captions) picks up
the queue via the service role.

**Stage 5 — Platform admin (complete).**
/admin console for SIFT staff: org table with search + stats, plan changes,
suspend/reactivate · staff-only SECURITY DEFINER RPCs (audit-logged with the
acting staff user) · suspension is a hard off-switch for all org access ·
staff remain walled off from org-private content.

**Stage 7 — Notifications (complete).**
Trigger-driven in-app notifications (assignment, delivery, revision,
approval) · org-scoped bell with live unread badge, deep links, mark-all-read ·
self-notifications suppressed · realtime publication wired.

**Stage 8 — Reviews & reputation (complete).**
One review per approved submission: the approver rates 1–5 with a note in the
review room · per-org reputation DERIVED on the Members page (★ avg · reviews
· completed jobs) — never stored on the global profile · approver-only,
never-self, approved-only, server-stamped editor identity.

Remaining stages: Stripe billing (deferred — everything free for now).

## Stack

| Layer      | Choice                                             |
| ---------- | -------------------------------------------------- |
| Frontend   | Next.js 16 (App Router) + React 19 + Tailwind v4   |
| Data       | Supabase Postgres                                  |
| Auth       | Supabase Auth (email/password, email confirmation) |
| Realtime   | Supabase Realtime *(stages 3–4)*                   |
| Storage    | Supabase Storage — avatars bucket                  |
| Billing    | Stripe *(stage 6)*                                 |
| Tests      | Vitest against a live project                      |

## Setup

1. **Create the Supabase project** (one per environment).
2. Copy `.env.example` to `.env.local` and fill the three keys from
   *Project Settings → API*. The service role key never leaves the server.
3. Apply migrations: paste every file in `supabase/migrations/` into the
   Supabase SQL editor **in filename order** and run them
   (or use `supabase db push` with the CLI linked).
   - If storage policies error in SQL editor, create the `avatars` public
     bucket in Dashboard → Storage and add the four policies there instead.
4. `npm install && npm run dev` → http://localhost:3000
5. First account you create is just a user — sign up, create a workspace, done.
6. To make yourself platform staff later:
   `insert into platform_admins (user_id) values ('<uuid>');`

### Commands

```bash
npm run dev        # dev server
npm run build      # production build
npm run lint       # eslint
npm test           # RLS suite (needs .env.local + migrated project)
```

## Security model — read this before touching auth code

**RLS is the primary enforcement layer.** Every tenant table carries
`organization_id`, every policy calls two SECURITY DEFINER helpers:

- `is_org_member(org)` — active membership?
- `has_org_permission(org, key)` — owner bypass **or** union of permissions
  across all roles held in that org.

App-layer checks (`can()` in `src/lib/permissions.ts`) exist only to render the
right UI; the database re-verifies everything. A leaked anon key exposes no
cross-org data as long as policies hold — that's the contract the test suite
proves.

Deliberate boundaries:

- **Platform admins** see org *metadata* (name/plan/status) to operate the SaaS,
  and **nothing inside** any org — no rosters, chat, submissions, or audit rows.
- **Kick** deletes the membership row (rejoinable via invite). **Ban** keeps it
  with `status='banned'`, blocking invite redemption and future joins.
- Joining happens **only** through `redeem_invite()`; there is no direct insert
  path into `organization_members`.
- The Owner holds implicit full permission while the org is active; suspension
  cuts even owner access.
- Audit triggers append to `audit_log` on every role/membership/invite change;
  clients can read it only with `access_admin_panel`.

## Permission matrix (12 keys)

| Group          | Keys                                                        |
| -------------- | ----------------------------------------------------------- |
| Jobs           | `post_jobs` · `claim_jobs_direct` · `apply_to_jobs`         |
| Review         | `review_submissions` · `approve_submissions`                |
| Community      | `send_chat` · `moderate_chat`                               |
| Moderation     | `kick_users` · `ban_users`                                  |
| Administration | `manage_roles` · `access_admin_panel` · `manage_billing`    |

Seeded roles per new org: **Owner** (all, immutable), **Admin** (all but
billing), **Editor** (claim/apply/chat), **Member** (chat) — Admin/Editor/
Member are fully editable like Discord defaults.

## Schema map (stage 1)

```
organizations ──┬── roles ── role_permissions        (per-org matrix)
                ├── organization_members ── member_roles   (stacked roles)
                ├── organization_invites             (token/email/expiry)
                └── audit_log                        (append-only)

profiles (global) · platform_admins · storage.avatars
```

Composite foreign keys (`member_roles.organization_id` + child id) make
cross-org assignments structurally impossible, not just policy-blocked.

## Video preview decision (locked)

Custom `<video>` player, phased. Stage 3 validates public Drive links at
submission and streams them into our own player so `currentTime` drives
timestamp-pinned comments. Service-account Drive API sharing remains the
upgrade path for native-quality official streaming. The Drive iframe is
rejected permanently — its playhead is unreadable, which would kill the core
review feature. UI copy stays honest: source quality only, no upscaling.

## Project layout

```
src/app/(auth)/…        sign-in / sign-up / reset flows
src/app/o/[slug]/…      workspace shell, members, roles, invites, settings
src/app/actions/…       server actions (all guarded by RLS underneath)
src/lib/supabase/…      browser / server / service-role clients
src/lib/permissions.ts  matrix metadata (UI gating only)
supabase/migrations/…   schema of record
tests/rls.test.ts       enforcement proof
```
