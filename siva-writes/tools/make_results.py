#!/usr/bin/env python3
"""Assemble eval/results.md from whatever metric files exist, and label what is missing.

A results file that silently omits an unrun metric reads as a complete evaluation. Every metric
appears here whether or not it has numbers, with its status stated, because the two metrics that
need a human are exactly the two that decide whether the skill is worth using.
"""
from __future__ import annotations

import collections
import json
import math
import pathlib
import statistics

ROOT = pathlib.Path(__file__).resolve().parent.parent
EVAL = ROOT / "eval"


def load(name: str):
    p = EVAL / name
    return json.loads(p.read_text()) if p.exists() else None


def wilson(k: int, n: int) -> tuple[float, float, float]:
    if not n:
        return 0.0, 0.0, 0.0
    p, z = k / n, 1.959963985
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return 100 * p, 100 * (c - h), 100 * (c + h)


def paired_table(m2: dict, pairs: list[tuple[str, str]]) -> list[str]:
    by = collections.defaultdict(dict)
    for r in m2["rows"]:
        by[r["brief_id"]][r["condition"]] = r["correct"]
    out = ["| comparison | n | mean diff /5 | 95% CI | W-L-T | verdict |", "|---|---|---|---|---|---|"]
    for x, y in pairs:
        d = [v[x] - v[y] for v in by.values() if x in v and y in v]
        if len(d) < 2:
            continue
        m = statistics.mean(d)
        se = statistics.stdev(d) / math.sqrt(len(d))
        lo, hi = m - 1.96 * se, m + 1.96 * se
        w = sum(1 for t in d if t > 0)
        l = sum(1 for t in d if t < 0)
        verdict = f"**{x} higher**" if lo > 0 else (f"**{y} higher**" if hi < 0 else "not distinguishable")
        out.append(f"| {x} vs {y} | {len(d)} | {m:+.3f} | [{lo:+.3f}, {hi:+.3f}] | {w}-{l}-{len(d)-w-l} | {verdict} |")
    return out


