#!/usr/bin/env python3
"""Fetch and extract the public corpus described by corpus/sources.json.

Two things here are deliberate and worth keeping.

First, every document records the method that actually retrieved it (direct, wayback,
reader) alongside a sha256 of the extracted text. A corpus whose provenance is not
recorded cannot be re-split or re-measured later without refetching the internet.

Second, extraction fails loudly on thin output. An article URL that returns a 200 and a
JavaScript shell yields forty words of navigation chrome, and forty words of navigation
chrome scores beautifully on every prose metric in Phase 2. A quiet skip would put that
score in the corpus mean. MIN_WORDS turns it into a recorded failure instead.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import pathlib
import re
import sys
import time
import urllib.parse
import urllib.request
import zlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "corpus" / "raw"
TEXT = ROOT / "corpus" / "text"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
HEADERS = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Upgrade-Insecure-Requests": "1",
}
# The thin-extraction guard exists to catch a JavaScript shell that returns 200 and forty
# words of navigation chrome. A short-by-design README is a different thing, so the floor is
# set per genre rather than globally - a single 400-word floor rejected stop-slop's own README.
MIN_WORDS = {"principles": 150, "negative": 150}
DEFAULT_MIN_WORDS = 400
RETRIES = 3
DROP_TAGS = ("script", "style", "nav", "header", "footer", "aside", "form", "noscript", "svg", "iframe")


def decompress(raw: bytes, encoding: str) -> bytes:
    """Wayback's id_ endpoint replays the origin's original bytes, gzip header and all."""
    if raw[:2] == b"\x1f\x8b" or encoding == "gzip":
        return gzip.decompress(raw)
    if encoding == "deflate":
        return zlib.decompress(raw, -zlib.MAX_WBITS)
    return raw


def fetch(url: str, timeout: int = 60) -> bytes:
    req = urllib.request.Request(url, headers={**HEADERS, "Accept-Encoding": "gzip, deflate"})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return decompress(response.read(), response.headers.get("Content-Encoding", ""))


def wayback(url: str) -> bytes:
    api = "http://archive.org/wayback/available?url=" + urllib.parse.quote(url, safe="")
    snap = json.loads(fetch(api, 45).decode("utf-8", "replace"))
    closest = snap.get("archived_snapshots", {}).get("closest")
    if not closest or not closest.get("available"):
        raise RuntimeError("no wayback snapshot")
    # id_ serves the original bytes without the archive's own banner markup.
    return fetch(closest["url"].replace("/http", "id_/http", 1), 90)


def reader(url: str) -> bytes:
    return fetch("https://r.jina.ai/" + url, 90)


def html_to_text(raw: bytes) -> str:
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(raw, "lxml")
    for tag in soup(list(DROP_TAGS)):
        tag.decompose()
    # Prefer the semantic container; fall back to whichever block holds the most prose.
    node = soup.find("article") or soup.find("main") or soup.find(attrs={"role": "main"})
    if node is None:
        blocks = soup.find_all(["div", "section", "body"])
        node = max(blocks, key=lambda b: len(b.get_text(" ", strip=True)), default=soup)
    parts: list[str] = []
    targets = ["h1", "h2", "h3", "h4", "p", "li", "pre", "blockquote", "td"]
    for el in node.find_all(targets):
        # Take only leaf-most blocks. A <blockquote><p>...</p></blockquote> matches twice otherwise,
        # once as the blockquote and once as the paragraph inside it, and the same words enter the
        # corpus twice. Measured across the training HTML that was 23,315 duplicated word
        # contributions, with some GCP extracts approaching half their length.
        if el.find(targets):
            continue
        chunk = el.get_text(" ", strip=True)
        if chunk:
            parts.append(chunk)
    text = "\n\n".join(parts) if parts else node.get_text("\n", strip=True)
    return re.sub(r"\n{3,}", "\n\n", text)

def pdf_to_text(raw: bytes) -> str:
    import fitz

    with fitz.open(stream=raw, filetype="pdf") as doc:
        return re.sub(r"\n{3,}", "\n\n", "\n".join(page.get_text() for page in doc))


def extract(raw: bytes, kind: str) -> str:
    if kind == "pdf":
        return pdf_to_text(raw)
    if kind in ("rst", "md", "txt"):
        return raw.decode("utf-8", "replace")
    return html_to_text(raw)


def words(text: str) -> int:
    return len(re.findall(r"[A-Za-z][A-Za-z'’-]*", text))


def run_one(doc: dict) -> dict:
    doc_id, kind = doc["id"], doc.get("kind", "html")
    urls = [doc["url"], *doc.get("fallback_urls", [])]
    order = doc.get("methods") or ["direct", "wayback", "reader"]
    floor = MIN_WORDS.get(doc.get("genre", ""), DEFAULT_MIN_WORDS)
    attempts: list[str] = []
    for url in urls:
        for method in order:
            for attempt in range(RETRIES):
                try:
                    raw = {"direct": fetch, "wayback": wayback, "reader": reader}[method](url)
                    text = extract(raw, "txt" if method == "reader" else kind).strip()
                    count = words(text)
                    if count < floor:
                        attempts.append(f"{method} {url}: thin ({count} words < {floor})")
                        break
                    ext = kind if method != "reader" else "txt"
                    (RAW / f"{doc_id}.{ext}").write_bytes(raw)
                    (TEXT / f"{doc_id}.txt").write_text(text, encoding="utf-8")
                    return {
                        **doc,
                        "status": "ok",
                        "method": method,
                        "resolved_url": url,
                        "words": count,
                        "chars": len(text),
                        "sha256": hashlib.sha256(text.encode()).hexdigest(),
                        "attempts": attempts,
                    }
                except Exception as exc:  # noqa: BLE001 - failures are recorded, never raised
                    attempts.append(f"{method} {url} try{attempt + 1}: {type(exc).__name__}: {exc}")
                    time.sleep(2 * (attempt + 1))
    return {**doc, "status": "FAILED", "attempts": attempts}


def main() -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    TEXT.mkdir(parents=True, exist_ok=True)
    sources = json.loads((ROOT / "corpus" / "sources.json").read_text())
    only = set(sys.argv[1:])
    results = []
    for doc in sources["documents"]:
        if only and doc["family"] not in only and doc["id"] not in only:
            continue
        row = run_one(doc)
        results.append(row)
        mark = "ok  " if row["status"] == "ok" else "FAIL"
        detail = f'{row.get("method","-"):8s} {row.get("words",0):6d}w'
        print(f'{mark} {row["family"]:22s} {row["id"]:46s} {detail}', file=sys.stderr, flush=True)
        if row["status"] != "ok":
            for line in row["attempts"]:
                print(f"       {line}", file=sys.stderr, flush=True)
    out = ROOT / "corpus" / "manifest.json"
    prior = json.loads(out.read_text())["documents"] if out.exists() else []
    merged = {d["id"]: d for d in prior}
    merged.update({d["id"]: d for d in results})
    documents = sorted(merged.values(), key=lambda d: (d["family"], d["id"]))
    ok = [d for d in documents if d["status"] == "ok"]
    out.write_text(
        json.dumps(
            {
                "split": sources["split"],
                "min_words": {"default": DEFAULT_MIN_WORDS, **MIN_WORDS},
                "counts": {"total": len(documents), "ok": len(ok), "failed": len(documents) - len(ok)},
                "documents": documents,
            },
            indent=2,
        )
    )
    print(f"\n{len(ok)}/{len(documents)} ok -> {out}", file=sys.stderr)


if __name__ == "__main__":
    main()
