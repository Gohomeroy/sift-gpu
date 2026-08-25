# SIFT — Design System

## World: Clean ledger
SIFT borrows Stripe's software surface language: cool paper neutrals, near-black
navy ink (#0a2540), one confident blue signal. Light mode is white-on-paper with
blue actions; dark mode is a deep navy console. Both modes are first-class —
users switch anywhere via the sun/moon toggle (next-themes, class strategy,
system default). The wordmark's signal tick is the only ornament.

Direction contract:
- THESIS: precise financial-grade clarity for creative operations — refusing
  both consumer-app playfulness and AI-default neon-on-black.
- OWN-WORLD: dual-mode token system; light = #f6f8fa paper / #ffffff panels /
  #0a2540 ink / #0570de accent; dark = #0b1524 navy ground / #101d30 panels /
  #f6f9fc ink / #4da3f5 accent. Semantic green #18854f/#41c98d, crimson
  #df1b41/#ff6b8a, blurple info #635bff/#8d85ff (a Stripe nod).
- STORY: trustworthy instrument panel that works in daylight and in dim edit bays.
- FIRST VIEWPORT: unchanged structure — left-rail workspace, status-first content.
- FORM: Operate mode, restrained color strategy, hairline borders over shadows.

## Type
- Instrument Sans (UI + headings) — Söhne-adjacent neo-grotesque; display
  tracking -0.02em, weights 500–600.
- IBM Plex Mono — timecodes, slugs, IDs, counts, timestamps, table numerics,
  micro-labels (10–11px uppercase, tracking 0.08em).

## Tokens (CSS variables, re-declared under `.dark`)
canvas · panel · raised · overlay · line · line-strong · ink · muted · faint ·
accent · accent-hover · accent-dim · on-accent · ok · err · info.
Components reference tokens only (`bg-panel`, `text-muted`, `hover:bg-accent-hover`);
no raw hexes in components. Accent never exceeds ~10% of any viewport.

## Composition rules
- Left rail nav (desktop), horizontal scroll nav (mobile); hairline dividers.
- Radius: 6px controls, 8px panels, pills for chips. 1px borders, no shadows
  except modals (single soft elevation).
- Status chips read like timeline clips: tinted ground, signal dot, mono label.
- Role colors are user data (per-org), not chrome — they may sit outside the palette.
- Empty states state the fix, never blank grids.

## Motion
140ms ease-out hovers/focus, 200ms panels/modals. Opacity + transform only;
`disableTransitionOnChange` on theme switches to avoid crossfade smear.

## Bans
No glow/neon edges, no glassmorphism, no gradient fills, no purple/blue SaaS
gradient clichés, no decorative serifs, no amber legacy tones (pre-rebrand).
