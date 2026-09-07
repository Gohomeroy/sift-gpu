import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "worker"))

import config
import streamer_moment_detector as smd
import streamer_vl as svl

config.LLAMA_SERVER_URL = ""  # force VLM-unavailable path

segments = [
    {"start": 0.0, "end": 3.0, "text": "so this happened earlier"},
    {"start": 3.0, "end": 6.0, "text": "wait what did you just say"},
    {"start": 6.0, "end": 9.0, "text": "no way he really robbed the bank"},
    {"start": 9.0, "end": 12.0, "text": "I cannot believe that actually happened"},
    {"start": 12.0, "end": 15.0, "text": "chat is going insane right now"},
]

events = [
    {"timestamp": 3.5, "event_types": ["vocal_spike"], "signals": {"db": 0.8}, "initial_interest": 0.75},
    {"timestamp": 4.2, "event_types": ["shout"], "signals": {"db": 0.9}, "initial_interest": 0.85},
    {"timestamp": 9.5, "event_types": ["scene_change"], "signals": {"motion": 0.7}, "initial_interest": 0.65},
    {"timestamp": 18.0, "event_types": ["scene_change"], "signals": {"motion": 0.7}, "initial_interest": 0.5},
]

# merge_sequences + context_windows + build_candidates
seqs = smd.merge_sequences(events, gap=config.STREAMER_MERGE_GAP)
assert len(seqs) == 2, f"expected 2 sequences, got {len(seqs)}"
assert seqs[0]["initial_interest"] >= seqs[1]["initial_interest"], "should be interest-sorted"
assert set(seqs[0]["event_types"]) >= {"vocal_spike", "shout"}
cands = smd.build_candidates(seqs, segments, 100.0)
assert len(cands) > 0
for c in cands:
    assert 0.0 <= c["start"] < c["end"] <= 100.0
    assert len(c["text"]) > 0
print(f"OK detect: {len(seqs)} seqs -> {len(cands)} candidates")

# two-pass funnel degrades cleanly when VLM unreachable
analyzed = svl.analyze_candidates(cands, Path("x.mp4"), Path("."), segments, 100.0)
assert analyzed == [], f"expected [] without VLM, got {analyzed}"
print("OK analyze_candidates degrade -> []")

# composite_score weights
analysis = {
    "primary_category": "funny",
    "scores": {"humor": 80, "entertainment": 70, "reaction": 60, "unexpectedness": 50,
               "context_clarity": 90, "shareability": 40, "boringness": 10, "shock": 0,
               "controversy": 0, "scroll_stop": 0},
    "final_verdict": "strong_clip",
}
comp, parts = svl.composite_score(analysis)
assert comp > 50, f"funny comp too low: {comp}"
assert list(parts), "parts should list dims"

boring = dict(analysis["scores"], boringness=99, humor=100, entertainment=100)
an2 = dict(analysis, scores=boring)
comp2, _ = svl.composite_score(an2)
assert svl.verify_verdict(an2, comp2) == "reject", "boringness veto failed"
assert svl.verify_verdict(analysis, comp) == "possible", f"expected possible, got {svl.verify_verdict(analysis, comp)}"

# ratchet a few dims up so composite clears 70 → strong
hot = dict(analysis, scores=dict(analysis["scores"],
            humor=100, entertainment=95, reaction=90, context_clarity=95, shareability=85))
comp4, _ = svl.composite_score(hot)
assert comp4 >= 70, f"expected comp>=70, got {comp4}"
assert svl.verify_verdict(hot, comp4) == "strong", "strong verdict failed"

low = dict(analysis, scores=dict(analysis["scores"], context_clarity=5))
comp3, _ = svl.composite_score(low)
assert svl.verify_verdict(low, comp3) == "reject", "context veto failed"
print(f"OK scoring: funny={comp}, boring veto, context veto, verdict sweeps")

# select_finals variety + overlap + memory
t = 100.0
cands2 = []
for i, (cat, s, st, en) in enumerate([
    ("funny", 90, 0, 20), ("funny", 88, 18, 38), ("funny", 85, 40, 60),
    ("shocking", 80, 60, 80), ("reaction", 75, 80, 100),
]):
    cand = {"start": float(st), "end": float(en), "analysis": {
        "primary_category": cat,
        "scores": {"humor": s, "entertainment": s, "reaction": s, "unexpectedness": s,
                   "context_clarity": 90, "shareability": s, "scroll_stop": s,
                   "boringness": 5, "shock": 0, "controversy": 0},
        "final_verdict": "strong_clip",
        "best_clip": {"start": float(st), "end": float(en)},
    }}
    cands2.append(cand)
picks = svl.select_finals(cands2, 3, t)
assert 1 <= len(picks) <= 3
assert len({p["analysis"]["primary_category"] for p in picks}) >= 2, "variety cap failed"
assert not any(svl._overlap_ratio(a, b) > 0.50 for a in picks for b in picks if a is not b), "overlap leak"
# memory skip
mem = {svl.memory.window_key(p["start"], p["end"]) for p in picks}
fewer = svl.select_finals(cands2, 3, t, memory_used=mem)
assert len(fewer) < len(picks) or len(picks) == 1, "memory should reduce picks"
print(f"OK select_finals: picked {len(picks)} (cats {[p['analysis']['primary_category'] for p in picks]}), memory reduced to {len(fewer)}")

# transcript slice
sl = svl._transcript_slice(segments, 2.0, 7.0)
assert "did you just say" in sl
print("OK _transcript_slice")

print("\nALL STREAMER SMOKE TESTS PASSED")