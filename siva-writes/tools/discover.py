#!/usr/bin/env python3
"""Dump candidate article links from index pages so the corpus manifest can be curated by hand.

Discovery is separated from fetching on purpose: which posts enter the corpus is a
judgement call that gets recorded in sources.json, and a script that silently picks
"the first five links" would hide that choice inside a crawl.
"""
import json
import re
import sys
import urllib.parse
import urllib.request

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

INDEXES = {
    "danluu": ("https://danluu.com/", r"^https?://danluu\.com/[a-z0-9-]+/$"),
    "brooker": ("https://brooker.co.za/blog/", r"/blog/\d{4}/\d{2}/\d{2}/"),
    "brendangregg": ("https://www.brendangregg.com/blog/index.html", r"/blog/\d{4}-\d{2}-\d{2}/"),
    "allthingsdistributed": ("https://www.allthingsdistributed.com/", r"/\d{4}/\d{2}/[a-z0-9-]+\.html$"),
    "cloudflare-pm": ("https://blog.cloudflare.com/tag/outage/", r"^https?://blog\.cloudflare\.com/[a-z0-9-]+/?$"),
    "aws-builders": ("https://aws.amazon.com/builders-library/", r"/builders-library/[a-z0-9-]+/"),
    "sre-book": ("https://sre.google/sre-book/table-of-contents/", r"/sre-book/[a-z0-9-]+/"),
}


def get(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,*/*"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read().decode("utf-8", "replace")


def links(html: str, base: str, pattern: str) -> list[str]:
    rx = re.compile(pattern)
    out, seen = [], set()
    for href in re.findall(r'href=["\']([^"\']+)["\']', html):
        absolute = urllib.parse.urljoin(base, href.split("#")[0])
        if absolute in seen:
            continue
        if rx.search(absolute):
            seen.add(absolute)
            out.append(absolute)
    return out


def main() -> None:
    which = sys.argv[1:] or list(INDEXES)
    result = {}
    for name in which:
        url, pattern = INDEXES[name]
        try:
            found = links(get(url), url, pattern)
            result[name] = found
            print(f"### {name}  ({len(found)} candidates from {url})", file=sys.stderr)
            for link in found[:40]:
                print("   ", link, file=sys.stderr)
        except Exception as exc:  # noqa: BLE001 - discovery is best-effort, failures are reported
            result[name] = {"error": f"{type(exc).__name__}: {exc}"}
            print(f"### {name}  FAILED: {type(exc).__name__}: {exc}", file=sys.stderr)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
