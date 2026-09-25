"""Loads the persona source material that context.py feeds into the system prompt.

Paths are resolved relative to this file, not the working directory: the server
is started from backend/ locally but runs from /var/task on Lambda, and the old
"./data/..." paths silently produced an empty persona in the second case.
"""

import json
from pathlib import Path

from pypdf import PdfReader

DATA_DIR = Path(__file__).parent / "data"


def _find(*names: str) -> Path | None:
    """First existing match, case-insensitively — the PDF is committed as
    Linkedin.pdf, which resolves on macOS but not on Lambda's Linux filesystem."""
    for name in names:
        candidate = DATA_DIR / name
        if candidate.exists():
            return candidate
    wanted = {name.lower() for name in names}
    for candidate in DATA_DIR.glob("*"):
        if candidate.name.lower() in wanted:
            return candidate
    return None


def _read_text(*names: str, default: str = "") -> str:
    path = _find(*names)
    if path is None:
        print(f"[resources] missing {names[0]} in {DATA_DIR}")
        return default
    return path.read_text(encoding="utf-8")


def _read_pdf(*names: str) -> str:
    path = _find(*names)
    if path is None:
        print(f"[resources] missing {names[0]} in {DATA_DIR}")
        return "LinkedIn profile not available"
    return "".join(page.extract_text() or "" for page in PdfReader(path).pages)


linkedin = _read_pdf("linkedin.pdf", "Linkedin.pdf", "LinkedIn.pdf")
summary = _read_text("summary.txt")
style = _read_text("style.txt")

_facts_path = _find("facts.json")
facts = json.loads(_facts_path.read_text(encoding="utf-8")) if _facts_path else {}
