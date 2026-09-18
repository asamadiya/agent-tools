#!/usr/bin/env python3
"""Metric 1: blind pairwise preference.

Three subcommands, and the separation between them is the point.

  build  - sample 60 condition pairs, shuffle position with a recorded seed, write pairs.json
  judge  - run a proxy judge over them. The proxy is gemini-3.8-flash: a third family, neither the
           writer (Claude) nor the skill's reviewer (gpt-6-astra), and one that has never seen the
           skill. Its output is labelled PROXY and is NOT validated.
  kappa  - once the owner has labelled the same pairs, compute Cohen's kappa between owner and
           proxy, and report whether the proxy clears the 0.6 bar.

Until kappa clears 0.6 the proxy's win rates are descriptive only and must not gate a Phase 5
change. That rule is the whole reason the judge is a separate subcommand from the metric: it is
easy to run a judge, get a number, and start optimising against an instrument nobody has checked.

Win rates carry a Wilson 95% interval. At n=60 that interval is roughly +/-12 points, so a
difference smaller than the interval is not a difference.
"""
from __future__ import annotations

import argparse
import html
import itertools
import json
import math
import pathlib
import random
import re
import subprocess
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor

ROOT = pathlib.Path(__file__).resolve().parent.parent
EVAL = ROOT / "eval"
PROXY_MODEL = "gemini-3.8-flash"
SEED = 20260918


def wilson(successes: float, n: int) -> tuple[float, float, float]:
    if n == 0:
        return 0.0, 0.0, 0.0
    p, z = successes / n, 1.959963985
    d = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / d
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return 100 * p, 100 * (centre - half), 100 * (centre + half)


def load_outputs(root: pathlib.Path) -> dict[str, dict[str, str]]:
    out: dict[str, dict[str, str]] = {}
    for d in sorted(p for p in root.iterdir() if p.is_dir()):
        out[d.name] = {p.stem: p.read_text(encoding="utf-8", errors="replace") for p in sorted(d.glob("*.txt"))}
    return out


