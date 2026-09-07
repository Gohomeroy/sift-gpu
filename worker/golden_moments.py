"""Golden-moment calibration examples for the streamer funnel.

When a real editor validated moments (Reka picks, manual cuts), we inject them
into the Qwen3-VL prompts as few-shot reference: "these are clips a top editor
kept from this kind of stream — match this bar." This teaches the model taste
without retraining, and is the calibration target QA uses to judge picks.
"""

from __future__ import annotations

# Each entry: window (uses the ORIGINAL source timestamps, in real seconds),
# what happened, why it goes viral, and a short transcript excerpt so Qwen can
# anchor the *structure* (setup -> escalation -> payoff/reaction).
GOLDEN_MOMENTS: list[dict] = [
    {
        "source": "yt:t2H0PPvQn6k",
        "name": "Wig plot + spit-game standoff",
        "start": 332.0,
        "end": 402.0,
        "category": "shocking",
        "what_happens": (
            "Streamer is introduced to a group of girls (guy in a wig is there). "
            "He visibly plots to snatch the guy's wig. A girl asks where his game is; "
            "he says he's not there to spit game; she says do it for fun; he escalates "
            "crudely; she gives it right back; he bleats and folds."
        ),
        "why_viral": (
            "Escalation chain: plot -> challenge -> crude comeback -> she one-ups "
            "him -> he whines. Every beat adds tension, and the payoff is a public "
            "comedown. Shock + humor + a quotable back-and-forth."
        ),
        "excerpt": (
            "There's a wig... which one of these girls you like the most... "
            "I'm not trying to spit game. I'm here for the vibes. Oh for fun. "
            "Yeah, get down and let me suck your... get on your knees for me. "
            "What bitch no."
        ),
    },
    {
        "source": "yt:t2H0PPvQn6k",
        "name": "Live hair transformation tour",
        "start": 746.0,
        "end": 896.0,
        "category": "funny",
        "what_happens": (
            "Streamer got his hair transformed live on stream. He walks around the "
            "house showing it to everyone — security guards, crew — collecting "
            "reactions while chat reacts. Visual transformation + social tour."
        ),
        "why_viral": (
            "Before/after transformation is visually satisfying, and the reveal gets "
            "reaction after reaction from real people (guards/crew). Wander-around "
            "format keeps the energy moving instead of sitting on one static frame."
        ),
        "excerpt": (
            "It'll be hard to fix to be real... it looks so good... like a porcupine... "
            "you actually look way better... you look clean... I look like a Dominican... "
            "you're like a mini Indian version of me."
        ),
    },
    {
        "source": "yt:t2H0PPvQn6k",
        "name": "Chat-setup rejection (3 beautiful women)",
        "start": 1430.0,
        "end": 1564.0,
        "category": "awkward",
        "what_happens": (
            "Chat tells the co-streamer to relay the girls are three beautiful women. "
            "Co-streamer sets the streamer up: 'he wants to take all three of you home.' "
            "One girl declines flatly -> the famous rich streamer gets publicly rejected. "
            "Followed by harmlessly weird chat-goaded questions (mouth breathers)."
        ),
        "why_viral": (
            "Setup-and-betrayal structure: co-streamer engineers the ambush, pride comes "
            "before the fall, audience sees the streamer get shot down despite fame/money. "
            "Embarrassment + complicity + a trace of wholesome weirdness afterward."
        ),
        "excerpt": (
            "They're saying you guys are three beautiful women... he wants to take all "
            "three of you home. Oh, I'm sorry. Wait, what? I'm sorry. No... "
            "The chat asked you guys mouth breathers? No. Do I look like an operator?"
        ),
    },
    {
        "source": "yt:t2H0PPvQn6k",
        "name": "How to test women / terrible advice cycle",
        "start": 2347.0,
        "end": 2459.0,
        "category": "funny",
        "what_happens": (
            "Streamer discusses how to tell if a girl really likes him vs his money. "
            "His advice is confidently bad (take her to a regular restaurant, pick her "
            "up in a Corolla, ask 'is this a gift for my mom?') and the listener "
            "immediately calls it out: 'that was terrible.'"
        ),
        "why_viral": (
            "Self-own spiral: he seeks advice, the advice keeps landing on bad takes, "
            "and the callback pays it off with an instant roast. Relatable, quotable, "
            "comment-bait (people weigh in on the advice in the comments)."
        ),
        "excerpt": (
            "You need to test them... pick them up in a Camry... is this a gift for "
            "my mom? You're a girl, right? Yeah. What type of advice is that? "
            "That was terrible."
        ),
    },
]


def calibration_block() -> str:
    """Markdown-ish block appended to PASS A/B prompts as the taste bar."""
    lines = [
        "REFERENCE: top-editor clips from THIS kind of stream. Judge the candidate "
        "against this bar — a candidate should have a real escalation, a payoff, a "
        "reaction, or an emotional spike to qualify. Generic smalltalk, party "
        "scenery, greetings or 'hello, how are you' banter is NOT clip-worthy:",
    ]
    for g in GOLDEN_MOMENTS:
        lines.append(
            f"- [{g['name']}] ({g['category']}) — {g['what_happens']}\n"
            f"    WHY IT WORKS: {g['why_viral']}\n"
            f"    BEATS: {g['excerpt']}"
        )
    lines.append(
        "When in doubt, ask yourself: would a stranger who never saw this stream "
        "smile, laugh, cringe or react? If the honest answer is no — reject it."
    )
    return "\n\n".join(lines)


def _text_for_window(
    segments: list[dict], start: float, end: float
) -> str:
    """Concatenate transcript segments overlapping [start, end]."""
    parts = [
        seg.get("text", "")
        for seg in segments
        if float(seg.get("end", 0)) > start and float(seg.get("start", 0)) < end
    ]
    return " ".join(parts).strip()


def candidate_overrides(
    src_key: str,
    segments: list[dict],
    total_duration: float,
) -> list[dict]:
    """Explicitly-bounded golden candidates for a matching source.

    When a job re-runs the same video we already have editor-validated clips
    for, force those windows back into the candidate pool. They get a high
    initial_interest plus a `golden_name` marker so PASS A/B score them dead
    center of the model's now-calibrated judgment instead of hoping a spread
    scan happens to overlap them.
    """
    out: list[dict] = []
    for g in GOLDEN_MOMENTS:
        if not g.get("source") or g["source"] != src_key:
            continue
        start = round(float(g["start"]), 2)
        end = round(min(float(g["end"]), total_duration), 2)
        if end - start < 1.0:
            continue
        out.append(
            {
                "start": start,
                "end": end,
                "peak": round((start + end) / 2.0, 2),
                "event_types": ["golden_reference"],
                "signals": {"editors_pick": 1.0},
                "initial_interest": 1.0,
                "text": _text_for_window(segments, start, end),
                "golden_name": str(g.get("name", "")),
            }
        )
    return out