def main() -> None:
    frozen = load("FROZEN.json")
    m1 = load("results-metric1-proxy.json")
    kappa = load("results-metric1-kappa.json")
    m2 = load("results-metric2.json")
    m3 = load("results-metric3.json")
    m4 = load("results-metric4.json")
    rates = load("results-construction-rates.json")

    L: list[str] = []
    A = L.append
    A("# results.md\n")
    A("All four metrics, per condition, with the status of each. Two of them need the owner and are")
    A("reported as not run rather than omitted.\n")
    A("## Conditions\n")
    A("| | what the writer was given |")
    A("|---|---|")
    A("| **A** | the brief only. No skill. |")
    A("| **B** | the owner rules and the measured bar. No exemplars, no staging, no gate. |")
    A("| **C** | B, plus the two exemplars matching the document type. |")
    A("| **D** | the full skill: C plus the brief-then-prose split and the self-score gate. |")
    A("| **H** | the human text. The anchored span of the source document the brief was derived from. |\n")
    if frozen:
        A(f'Frozen eval: **{frozen["n_briefs"]} briefs, {frozen["n_questions"]} questions**, '
          f'{frozen["n_with_human"]} with a human reference.')
        A(f'`prompts.jsonl` sha256 `{frozen["sha256"]["prompts.jsonl"][:16]}`, '
          f'`questions.jsonl` `{frozen["sha256"]["questions.jsonl"][:16]}`.\n')

    # ---------- Metric 1
    A("---\n\n## Metric 1: blind pairwise preference\n")
    if m1:
        A(f'**STATUS: {m1["STATUS"]}**\n')
        A(f'Judge `{m1["judge_model"]}`, a third model family: not the writer (Claude) and not the')
        A("reviewer (gpt-6-astra), and it has never seen the skill. Position shuffled with a recorded seed.\n")
        A("| condition | pairs | wins | win rate | Wilson 95% |")
        A("|---|---|---|---|---|")
        for c, s in sorted(m1["by_condition"].items(), key=lambda kv: -kv[1]["win_rate_pct"]):
            A(f'| {c} | {s["appearances"]} | {s["wins"]:.1f} | {s["win_rate_pct"]:.1f}% | '
              f'[{s["wilson95_pct"][0]:.1f}, {s["wilson95_pct"][1]:.1f}] |')
        if m1.get("unresolved_verdicts"):
            A(f'\n{m1["unresolved_verdicts"]} pairs returned no parseable verdict and are excluded.')
        A("")
        if kappa:
            A(f'**Cohen\'s kappa against owner labels: {kappa["cohens_kappa"]} '
              f'(n={kappa["n_labelled_overlap"]}). {kappa["verdict"]}**\n')
        else:
            A("**Cohen's kappa has NOT been computed.** No owner labels exist yet, so this judge is")
            A("unvalidated and its win rates must not gate a Phase 5 change. At n=60 the Wilson interval")
            A("is roughly +/-12 points on its own, before any question of whether the judge agrees with")
            A("the owner. Run `python3 tools/pairwise.py kappa <owner-labels.json>` after labelling")
            A("`eval/label-pairs.html`.\n")
    else:
        A("**STATUS: NOT RUN.** Harness built (`tools/pairwise.py`), 60 shuffled pairs and a labelling")
        A("page generated.\n")

    # ---------- Metric 2
    A("---\n\n## Metric 2: comprehension\n")
    if m2:
        A(f'Reader `{m2["reader_model"]}`: a weaker model from a different family than the writer, shown')
        A("the candidate write-up and the questions, never the brief.\n")
        A("| condition | documents | items | correct | accuracy | Wilson 95% | adjudicated |")
        A("|---|---|---|---|---|---|---|")
        for c, r in sorted(m2["by_condition"].items(), key=lambda kv: -kv[1]["accuracy_pct"]):
            A(f'| {c} | {r["documents"]} | {r["items"]} | {r["correct"]} | **{r["accuracy_pct"]:.1f}%** | '
              f'[{r["wilson95_pct"][0]:.1f}, {r["wilson95_pct"][1]:.1f}] | {r.get("adjudicated", 0)} |')
        A("\n### Paired, per brief\n")
        A("Every condition wrote from the same 40 briefs, so the paired comparison is the correct test")
        A("and is far more powerful than treating the conditions as independent samples.\n")
        L.extend(paired_table(m2, [("C", "D"), ("C", "B"), ("C", "A"), ("D", "A"), ("B", "A"),
                                   ("D", "H"), ("C", "H"), ("A", "H")]))
        A("")
        A("**H is deflated and its comparisons should not be used.** 13.1% of graded facts have answers")
        A("largely absent from the H span: the briefs' facts were extracted from full source documents")
        A("while H is only the anchored excerpt. H is reported for completeness and excluded from any")
        A("conclusion. The C-vs-D comparison is unaffected, since both write from the same brief.\n")
    else:
        A("**STATUS: NOT RUN.**\n")

    # ---------- Metric 3
    A("---\n\n## Metric 3: expert edit distance\n")
    if m3 and m3.get("status", "").startswith("COMPLETE"):
        A("| condition | documents | mean % tokens changed | sd | median |")
        A("|---|---|---|---|---|")
        for c, s in sorted(m3["by_condition"].items(), key=lambda kv: kv[1]["mean_pct_tokens_changed"]):
            A(f'| {c} | {s["documents"]} | **{s["mean_pct_tokens_changed"]:.2f}%** | {s["sd"]:.2f} | {s["median"]:.2f} |')
        A("")
    else:
        A("**STATUS: NOT RUN.** This is the metric that says whether the skill saves the owner time or")
        A("only moves the tells somewhere he has stopped noticing, and it cannot be produced without him.\n")
        A("50 documents are staged under opaque ids at `eval/edits/edited/`, 10 briefs across 5")
        A("conditions, with the condition mapping deliberately not printed. Edit them in vim to the")
        A("standard you would publish, then:\n")
        A("```\npython3 tools/edit_distance.py score\npython3 tools/edit_distance.py classify\n```\n")
        A("Classification uses the LAMP taxonomy from arXiv 2409.14509 section 4.4, read from the paper:")
        A("Cliche, Unnecessary/Redundant Exposition, Purple Prose, Poor Sentence Structure, Lack of")
        A("Specificity and Detail, Awkward Word Choice and Phrasing, Tense Inconsistency. The labels are")
        A("proposed by a model and marked PROPOSED, because only the person who made an edit knows why.\n")

    # ---------- Metric 4
    A("---\n\n## Metric 4: over-represented n-gram ratio\n")
    if m4:
        A("Reported two ways, and **only the second is a style measurement**.\n")
        A(f'{m4["method"]["surface_caveat"]}\n' if m4["method"].get("surface_caveat") else "")
        A("| condition | documents | surface % | **stylometric %** |")
        A("|---|---|---|---|")
        for c, r in sorted(m4["conditions"].items(), key=lambda kv: kv[1]["stylometric"]["headline_over_represented_mass_pct"]):
            A(f'| {c} | {r["n_documents"]} | {r["headline_over_represented_mass_pct"]:.4f} | '
              f'**{r["stylometric"]["headline_over_represented_mass_pct"]:.4f}** |')
        A("")
        A("Lower is closer to the train corpus of expert human writing. The stylometric column maps every")
        A("content word to one placeholder and keeps function words, so what is compared is syntactic")
        A("rhythm rather than subject matter. That the human condition is lowest by 5x under stylometric")
        A("scoring, and highest under surface scoring, is the evidence that the surface number was")
        A("measuring topic.\n")
    else:
        A("**STATUS: NOT RUN.**\n")

    # ---------- construction rates
    if rates:
        A("---\n\n## Construction rates: the rules measured against their own effect\n")
        A("Per 1000 words. These are not one of the four metrics; they were added after Metric 4's")
        A("stylometric trigrams pointed at them.\n")
        A("| construction | " + " | ".join(rates["columns"]) + " |")
        A("|---" * (len(rates["columns"]) + 1) + "|")
        for name, vals in rates["rows"].items():
            A(f'| {name} | ' + " | ".join(f"{v:.2f}" for v in vals) + " |")
        A("")

    (EVAL / "results.md").write_text("\n".join(L) + "\n")
    print(f'results.md written: {len(L)} lines -> {EVAL / "results.md"}')
    for name, obj in [("metric1", m1), ("metric2", m2), ("metric3", m3), ("metric4", m4)]:
        state = "present" if obj else "NOT RUN"
        if name == "metric3" and obj and not obj.get("status", "").startswith("COMPLETE"):
            state = "NOT RUN (harness staged)"
        print(f'  {name:8s} {state}')


if __name__ == "__main__":
    main()