def cmd_build(args) -> None:
    outputs = load_outputs(pathlib.Path(args.outputs))
    conditions = sorted(outputs)
    rng = random.Random(SEED)
    # Stratify across condition contrasts so the 60 pairs are not all one comparison. Every
    # unordered pair of conditions gets an equal share of the budget, over briefs both produced.
    contrasts = list(itertools.combinations(conditions, 2))
    per = max(1, args.n // len(contrasts))
    pairs = []
    for left, right in contrasts:
        shared = sorted(set(outputs[left]) & set(outputs[right]))
        rng.shuffle(shared)
        for bid in shared[:per]:
            flip = rng.random() < 0.5
            a_cond, b_cond = (right, left) if flip else (left, right)
            pairs.append({
                "pair_id": f"p{len(pairs) + 1:03d}",
                "brief_id": bid,
                "A_condition": a_cond,
                "B_condition": b_cond,
                "position_flipped": flip,
            })
    rng.shuffle(pairs)
    pairs = pairs[:args.n]
    for i, p in enumerate(pairs, 1):
        p["pair_id"] = f"p{i:03d}"
    (EVAL / "pairs.json").write_text(json.dumps({
        "seed": SEED, "n": len(pairs), "conditions": conditions,
        "contrasts": {f"{a}|{b}": sum(1 for p in pairs if {p["A_condition"], p["B_condition"]} == {a, b})
                      for a, b in contrasts},
        "pairs": pairs}, indent=2))
    print(f'{len(pairs)} pairs -> {EVAL / "pairs.json"}')
    for k, v in json.loads((EVAL / "pairs.json").read_text())["contrasts"].items():
        print(f'   {k:20s} {v}')
    write_label_ui(outputs)


def write_label_ui(outputs: dict) -> None:
    """A standalone page for the owner's 60 labels. No server: it downloads a JSON file."""
    spec = json.loads((EVAL / "pairs.json").read_text())
    briefs = {json.loads(l)["id"]: json.loads(l) for l in (EVAL / "prompts.jsonl").read_text().splitlines()}
    data = []
    for p in spec["pairs"]:
        data.append({
            "pair_id": p["pair_id"],
            "brief": briefs.get(p["brief_id"], {}).get("prompt", ""),
            "A": outputs[p["A_condition"]][p["brief_id"]],
            "B": outputs[p["B_condition"]][p["brief_id"]],
        })
    page = """<!doctype html><meta charset=utf-8><title>siva-writes pairwise</title>
<style>
 body{font:15px/1.5 ui-sans-serif,system-ui;margin:0;background:#12151a;color:#e6e6e6}
 header{position:sticky;top:0;background:#12151a;border-bottom:1px solid #2a2f38;padding:10px 16px;display:flex;gap:14px;align-items:center}
 .wrap{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:16px}
 .col{background:#171b22;border:1px solid #2a2f38;border-radius:8px;padding:14px;white-space:pre-wrap}
 .brief{margin:16px;padding:12px;border-left:3px solid #6ea8ff;background:#161a21;white-space:pre-wrap}
 button{background:#232a35;color:#e6e6e6;border:1px solid #39424f;border-radius:6px;padding:7px 13px;cursor:pointer;font:inherit}
 button.sel{background:#2f6d3f;border-color:#48a05f}
 #done{color:#8fd19e} kbd{background:#232a35;border:1px solid #39424f;border-radius:4px;padding:1px 5px}
</style>
<header>
 <b id=pos></b>
 <button onclick=vote('A')>A better <kbd>a</kbd></button>
 <button onclick=vote('B')>B better <kbd>b</kbd></button>
 <button onclick=vote('TIE')>indistinguishable <kbd>t</kbd></button>
 <button onclick=prev()>prev</button><button onclick=next_()>next</button>
 <span id=done></span>
 <button onclick=save() style="margin-left:auto">download labels</button>
</header>
<div class=brief id=brief></div>
<div class=wrap><div class=col id=A></div><div class=col id=B></div></div>
<script>
const D=__DATA__; let i=0; const L=JSON.parse(localStorage.getItem('sw_labels')||'{}');
function render(){const d=D[i];document.getElementById('pos').textContent=`${i+1}/${D.length} ${d.pair_id}`;
 document.getElementById('brief').textContent='BRIEF: '+d.brief;
 document.getElementById('A').textContent='A\\n\\n'+d.A;document.getElementById('B').textContent='B\\n\\n'+d.B;
 document.getElementById('done').textContent=Object.keys(L).length+' labelled';
 document.querySelectorAll('header button').forEach(b=>b.classList.remove('sel'));
 const v=L[d.pair_id]; if(v){const m={'A':0,'B':1,'TIE':2}[v]; document.querySelectorAll('header button')[m].classList.add('sel');}
 window.scrollTo(0,0);}
function vote(v){L[D[i].pair_id]=v;localStorage.setItem('sw_labels',JSON.stringify(L));if(i<D.length-1)i++;render();}
function prev(){if(i>0)i--;render();} function next_(){if(i<D.length-1)i++;render();}
function save(){const b=new Blob([JSON.stringify(L,null,2)],{type:'application/json'});
 const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='owner-labels.json';a.click();}
addEventListener('keydown',e=>{if(e.key==='a')vote('A');if(e.key==='b')vote('B');if(e.key==='t')vote('TIE');
 if(e.key==='ArrowLeft')prev();if(e.key==='ArrowRight')next_();});
render();
</script>"""
    (EVAL / "label-pairs.html").write_text(page.replace("__DATA__", json.dumps(data)))
    print(f'labelling page -> {EVAL / "label-pairs.html"}')


def cmd_judge(args) -> None:
    spec = json.loads((EVAL / "pairs.json").read_text())
    outputs = load_outputs(pathlib.Path(args.outputs))
    briefs = {json.loads(l)["id"]: json.loads(l) for l in (EVAL / "prompts.jsonl").read_text().splitlines()}
    judge_prompt = (EVAL / "judge-prompt.md").read_text()

    def run(p):
        a = outputs[p["A_condition"]][p["brief_id"]]
        b = outputs[p["B_condition"]][p["brief_id"]]
        prompt = (f"{judge_prompt}\n\n=== BRIEF ===\n{briefs[p['brief_id']]['prompt']}\n\n"
                  f"=== CANDIDATE A ===\n{a}\n\n=== CANDIDATE B ===\n{b}\n")
        try:
            proc = subprocess.run(
                ["copilot", "--model", PROXY_MODEL, "--reasoning-effort", "medium",
                 "--session-id", str(uuid.uuid4()), "--allow-all-tools", "--silent", "-p", prompt],
                capture_output=True, text=True, timeout=480)
            text = proc.stdout or ""
        except subprocess.TimeoutExpired:
            return {**p, "verdict": None, "error": "timeout"}
        m = re.findall(r"VERDICT:\s*(A|B|TIE)", text.upper())
        return {**p, "verdict": m[-1] if m else None, "raw_tail": text[-400:]}

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        results = []
        for i, r in enumerate(pool.map(run, spec["pairs"]), 1):
            results.append(r)
            print(f'[{i}/{len(spec["pairs"])}] {r["pair_id"]} {r["A_condition"]} vs {r["B_condition"]} -> {r["verdict"]}',
                  file=sys.stderr, flush=True)

    wins = {c: 0.0 for c in spec["conditions"]}
    appearances = {c: 0 for c in spec["conditions"]}
    head = {}
    for r in results:
        a, b = r["A_condition"], r["B_condition"]
        appearances[a] += 1
        appearances[b] += 1
        key = "|".join(sorted([a, b]))
        head.setdefault(key, {"n": 0, **{c: 0.0 for c in sorted([a, b])}})
        head[key]["n"] += 1
        if r["verdict"] == "A":
            wins[a] += 1; head[key][a] += 1
        elif r["verdict"] == "B":
            wins[b] += 1; head[key][b] += 1
        elif r["verdict"] == "TIE":
            wins[a] += 0.5; wins[b] += 0.5
            head[key][a] += 0.5; head[key][b] += 0.5

    summary = {}
    for c in spec["conditions"]:
        rate, lo, hi = wilson(wins[c], appearances[c])
        summary[c] = {"appearances": appearances[c], "wins": wins[c],
                      "win_rate_pct": round(rate, 2), "wilson95_pct": [round(lo, 2), round(hi, 2)]}

    (EVAL / "results-metric1-proxy.json").write_text(json.dumps({
        "STATUS": "PROXY, UNVALIDATED. Cohen's kappa against owner labels has not been computed. "
                  "These win rates are descriptive and must not gate a Phase 5 change.",
        "judge_model": PROXY_MODEL,
        "judge_is_different_family_from_writer": True,
        "judge_has_not_seen_the_skill": True,
        "position_shuffled_seed": spec["seed"],
        "unresolved_verdicts": sum(1 for r in results if r["verdict"] is None),
        "by_condition": summary, "head_to_head": head, "rows": results}, indent=2))

    print(f'\n{"condition":12s}{"pairs":>7s}{"wins":>8s}{"win%":>8s}{"wilson95":>18s}')
    for c, s in summary.items():
        print(f'{c:12s}{s["appearances"]:7d}{s["wins"]:8.1f}{s["win_rate_pct"]:8.2f}'
              f'   [{s["wilson95_pct"][0]:.1f}, {s["wilson95_pct"][1]:.1f}]')
    print("\nSTATUS: PROXY, UNVALIDATED - kappa not yet computed against owner labels.")


def cmd_kappa(args) -> None:
    proxy = {r["pair_id"]: r["verdict"] for r in json.loads((EVAL / "results-metric1-proxy.json").read_text())["rows"]}
    owner = json.loads(pathlib.Path(args.owner_labels).read_text())
    shared = [k for k in owner if k in proxy and proxy[k] and owner[k]]
    if not shared:
        raise SystemExit("no overlapping labelled pairs")
    cats = ["A", "B", "TIE"]
    agree = sum(1 for k in shared if owner[k] == proxy[k]) / len(shared)
    expected = sum((sum(1 for k in shared if owner[k] == c) / len(shared)) *
                   (sum(1 for k in shared if proxy[k] == c) / len(shared)) for c in cats)
    kappa = (agree - expected) / (1 - expected) if expected < 1 else 0.0
    verdict = "USABLE for iteration" if kappa >= 0.6 else "NOT USABLE - below the 0.6 bar"
    payload = {"n_labelled_overlap": len(shared), "raw_agreement": round(agree, 4),
               "expected_agreement": round(expected, 4), "cohens_kappa": round(kappa, 4),
               "bar": 0.6, "verdict": verdict,
               "confusion": {f"owner={o},proxy={p}": sum(1 for k in shared if owner[k] == o and proxy[k] == p)
                             for o in cats for p in cats}}
    (EVAL / "results-metric1-kappa.json").write_text(json.dumps(payload, indent=2))
    print(json.dumps(payload, indent=2))


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build"); b.add_argument("--outputs", default=str(EVAL / "outputs")); b.add_argument("--n", type=int, default=60); b.set_defaults(fn=cmd_build)
    j = sub.add_parser("judge"); j.add_argument("--outputs", default=str(EVAL / "outputs")); j.add_argument("--workers", type=int, default=6); j.set_defaults(fn=cmd_judge)
    k = sub.add_parser("kappa"); k.add_argument("owner_labels"); k.set_defaults(fn=cmd_kappa)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
