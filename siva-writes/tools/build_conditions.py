#!/usr/bin/env python3
"""Build the four generation conditions from SKILL.md, so they cannot drift from the skill.

  A  no skill              the brief alone
  B  rules only            owner rules + the measured bar. No stages, no exemplars, no gate
  C  rules + exemplars     B, plus the two exemplars matching the document type, inline
  D  full skill            the whole SKILL.md, the brief->prose split, the exemplars, and the gate

The conditions are derived from the file rather than written out by hand for one reason: if B and C
are transcribed copies, then a Phase 5 edit to SKILL.md silently stops being under test, and the
comparison measures a skill nobody is running.

H is not built here. It is the human source span already stored on each brief.
"""
from __future__ import annotations

import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
SKILL = ROOT / "skill"


def sections(text: str) -> dict[str, str]:
    out, current, buf = {}, None, []
    for line in text.split("\n"):
        if re.match(r"^## ", line):
            if current:
                out[current] = "\n".join(buf).strip()
            current, buf = line[3:].strip(), []
        elif current:
            buf.append(line)
    if current:
        out[current] = "\n".join(buf).strip()
    return out


def main() -> None:
    skill_text = SKILL / "SKILL.md"
    full = skill_text.read_text()
    body = full.split("---", 2)[2] if full.startswith("---") else full
    sec = sections(body)

    rules_only = "\n\n".join([
        "# Writing rules",
        "## The owner rules\n" + sec["The owner rules"],
        "## The measured bar\n" + sec["The measured bar"],
    ])

    index = json.loads((SKILL / "references" / "exemplars" / "INDEX.json").read_text())

    conditions = {
        "A": {"label": "no skill", "system": "", "exemplars": False, "stages": False, "gate": False},
        "B": {"label": "rules only", "system": rules_only, "exemplars": False, "stages": False, "gate": False},
        "C": {"label": "rules + exemplars", "system": rules_only, "exemplars": True, "stages": False, "gate": False},
        "D": {"label": "full skill", "system": body.strip(), "exemplars": True, "stages": True, "gate": True},
    }

    out = ROOT / "eval" / "conditions"
    out.mkdir(parents=True, exist_ok=True)
    for key, spec in conditions.items():
        (out / f"{key}.md").write_text(spec["system"])
        meta = {k: v for k, v in spec.items() if k != "system"}
        meta["system_chars"] = len(spec["system"])
        (out / f"{key}.json").write_text(json.dumps(meta, indent=2))
        print(f'{key}  {spec["label"]:22s} system={len(spec["system"]):6d} chars  '
              f'exemplars={spec["exemplars"]}  stages={spec["stages"]}  gate={spec["gate"]}')

    print(f'\nexemplars available by genre: '
          f'{ {g: len(v) for g, v in index["by_genre"].items()} }')
    print(f'-> {out}')


if __name__ == "__main__":
    main()
