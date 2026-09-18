# negative-set.md
Machine-checkable patterns of AI-sounding prose, extracted independently from four sources -
the Wikipedia project page *Signs of AI writing*, the humanizer README's 33 patterns, a close
reading of why frontier-model prose reads badly, and OpenAI's own write-up of how a reward signal
drove one lexical tic into their models.

`skill/scripts/prose-check.py` enforces tier 1 and flags tier 2. The machine-readable source is
`negative-set.json`; this file is generated from it.

## How a pattern earns tier 1

A rule that fires on legitimate technical writing is worse than no rule, because the author learns
to ignore the linter. Tiering is therefore derived from two tests rather than chosen:

1. **Pooled negative examples.** Each extraction supplied sentences that look like the tell but are
   correct engineering prose. Every regex is run against all 262 of them, not only its author's -
   a pattern survives its own author's negatives by construction, because the same agent wrote both.
2. **Expert-prose control.** Every regex is run over the 30 train-corpus documents, 184,722 words of
   published writing by Brooker, Dean, Vogels, Luu, the AWS Builders' Library, the SRE book, Python
   PEPs and Rust RFCs. **A tier-1 pattern fires zero times there.**

The second test is what does the work. Five patterns passed the hand-written negatives and were
demoted by the corpus, including one that fired 215 times across 15 documents.

| tier | n | enforcement |
|---|---|---|
| 1 | 25 | fails the document |
| 2 | 43 | flagged for a human read |
| 3 | 16 | no usable regex; prose guidance only |

---

## Tier 1 -- these fail

### not-just-x-its-y
The load-bearing element is the doubled copula: the same dummy subject ('it'/'this'/'that' + is) on both sides of the pivot. Legitimate 'not just A but also B' constructions carry a real subject on at least one side, which is why both negatives stay silent. Verified against both.
**Repair.** Drop the negated half and assert the claim once: 'The cache is the consistency boundary.' If both halves carry information, they are two sentences with two subjects, not one elevation move.
```
regex: \b(?:it|that|this)\s*(?:'s\s+not|\s+is\s+not|\s+isn'?t)\s+(?:just|merely|only|simply)\b[^.;!?\n]{1,80}[,;:—–-]\s*(?:it|that|this)\s*(?:'s|\s+is)\b
```
Fires on:
- It's not just a cache, it's a consistency boundary.
- This isn't just a latency problem — it's a correctness problem.
- It's not just a caching problem - it's a correctness problem.
Must not fire on:
- The regression is not just in the write path; the read path also slowed.
- It is not only slower, it fails closed on timeout.
- The p99 regression is not in the serializer but in the codec.

> _it's not just X, it's Y_

### goblin-token
Lookarounds exclude identifier contexts, so `goblin_mode` and GOBLIN_MODE-style code spans do not fire (verified). Run after stripping fenced/backticked code, like every lexical rule here. The only genuine over-fire domain is a document actually about game content, which the target genres are not.
**Repair.** Name the actual defect: 'three unguarded retries', 'an unbounded queue'. The word carries no technical content and marks the sentence as generated.
```
regex: (?<![A-Za-z_])goblins?(?![A-Za-z_])
```
Fires on:
- There are a few goblins hiding in the retry path.
- We inherited some goblins from the v1 scheduler.
Must not fire on:
- The `goblin_mode` flag is disabled in production.
- We ripped out the gremlin script that randomly killed pods.

