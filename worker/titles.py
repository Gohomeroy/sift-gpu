"""Titles + social captions for selected clips.

Deterministic template system (no external API). Uses the top-scoring
sentence as the hook line and the strongest keywords for hashtags.
"""

from __future__ import annotations

import re

STOPWORDS = set(
    "the a an and or but if then so of to in on at for with is are was were "
    "be been being it its this that these those i you he she we they my your "
    "our their me him her them us what how why when where who as by from not "
    "no yes do does did done have has had will would can could should just "
    "like really very about there here get got gonna wanna".split()
)

TITLE_TEMPLATES = [
    "{hook}",
    "Why {keyword} changes everything",
    "The truth about {keyword}",
    "{keyword}: the part nobody talks about",
    "This {keyword} story is wild",
]


def _keywords(text: str) -> list[str]:
    words = re.findall(r"[a-zA-Z']{4,}", text.lower())
    seen: list[str] = []
    for w in words:
        if w in STOPWORDS or w in seen:
            continue
        seen.append(w)
        if len(seen) >= 8:
            break
    return seen


def make_title(window: dict) -> str:
    first = re.split(r"(?<=[.!?])\s+", window["text"].strip())
    hook = next((s for s in first if len(s.split()) >= 4), window["text"])
    hook = hook.strip().rstrip(".!?")
    hook = hook[0].upper() + hook[1:] if hook else "Untitled moment"
    if len(hook) > 80:
        hook = hook[:77] + "..."
    kw = (_keywords(window["text"]) or ["this"])[0]
    template = TITLE_TEMPLATES[hash(hook) % len(TITLE_TEMPLATES)]
    title = template.format(hook=hook, keyword=kw)
    if template == "{hook}":
        title = hook
    return title[:120]


def make_caption_and_tags(window: dict, vl: dict | None) -> tuple[str, list[str]]:
    text = window["text"]
    kws = _keywords(text)
    tags = [f"#{re.sub(r'[^a-z0-9]', '', w)[:20].capitalize()}" for w in kws[:5]]
    tags += ["#fyp", "#viral", "#shorts"]

    if vl and vl.get("reasoning"):
        caption = f"{vl['hook']}: {text[:90]}..." if len(text) > 90 else f"{vl['hook']}: {text}"
        if vl.get("hook"):
            tags.insert(0, f"#{re.sub(r'[^a-z0-9]', '', vl['hook'].split()[0])[:20].capitalize()}")
    else:
        opener = text[:100]
        caption = f"{opener}{'...' if len(text) > 100 else ''}"
    return caption[:220], tags[:10]
