# SIFT — Product Context

## What SIFT is
A multi-tenant SaaS platform for video editing agencies: job board + submission/review
system + Discord-style community, sold to agencies as isolated workspaces.

The unique mechanism: **timestamp-anchored video review**. Editors submit Google Drive
links; reviewers pin comments to exact playback moments in a player SIFT controls —
feedback lands at 0:45, not "somewhere in there".

## Who it serves
- Agency owners/admins: post editing jobs, review submissions, run revision cycles,
  manage custom stacked roles and permissions per workspace.
- Editors: claim/apply to jobs, submit Drive links, iterate through revision rounds,
  build per-org reputation.
- Platform staff (SIFT owner): manage organizations, subscriptions, suspensions —
  explicitly WITHOUT blanket access to org-private chat/submission content.

## Core truths (fixed)
1. Organizations are tenants. Every row of tenant data carries one organization_id;
   RLS enforces isolation at the database layer. Non-negotiable.
2. Roles are custom, stackable, per-org. Permissions are the union of held roles.
   A permission matrix (12 keys) toggles per role, Discord-style.
3. Submissions are versioned (v1, v2…) against Drive links — never file uploads.
   Revision requests lock a round; approvals close jobs and prompt reviews.
4. Comments attach optionally to timestamp_seconds on the submission's video.
5. Kick (rejoinable) ≠ ban (permanent, keyed on identity).
6. Every admin action lands in a per-org audit log.
7. Billing is per-org Stripe subscription gating plan limits (free caps jobs/editors).
8. Profiles are global (bio, skills, portfolio); reputation stats are per-org.

## Build stages (each ships working end-to-end)
foundation (auth+orgs+roles+RLS) → job board → submissions/revisions → chat →
admin panel → Stripe billing → notifications → profiles/reputation.

## Decisions locked with Roy (2026-08-23)
- Video preview: custom player, phased. Phase 1 validates public Drive links at
  submission and streams into SIFT's own <video> (timestamps readable). Phase 2
  option open: service-account Drive API sharing for native-quality official streaming.
  Never the Drive iframe (unreadable playhead kills the core feature).
- Profiles global, reputation per-org.
- Fresh Supabase project dedicated to this product.
- Plans (proposed defaults, vetoable): Free 5 active jobs / 10 editors;
  Pro 50 / 40; Studio unlimited.

## Surface modes
App surfaces are Operate (dashboards, boards, review rooms, admin): scanability,
state legibility, and familiar affordances outrank expression. Brand lives in precise
details (timecode typography, timeline motifs), never in obscured tasks.