> _[goblins](https://openai.com/index/where-the-goblins-came-from/)_

### creature-in-metaphor-frame
This encodes the source's own auditing lesson: the same lexeme is a tic or legitimate depending on frame, so the rule is frame-gated rather than lexeme-gated. Requires an explicit simile/metaphor frame immediately before the creature noun, which is why troll/frog/pigeon can be included here but not in the bare lexical rule. Zero corpus false positives. Known miss: a creature introduced as a bare subject ("The gnome that owns the lock table") has no frame and will not fire.
**Repair.** Drop the creature and state the comparison in mechanism terms: what resource does the analogue consume, what does it contend with, what is its rate.
```
regex: \b(?:like|as if it(?:'s| is| were)|is basically|is essentially|think of .{0,28}? as|imagine|picture)\s+(?:a |an |some |the |your |our )?(?:little |tiny |angry |friendly |grumpy |mischievous |hungry |sleepy |grouchy )?(?:goblin|gremlin|ogre|raccoon|imp|sprite|elf|elves|dragon|wizard|monster|critter|c
```
Fires on:
- Think of the GC as a raccoon rummaging through the heap.
- The retry storm is basically a troll under the bridge.
- Imagine a tiny frog hopping between shards.
Must not fire on:
- The frog-boiling failure mode is well documented in the SRE book.
- Pigeonhole principle guarantees at least one bucket holds two keys.
- Internet trolls generate a disproportionate share of abuse reports.

> most uses of frog turned out to be legitimate

### clipped-negative-fragments
Requires two consecutive verbless "No X." sentences, which is what distinguishes the rhythm from a single legitimate negative statement. Recovered from the version history, which added "clipped negative endings" in 2.5.0 and folded them into pattern 2 in 3.0.0.
**Repair.** Merge the fragments into one sentence that says what is absent and why it matters: "The agent reads no config file; every knob is a flag."
```
regex: (?:^|[.!?]\s+)No [a-z]+(?:\s+[a-z]+)?\.\s+No [a-z]+
```
Fires on:
- No prior. No nostalgia.
- No config. No daemons. No excuses.
Must not fire on:
- No configuration file is required for the agent.
- No retries are issued after the budget is exhausted; the request fails fast.

> Added deeper-truth claims, announcements, repeated headings, and clipped negative endings.

### pause-command
The imperative must be the whole sentence, which is what separates it from "wait for"/"must wait". From the 2.11.3 note, folded into pattern 2 in 3.0.0.
**Repair.** Delete the command. If the next fact is the surprising one, put the surprise in the fact: "The lock was already held by the same thread - the mutex is not reentrant."
```
regex: (?:^|[.!?]\s+)(?:wait|pause|stop|think about (?:it|that)|let that sink in|read that again)\.
```
Fires on:
- Let that sink in.
- Wait. The lock was already held.
Must not fire on:
- Wait for the canary to bake for 30 minutes.
- The client must wait until the lease expires.

> Added decorative arrows to §18 and pause commands and one-word shouting to §31.

### deepity-opener
"at the core of X" (a real component) is legitimate and is excluded by requiring the possessive "its". Aphorisms of the form "X is the language of Y" are caught only in that exact shape; other coined maxims need a human read.
**Repair.** Cut the opener and keep the claim, then make the claim specific enough to be wrong: "Users abandon the page after 2 s, so p95 is the budget that matters."
```
regex: \bat its core\b|\bat the end of the day\b|\bwhen all is said and done\b|\bthe (?:true|real) (?:essence|nature) of\b|\bis the language of\b
```
Fires on:
- At its core, what matters is trust.
- At the end of the day, latency is a product decision.
Must not fire on:
- At the core of the scheduler sits a min-heap.
- The essence of the algorithm is a two-pass scan over the WAL.

> **Sayings that sound deep** | "At its core, what matters is...", "Symmetry is the language of trust"

### staged-run-up
"Let's walk through" and "before we deploy" are ordinary and useful in postmortems and runbooks, so the verb list is restricted to dive/jump/unpack/break-it-down. "The thing is," was deliberately excluded - engineers write it in correct prose.
**Repair.** Delete the run-up and open on the first fact: "The flame graph puts 61% of CPU in the codec's copy loop."
```
regex: \blet'?s (?:dive|jump) (?:in|into)\b|\bbefore we (?:dive|jump|get started)\b|\bwithout further ado\b|\bbuckle up\b|\bhere'?s the (?:thing|kicker)\b|\blet'?s (?:unpack|break it down)\b|\bstrap in\b
```
Fires on:
- Let's dive into the flame graph.
- Here's the thing: the lock is fair.
Must not fire on:
- Let's walk through the timeline minute by minute.
- Before we deploy, the canary must hold for 30 minutes.

> **Staged run-up before the point** | "Let's dive in", "Honestly? It depends..."

### borrowed-authority
The negative lookahead suppresses the rule when a citation, link, DOI, or "et al." follows within the same sentence, so a properly sourced claim never fires. Singular "the benchmark shows" / "the profile shows" are excluded - those name a specific artifact.
**Repair.** Name the source and what it measured, or delete the claim: "Dean and Barroso (2013) measured a 10x tail amplification at 100 fan-out."
```
regex: \b(?:experts?|researchers?|studies|research|analysts?)\s+(?:believe|say|suggest|show|agree|indicate|argue|note)s?\b(?![^.\n]{0,100}(?:\[|\(|https?:|doi|et al\.))|\bit is (?:widely|generally) (?:known|believed|accepted|understood)\b
```
Fires on:
- Experts believe the approach scales.
- It is widely accepted that tail latency dominates.
Must not fire on:
- Dean and Barroso show that tail latency dominates at scale [2013].
- Research shows the same effect (https://example.com/report).
- The benchmark shows a 3x regression on the write path.

> **Borrowed authority** | "Experts believe...", "cited in NYT, BBC, FT, and The Hindu"

### decorative-heading
Two alternatives. The emoji/arrow branch is exact. The title-case branch needs four or more consecutive Capitalized-lowercase words, which is why "HTTP/2 Flow Control" (acronym breaks the run) and "Retry Budget Exhaustion" (only three) do not fire, while a four-word title-case heading does. The `(?-i:...)` scope is required so the branch still works under a case-insensitive compile - without it this rule fires on every heading.
**Repair.** Sentence case, no emoji, no arrows: "## Deploy, verify, rollback".
```
regex: ^#{1,6}\s+(?:[^\n]*[🌀-🯿←-⇿☀-➿️]|(?-i:(?:[A-Z][a-z]+\s+){3,}[A-Z][a-z]+)\s*$)
```
Fires on:
- ## 🚀 Launch Phase
- ## Strategic Negotiations And Partnerships
- ### Deploy → Verify → Rollback
Must not fire on:
- ## Why the retry budget ran out
- ## HTTP/2 Flow Control
- ### Rollback plan

> **Decorative headings** | "Strategic Negotiations And Partnerships", "🚀 Launch Phase:"

### chatbot-residue
"Let me know if..." is only flagged in the "you'd like" offer form, which keeps the legitimate reviewer-facing version in the first negative example. "In conclusion," and "To summarize," were deliberately left out: a summary paragraph in a long RFC legitimately opens that way. "Certainly" requires the following punctuation so the adverbial use does not fire.
**Repair.** Delete the wrapper sentence and keep the content.
```
regex: \b(?:great question|certainly[!,]|i hope this helps|hope that helps|let me know if you(?:'d| would) like|feel free to ask|as an ai|i'?m happy to help|here'?s a (?:comprehensive|detailed) (?:overview|breakdown|guide))\b
```
Fires on:
- Great question! The scheduler is preemptive.
- Let me know if you'd like me to expand the rollback section.
Must not fire on:
- Let me know if the repro steps are unclear.
- Ask in #perf-oncall if the dashboard is empty.
- Certainly not: the lease is not renewed after a fence.

> **Chatbot residue** | "Great question! ... I hope this helps!"

### hype-announcement
From the version history ("Expanded §28 to cover casual announcements"), folded into the staging patterns in 3.0.0. A plain "Announcing X" with a date is a legitimate release note and does not fire.
**Repair.** Lead with the change, the environment, and the date: "v2 is the default in prod01 as of 2026-09-18."
```
regex: \b(?:big news|exciting (?:news|update|announcement)|we'?re thrilled to|we'?re excited to (?:announce|share)|happy to announce|drum ?roll)\b
```
Fires on:
- Exciting news: the new codec is live!
- We're thrilled to announce v2.
Must not fire on:
- v2 is live in prod01 as of 14:00 UTC.
- Announcing the deprecation: v1 endpoints stop serving on 2026-10-01.

> Expanded §28 to cover casual announcements.

### knowledge-limit-disclaimer
Honest uncertainty is mandatory in postmortems and must never fire - all three negative examples state precisely what is unknown and why, which is the correct form. Only the model-shaped disclaimers fire. "It appears that" was deliberately excluded from the regex: it is used both by a hedging model and by an engineer describing a genuine inference, and no regex separates them. Flag it only in a human or LLM pass, and only when the sentence names no evidence.
**Repair.** Say what you checked, what it showed, and what is missing: "Access logs cover 14:00-15:00 only; the connection-close side is not recoverable from them."
```
regex: \bas of my (?:last |knowledge )?(?:update|cutoff|training)\b|\bi (?:do not|don'?t) have access to\b|\bbased on (?:the )?available (?:information|sources|data)\b|\bwhile (?:specific )?details (?:are|remain) (?:limited|scarce|unclear)\b
```
Fires on:
- As of my last update, the API supported v2.
- Based on available information, the cluster was healthy.
Must not fire on:
- We could not determine whether the LB or the client closed the connection; trace ids were not propagated.
- Metrics cover only the last 7 days; the 30-day view was not retained.
- The cause is unconfirmed: we have a correlation in time and no trace.

> **Knowledge-limit disclaimers and guesses** | "While details are limited in available sources, it appears..."

### participial-significance-tail
The abstract-noun requirement plus the following-preposition/punctuation anchor is what separates this from legitimate participial tails ('reflecting what the hosts run', 'highlighting the hot path in red'), which take concrete objects. A tail whose object is a measurement or a named component is fine and will not fire.
**Repair.** Delete the tail. The sentence before the comma already carries the fact; the participle adds an unsourced evaluation. If the significance is real, make it its own sentence with a measurement or a decision attached ('This is why we kept the cache tier after the Q4 cost review').
```
regex: ,\s+(?:under(?:scor|lin)ing|highlighting|showcasing|emphasi[sz]ing|reflecting|demonstrating|illustrating|cementing|solidifying|exemplifying|reinforcing|marking)\s+(?:the|its|their|our|a|an|his|her)?\s*(?:\w+\s+){0,3}?(?:importance|significance|commitment|role|potential|value|relevance|impact|versati
```
Fires on:
- The team moved the fleet to the new runtime in Q3, underscoring its commitment to reliability.
- Tail latency fell 18 percent, highlighting the significance of the new cache tier.
- The service was adopted by four orgs, cementing its role as the default ingest path.
Must not fire on:
- We pinned the kernel version, reflecting what the hosts actually run.
- The flame graph is annotated, highlighting the hot path in red.
- The dashboard was regenerated, reflecting the new role assignments for on-call.

> This is often done by attaching a present participle ("-ing") phrase at the end of sentences, sometimes with vague attributions to third parties

### legacy-significance-phrase
Requires both the verb and the canned abstract complement. 'marks the boundary', 'serves as a guard', 'represents a 12 percent shift' are literal and will not fire, because the complement is concrete or numeric.
**Repair.** Say what changed and for whom. 'The GA release marks a pivotal moment' becomes 'After GA, the v1 write path is frozen; three teams must migrate by Q2.' If there is no such consequence, delete the sentence.
```
regex: \b(?:(?:stands?|stood|serves?|served)\s+as\s+(?:a|an)\s+(?:testament|reminder|symbol|beacon|cornerstone|hallmark|bridge|gateway|monument)\b|marks?\s+(?:a|an)\s+(?:pivotal|defining|watershed|turning|seminal|landmark)\s+(?:moment|point|milestone|chapter)\b|represents?\s+a\s+(?:significant|major|fundam
```
Fires on:
- The 2019 rewrite stands as a testament to the team's discipline.
- The GA release marks a pivotal moment for the platform.
- The move to columnar storage represents a fundamental shift in how we query.
Must not fire on:
- The commit marks the boundary between the two schema versions.
- The sentinel value serves as a guard against double free.
- This represents a 12 percent shift in traffic to the new cluster.

> Words to watch: stands/serves as , is a testament/reminder , a crucial/pivotal/vital/significant/key role/moment ... represents/marks a shift , key turning point

### boasts-copula-avoidance
Deliberately narrow. The full copula-avoidance family in the source ('serves as', 'features', 'offers', 'functions as') cannot be linted, because 'the WAL serves as the durability boundary' and 'the sidecar functions as the TLS terminator' are ordinary correct engineering prose. Only 'boasts' and 'is home to' have essentially no legitimate technical use.
**Repair.** Use 'has' or 'runs'. 'The host has 8 H100s'; 'The cluster runs the feature store and the ranking service.'
```
regex: \b(?:boasts?|boasted|boasting)\s+(?:a|an|the|over|nearly|more\s+than|\d)|\bis\s+home\s+to\b
```
Fires on:
- The new host boasts 8 H100 GPUs and 2 TB of RAM.
- The cluster is home to the feature store and the ranking service.
Must not fire on:
- The box has 8 H100 GPUs and 2 TB of RAM.
- The boastful tone in the launch doc was cut before review.
- The cluster hosts the feature store and the ranking service.

> LLMs prefer to use marketing -related verbs like features , offers , and the like to their neutral synonym has

### slop-vocabulary-core
Requires 'delve' to be followed by 'in/into' specifically, because Delve is the Go debugger and 'attach Delve to the binary' is a legitimate sentence. 'realm' likewise requires 'of', since OIDC/Kerberos realms are real nouns. I deliberately left out source-listed words that are load-bearing in engineering prose: key, crucial, robust, landscape, enhance, align with, intricate. Those need a per-document density count, not a per-occurrence fire.
**Repair.** 'delve into' -> 'walks through' / 'covers'. 'garnered support' -> 'three orgs signed off'. 'tapestry', 'vibrant', 'multifaceted', 'treasure trove' -> cut entirely; they carry no information in a design doc.
```
regex: \b(?:delv(?:e|es|ed|ing)\s+in(?:to)?|tapestry|meticulous(?:ly)?|vibrant|garner(?:s|ed|ing)?|multifaceted|treasure\s+trove|burgeoning|realm\s+of)\b
```
Fires on:
- We delve into the scheduler internals in the next section.
- The config layer is a vibrant tapestry of per-tenant overrides.
- The proposal garnered support from three orgs.
Must not fire on:
- Attach Delve to the running binary with dlv attach.
- We use dlv (Delve) for stepping through the goroutine.
- The OIDC realm is configured per environment.

> delve , [...] intricate/intricacies , [...] meticulous/meticulously , [...] tapestry (as an abstract noun), [...] vibrant

### vague-plural-authority
Only unnamed plural authorities fire. 'Researchers' and 'scholars' are excluded because ML design docs routinely and correctly write 'Researchers at DeepMind showed...'; a named institution makes the attribution checkable. Named singular sources ('The Kafka docs note') never fire.
**Repair.** Name the source or delete the claim. 'Industry reports suggest' -> 'The 2025 Netflix post-mortem (link) reports the same pattern at 200k rps.' In a design doc an unattributable claim is a guess wearing a citation's clothes.
```
regex: \b(?:(?:industry|market|independent|trade)\s+(?:experts|observers|analysts|reports|watchers|commentators|publications)|experts|observers|analysts|commentators|critics)\s+(?:have\s+|had\s+)?(?:argue|argued|note|noted|say|said|suggest|suggested|believe|believed|agree|agreed|contend|contended|point\s+o
```
Fires on:
- Industry reports suggest the pattern is common at this scale.
- Experts argue that the sidecar model is the wrong default.
Must not fire on:
- The Kafka docs note that rebalances are stop-the-world.
- Two reviewers argued for the simpler design in the RFC thread.
- Researchers at Google published the Borg paper in 2015.

> AI chatbots tend to attribute opinions or claims to some vague authority—a practice called weasel wording . They also commonly exaggerate the quantity of sources

### despite-these-challenges-closer
The source is explicit that the tell is the formula, not the word 'challenge'. Vague-quantifier 'faces several/numerous challenges' fires; a concrete count with an enumeration ('faces three challenges: A, B, C') will still fire on 'several'-class words only, so a doc that says 'faces three challenges' is clean by construction. Reviewers should not report the 'faces several challenges' arm when a colon-delimited list follows within the same sentence.
**Repair.** Enumerate the problems with owners and dates, then stop. Delete the reassuring closer entirely — 'Despite these challenges, X continues to thrive' is the sentence that tells a reader the section had nothing in it.
```
regex: \bDespite\s+(?:these|those|the|its|such)\s+(?:challenges|obstacles|hurdles|limitations|setbacks)\b|\bfaces?\s+(?:several|numerous|many|a\s+number\s+of|various)\s+challenges\b|\bcontinues?\s+to\s+(?:thrive|evolve|play\s+a|serve\s+as|grow\s+in)\b
```
Fires on:
- Despite these challenges, the service continues to serve as the system of record.
- The platform faces several challenges as adoption grows.
Must not fire on:
- Despite the retry budget, the request failed after three attempts.
- We hit three specific problems: clock skew, GC pauses, and a bad DNS TTL.
- Despite its size, the index fits in page cache.

> Many LLM-generated Wikipedia articles include a "Challenges" section, which typically begins with a sentence like "Despite its [positive/promotional words], [article subject] faces challenges..." and ends with either a vaguely positive assessment

### canned-wrapup-heading
Needs re.MULTILINE. I did NOT generalise the source's 'X and Y' heading rule, because 'Risks and Mitigations', 'Background and Motivation', 'Goals and Non-Goals' are standard RFC headings. Only the specific canned wrap-up titles are listed. 'Conclusion' is the softest member: some house RFC templates mandate it, so suppress it if the repo's template contains it.
**Repair.** Rename to the thing the section decides: 'Decision', 'Open questions', 'Rollout plan', 'Action items (owner, date)'. 'Key Takeaways' and 'Conclusion' almost always restate the body; delete the section and move any real content up.
```
regex: ^\s{0,3}#{1,6}\s*(?:Challenges\s+and\s+(?:Legacy|Opportunities|Future\s+Directions)|Future\s+(?:Outlook|Prospects|Directions)|Impact\s+and\s+Legacy|Key\s+Takeaways|Final\s+Thoughts|Awards\s+and\s+Recognition|Conclusion)\s*$
```
Fires on:
- ## Key Takeaways
- ### Future Outlook
- ## Conclusion
Must not fire on:
- ## Risks and Mitigations
- ## Background and Motivation
- ## Rollback Plan

> Section or subsection headers in the format of "X and Y" are common in (but not exclusive to) AI generated articles. [...] which may also include a separate section for "Future Prospects."

### in-conclusion-restate
The required comma is what separates the connective from the adjective/adverb: 'Overall throughput rose 12 percent' and 'the overall p99 budget' do not fire. Report only when the flagged sentence opens the final paragraph of a section and contains no number or name absent from the section above — a lead paragraph that summarises up front is good writing, a trailing one is filler.
**Repair.** If the paragraph introduces no new fact, delete it. If it does, drop the connective and lead with the fact: 'The rollback restored p99 within four minutes.' Engineering readers scan; a restatement paragraph costs them a scan and returns nothing.
```
regex: (?:^|(?<=[.!?])\s|\n)\s*(?:In\s+(?:summary|conclusion|closing)|Overall|To\s+summari[sz]e|All\s+in\s+all)\s*,
```
Fires on:
- In summary, the rollback restored p99 within four minutes.
- Overall, the migration was net-positive for cost.
Must not fire on:
- Overall throughput rose 12 percent after the change.
- The summary table is in Appendix A.
- We concluded the incident at 14:32 UTC.

> When generating longer outputs (such as when told to "write an article"), older LLMs often added sections titled "Conclusion" or similar, and often ended paragraphs or sections by summarizing and restating its core idea.

### assistant-chatter
Narrowed hard from the source's list. Bare 'let me know', 'here is a', and 'of course' are all normal in PR descriptions and doc bodies, so each is required to appear in its full canned form ('let me know if you'd like', 'Of course!' with the exclamation point). This is the highest-precision rule in the set and should be treated as blocking.
**Repair.** Delete. This is chat-session residue that was pasted into the document; nothing in it is addressed to the document's reader.
```
regex: \b(?:I\s+hope\s+this\s+helps|Let\s+me\s+know\s+if\s+you(?:['’]d|\s+would)\s+like|Would\s+you\s+like\s+me\s+to|Here(?:['’]s|\s+is)\s+(?:a|the)\s+(?:detailed\s+)?breakdown|Great\s+question|Certainly!|Of\s+course!|You(?:['’]re|\s+are)\s+absolutely\s+right|As\s+an\s+AI\s+language\s+model)\b
```
Fires on:
- Certainly! Here is the breakdown of the retry budget.
- Let me know if you'd like me to expand the rollback section.
Must not fire on:
- Let me know if the repro steps are unclear.
- Here is the call graph for the hot path.
- Of course the leader can fail mid-commit; that is what the lease is for.

> Words to watch: I hope this helps , Of course! , Certainly! , You're absolutely right! , Would you like... , is there anything else , let me know , more detailed breakdown , here is a ...

### unfindable-source-hedge
The adverb (widely/extensively/publicly/readily) is required. A located negative claim — 'not documented in the client README' — is falsifiable and does not fire. In engineering prose this rule usually catches the sentence immediately before a hallucinated mechanism, so flag the following sentence for a human read too.
**Repair.** Say where you looked and what you would need. 'Not widely documented' -> 'Not in the service README or the 2024 design doc; asked @owner in #team-storage on 2026-09-14.' The vague form hides that nothing was checked, and it is usually followed by a fabricated guess.
```
regex: \bnot\s+(?:widely|extensively|publicly|well|readily)\s+(?:documented|available|disclosed|published|reported)\b|\b(?:in|within)\s+the\s+(?:provided|available|given)\s+(?:sources|search\s+results|documents|context)\b|\bas\s+of\s+my\s+(?:last\s+)?(?:knowledge|training)\s+(?:update|cutoff)\b|\bbased\s+o
```
Fires on:
- As of my last knowledge update, the retention policy was seven days.
- Specific details about the sharding scheme are limited.
- The eviction policy is not widely documented.
Must not fire on:
- The rebalance protocol is not documented in the client README.
- We could not find the config in the repo; it is generated at build time.
- The information in the trace is enough to rule out GC.

> Words to watch: Up to my last training update , as of my last knowledge update , While specific details are limited/scarce... , not widely available/documented/disclosed , ...in the provided/available sources / search results...

### unfilled-placeholder
Markdown links, array indexing, interval notation, and conventional in-code TODO comments are all explicitly excluded — a bare '// TODO(owner):' is legitimate engineering practice and must not fire. Only bracketed imperatives, SCREAMING_SNAKE paste tokens, and XX-dates fire.
**Repair.** Fill it in or delete the surrounding claim. A shipped design doc containing [Insert benchmark numbers] is worse than one that says 'not measured yet, owner @x, due 2026-10-01'.
```
regex: \[(?:Your\s+Name|Insert[^\]]*|Describe[^\]]*|Add\s+your[^\]]*|TODO:[^\]]*|TBD[^\]]*|PLACEHOLDER[^\]]*|Specific\s+Topic|link\s+to[^\]]*)\]|\b(?:INSERT|PASTE)_[A-Z_]+\b|\b\d{4}-(?:XX|xx)-(?:XX|xx)\b
```
Fires on:
- Best regards, [Your Name]
- url = PASTE_DASHBOARD_URL_HERE
- access-date = 2025-XX-XX
Must not fire on:
- See [the design doc](https://go/dd-204) for details.
- The array index arr[i] is bounds-checked at the call site.
- // TODO(spopuri): drop the v1 path after the migration

> AI chatbots may generate responses with fill-in-the-blank phrasal templates [...] However, some LLM users forget to fill in those blanks.

### emoji-heading
Needs re.MULTILINE. Scoped to headings only. The source also lists emoji-decorated bullets, but status glyphs in tables and checklists (✅/❌/⚠️) are normal and useful in engineering docs, so bullets and table cells are deliberately excluded.
**Repair.** Delete the emoji. Heading text should be greppable and diffable; a rocket adds no information and breaks anchor links in some renderers.
```
regex: ^\s{0,3}#{1,6}\s*[🀀-🫿←-⇿⌀-➿⬀-⯿]
```
Fires on:
- ## 🚀 Rollout Plan
- ### 🔍 Root Cause
Must not fire on:
- ## Rollout Plan
- | ✅ | canary | passed |
- - ✅ Backfill complete

> In particular, they sometimes decorated section headings or bullet points by placing emoji in front of them.

### broader-landscape-tail
'part of a broader migration off Thrift' names a concrete referent and does not fire; only the abstract nouns (landscape, ecosystem, narrative, movement, trend) do. 'ecosystem' and 'context' are common technical nouns and fire only when governed by broader/wider/evolving/changing/shifting.
**Repair.** Name the specific programme or delete the framing. 'part of a broader trend' -> 'the third of five services moving off Thrift under DD-118'. A trend the doc cannot name is a trend the author invented to make the change sound inevitable.
```
regex: \b(?:broader|wider|evolving|changing|shifting)\s+(?:\w+\s+){0,2}?(?:landscape|ecosystem|narrative|conversation|discourse|movement|trends?|context)\b|\breflects?\s+(?:a|the)\s+(?:broader|wider|growing)\b|\bpart\s+of\s+a\s+(?:broader|wider)\s+(?:movement|trend|shift|narrative)\b
```
Fires on:
- The change reflects a broader move toward declarative config.
- This sits within the evolving observability landscape.
- The rewrite is part of a broader trend in the industry.
Must not fire on:
- This is part of a broader migration off Thrift.
- The Kubernetes ecosystem has three competing CNI plugins.
- We widened the scope to include the write path.

> LLM writing often puffs up the importance of the subject matter by adding statements about how arbitrary aspects of the topic represent or contribute to a broader topic.

---

## Tier 2 -- flagged, not failed

Each of these either fires on real engineering prose, or its extractor marked it below high
confidence. The reason is recorded per pattern.

| pattern | why it is not tier 1 |
|---|---|
| `assistant-turn-tic` | fires on 1 negative example(s) from the pooled adversarial set |
| `bare-predicative-load-bearing` | author confidence medium |
| `reviewer-verdict-tic` | author confidence medium |
| `nonce-suffix-coinage` | author confidence medium |
| `stacked-negation-in-contrast` | author confidence medium |
| `ceremonial-filler` | fires 2 times across 2 documents of expert human prose |
| `creature-metaphor-tic` | fires on 1 negative example(s) from the pooled adversarial set |
| `diminutive-creature-companion` | author confidence medium |
| `anthropomorphic-mood` | author confidence medium |
| `mischief-as-root-cause` | author confidence medium |
| `wonder-adverb` | author confidence medium |
| `undercut-pretension-aside` | author confidence medium |
| `reveal-framing` | author confidence low |
| `overfamiliar-address` | author confidence medium |
| `decorative-emoji` | author confidence medium |
| `magic-as-explanation` | author confidence medium |
| `persona-noun-inflation` | author confidence low |
| `affective-tricolon` | author confidence medium |
| `one-line-closer` | fires on 1 negative example(s) from the pooled adversarial set |
| `arguing-with-no-one` | author confidence medium |
| `dash-overload` | author confidence medium |
| `stacked-hedges` | fires 11 times across 8 documents of expert human prose |
| `agentless-operational-passive` | fires 3 times across 2 documents of expert human prose |
| `ai-vocabulary` | fires 4 times across 3 documents of expert human prose |
| `inflated-significance` | fires 2 times across 2 documents of expert human prose |
| `vague-causal-attribution` | fires 3 times across 1 documents of expert human prose |
| `evaluative-ing-rider` | fires on 3 negative example(s) from the pooled adversarial set |
| `marketing-superlatives` | fires 10 times across 7 documents of expert human prose |
| `copula-avoidance` | fires on 1 negative example(s) from the pooled adversarial set |
| `bold-line-as-heading` | author confidence medium |
| `curly-double-quotes` | fires 215 times across 15 documents of expert human prose |
| `corporate-puffery` | fires 7 times across 4 documents of expert human prose |
| `not-only-but-also` | fires 13 times across 10 documents of expert human prose |
| `isnt-just-x-its-y` | author confidence medium |
| `important-to-note` | fires 2 times across 2 documents of expert human prose |
| `doubled-hedge-speculation` | fires 3 times across 2 documents of expert human prose |
| `curly-punctuation` | fires 722 times across 22 documents of expert human prose |
| `curly-quote-in-code-span` | author confidence medium |
| `adverb-associated-with` | author confidence medium |
| `bold-inline-header-list` | author confidence medium |
| `title-case-heading` | fires on 6 negative example(s) from the pooled adversarial set |
| `unquantified-intensifier` | fires 7 times across 5 documents of expert human prose |
| `ensuring-abstract-outcome` | author confidence medium |

---

## Tier 3 -- no regex is possible

These are real and a script cannot check them. They are here so a human read has a list.

- **em-dash-density** -- No regex shipped: presence cannot separate the two populations and banning the character punishes correct writers, exactly as the brief warns. Measured over the positive corpus in this repo: em dashes per 1000 words is 0
- **nonce-abstraction-compound** -- I tested the obvious mechanical version and it fails. Counting hyphenated compounds that appear exactly once per 1000 words over this repo's corpus: tail-at-scale 14.17, brooker-waiting 8.63, brooker-whats-easy-whats-har
- **uniform-cadence** -- Script-checkable as a distribution, not as a match: compute the standard deviation of sentence length in words per section and the coefficient of variation of paragraph length. Low variance is the signal; the source also
- **lexical-diversity-collapse** -- A naive type-token ratio check is actively wrong for this genre: good engineering prose deliberately repeats domain nouns because renaming the same object is a defect (see both negatives, which have low TTR and are corre
- **buried-action** -- I could not build a safe regex. The obvious proxy - '-ness/-ality/-ization' density - over-fires immediately on ordinary engineering vocabulary: robustness, correctness, freshness, staleness, liveness, observability, ser
- **invented-foil-contrast** -- The tell is a contrast whose rejected half was never proposed by anyone - the model manufactures a foil so it has something to defeat. Partially mechanizable: extract the object of 'not X', 'rather than X', 'instead of X
- **rewarded-tic-frequency-outlier** -- This is the mechanism rather than a tell, and it is the reason a fixed blocklist will always be a release behind. The source's own detection was statistical, not lexical: nobody blocklisted "goblin" in advance; they meas
- **persona-register-leak** -- The source's central finding is scope leak: a style rewarded in one narrow condition showed up at nearly the same relative rate outside it, and then self-amplified when the rollouts were reused for SFT. The engineering-p
- **forced-triads** -- No shippable regex. Three-item lists are the default shape of correct technical prose. The tightest heuristic I could build - three abstract nouns (-ity/-ion/-ness/-ment/-ance/-ence) sharing an initial letter, via a back
- **repeated-sentence-openings** -- Needs sentence segmentation, not a regex: flag three or more consecutive sentences in one paragraph that share their first two tokens. Suppress when the sentences form a parallel data series (each contains a distinct num
- **dropped-hyphenated-pairs** -- DROPPED for technical prose. Hyphenated compounds are the native vocabulary of systems writing (write-ahead, copy-on-write, lock-free, zero-copy, end-to-end, read-modify-write), so both a word list and a density threshol
- **heading-echoed-in-first-sentence** -- Needs structure, not a regex: for each heading, take its content words and the first sentence of its body, and flag when the sentence adds no content word beyond the heading's. A naive overlap test over-fires on the nega
- **dropped-previous-version-narration** -- DROPPED for technical prose. Describing what the previous version did is the entire job of an RFC's background section, a postmortem's timeline, and a migration plan, as the negative examples show. The tell only exists i
- **dropped-false-ranges-and-synonym-cycling** -- DROPPED, and dropped by the source too: version 3.0.0 removed false ranges and synonym cycling because Wikipedia now classes them as human habits. Listed here so the linter's owner knows they were considered and rejected
- **rule-of-three** -- No regex, and I could not construct one that survives contact with engineering prose. The 'X, Y, and Z' shape is how engineers correctly enumerate pipeline stages, dependencies, and invariants; both negative examples are
- **elegant-variation-coreference** -- No regex. Mechanically approximable but not as a line pattern: within a section, collect generic head nouns from a fixed set (service, platform, system, solution, component, framework, offering, tool) and flag when three
