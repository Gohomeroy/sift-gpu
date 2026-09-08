#!/usr/bin/env python3
"""
Fetch the Apple Color Emoji PNG pack used by the Vizard caption renderer.

The Remotion server serves emoji from <RENDER_FILES_DIR>/emoji/ at
/clips/emoji/<name>.png. This script downloads the `emojiimages` npm
package (2251 Apple-style 200x200 PNGs, codepoint-named) and extracts them
into that directory so renders never need network: every emoji is available
locally.

Usage:
  python3 scripts/fetch_emojis.py --dir /workspace/sift/tmp/emoji

Idempotent: skips when the target already has the expected marker, unless
--force is given. Never exits non-zero (a missing emoji pack should degrade
renders to text glyphs, not kill the worker).
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
import tarfile
import tempfile
import urllib.request

PACKAGE_URL = (
    "https://registry.npmjs.org/emojiimages/-/emojiimages-1.2.1.tgz"
)
# Marker with the extracted count, e.g. "2251".
MARKER = ".emojiimages-1.2.1"


def fetch_emojis(target_dir: str, force: bool = False) -> int:
    target = os.path.abspath(target_dir)
    marker = os.path.join(target, MARKER)
    if not force and os.path.exists(marker):
        with open(marker, encoding="utf-8") as f:
            prev = f.read().strip()
        print(f"[emoji] already present ({prev} files) - skipping. Use --force to re-extract.")
        return 0

    os.makedirs(target, exist_ok=True)
    print(f"[emoji] downloading Apple Color Emoji pack from npm...")
    try:
        with urllib.request.urlopen(PACKAGE_URL, timeout=120) as resp:
            data = resp.read()
    except Exception as exc:  # pragma: no cover - network failure path
        print(f"[emoji] WARNING: download failed ({exc}); captions will fall back to text emoji")
        return 0

    count = 0
    tmp = os.path.join(tempfile.gettempdir(), "emojiimages.tgz")
    with open(tmp, "wb") as f:
        f.write(data)
    try:
        with tarfile.open(tmp, "r:gz") as tar:
            for member in tar.getmembers():
                name = os.path.basename(member.name)
                if not member.isfile() or not name.endswith(".png"):
                    continue
                entry = tar.extractfile(member)
                if entry is None:
                    continue
                out = os.path.join(target, name)
                with open(out, "wb") as out_f:
                    shutil.copyfileobj(entry, out_f)
                count += 1
        with open(marker, "w", encoding="utf-8") as f:
            f.write(str(count))
    except Exception as exc:  # pragma: no cover - tar/extract path
        print(f"[emoji] WARNING: extract failed ({exc}); captions will fall back to text emoji")
        return 0
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass

    print(f"[emoji] OK extracted {count} Apple emoji PNGs -> {target}")
    return count


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dir", default="emoji", help="target directory (default: <cwd>/emoji)")
    parser.add_argument("--force", action="store_true", help="re-extract even if present")
    args = parser.parse_args()
    fetch_emojis(args.dir, force=args.force)
    return 0


if __name__ == "__main__":
    sys.exit(main())