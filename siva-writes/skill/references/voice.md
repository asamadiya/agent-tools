# voice.md

Six rules, each with the measurement that produced it and three before/after pairs. Every number
comes from `corpus/measurements-train.json` over 30 documents from 9 train families, reproducible
with `python3 tools/measure.py --splits train`. The full write-up, including what could not be
measured, is `reports/phase2-measurements.md`.

Two things to hold while reading.

**The exemplars outrank these rules.** A rule is a compression of what the corpus does, and the
compression loses. Where a rule and an exemplar disagree, the exemplar is the evidence and the rule
is the summary. `references/exemplars/INDEX.json` says which two to load for a given document type.

**Three rules exist to stop a plausible rule.** Sentence caps, hedge bans and number quotas are the
obvious things to enforce, they are what a linter can check most easily, and the corpus refutes all
three. Those are rules 4, 5 and 2 below, and they are stated as prohibitions on over-correction
because that is the direction the error actually runs.

---

## Rule 1. Open a paragraph with its claim

**Measured: 0.889, sd 0.064, n = 29 documents, range 0.742 to 1.000** (document-weighted).

The tightest spread of any metric here, and it holds at 0.94 across Google Cloud incident reports
and 0.93 across Python PEPs, two populations with nothing else in common.

**Read the number as what it is.** `is_claim_first` is a LEXICAL PROXY: it returns true when the
first sentence is at least five words, is not a question, does not open with a discourse connective
(*however, but, moreover, for example, first, finally, in summary*) and does not take the document
as its subject (*this section, in this post, we will discuss*). It does not check that a claim is
present. An independent review demonstrated that **both "before" examples below pass it**, which is
the honest limit of the measurement: 0.889 describes survival of four exclusions across 8 families,
not paragraph organisation, and 0.742 is that proxy's observed minimum -- one document, danluu-metrics-analytics, which
opens sections with questions -- rather than a floor for good prose. The rule is still right. The number is weaker evidence for it than it looks.

What this rule is really preventing is the windup. A paragraph that spends its first sentence
arriving costs the reader a sentence, and a document does it forty times.

```
before  Before discussing the retry policy, it is worth considering how the system behaves
        under partial failure. When a downstream dependency degrades, calls begin to time out.
        Retries then amplify the load on an already-struggling service.
after   Retries amplify load on a service that is already failing. A degraded dependency starts
        timing out, each timeout produces a retry, and the retry arrives at the same saturated
        pool. This is why the retry policy is coupled to the circuit breaker.
```

```
before  There are a number of factors that influence cache hit rate in this workload. The key
        space is large, access is skewed, and the TTL is short. Together these mean the cache
        absorbs less traffic than the design assumed.
after   The cache absorbs 61% of reads, not the 90% the design assumed. Three things cost it:
        a 400M key space against a 12M-entry cache, a Zipf-0.9 access skew that concentrates
        hits on keys already resident, and a 30-second TTL that evicts them before reuse.
```

```
before  In this section we will look at what happened to p99 latency after the migration.
        The numbers are interesting.
after   p99 latency rose from 240 ms to 310 ms after the migration, and stayed there for six
        weeks until the connection pool was resized.
```

## Rule 2. Attach the number to the claim that rests on it. Do not hit a density target

**Measured: 1.334 numbers per 100 words, sd 1.267.** A coefficient of variation near 1.0, which is
the finding: there is no corpus-level rate to aim at.

| family | numbers / 100 words |
|---|---|
| gcp-incident | 3.90 |
| pep | 1.28 |
| danluu | 1.07 |
| sre-book | 0.67 |
| aws-builders | **0.32** |

The AWS Builders' Library is among the best systems writing in public and carries one number per
312 words. *Timeouts, retries and backoff with jitter* is an argument about a mechanism; the
mechanism is what transfers, and a measurement would be a measurement of one workload.

So the rule is about attachment. A claim that rests on a quantity states the quantity, its unit,
and where it came from. A claim about a mechanism does not become stronger by acquiring one. The
failure this prevents is the unattributed number, not the absent number: under a colleague's
question, a number nobody can source costs the speaker the rest of the argument.

```
before  The new encoder is significantly faster.
after   The new encoder runs at 1.9x the old one on the 4 KB-median payload mix: 10.1 ms
        against 19.2 ms, median of 500 runs on one A100, encode only, excluding transport.
```

```
before  Sharding reduced contention by roughly 40%, improving throughput considerably and
        reducing p99 by a meaningful amount across all workloads.
after   Sharding cut lock wait from 38% of request time to 9%. Throughput rose 1.5x on the
        write-heavy workload and did not move on the read-heavy one, which never contended.
```

```
before  Exponential backoff with jitter spreads retries across a 1.7x wider window, reducing
        the 43% synchronisation effect by approximately 2.3x under most conditions.
after   Without jitter, clients that failed together retry together, so the second attempt
        arrives as one spike rather than a spread. Jitter breaks that correlation. How much
        it helps depends on how synchronised the failure was, and this document does not
        measure that; the mechanism is the reason to do it.
```

The third pair is the one worth studying. The "before" is denser with numbers than the "after"
and every number in it is decoration: no unit, no source, no statement of what was measured.
Numbers as ornament read as rigour and fail the first question asked about them.

## Rule 3. Mechanism outnumbers evaluation

**Measured: mechanism-to-evaluative 3.14, median 2.60, n = 27, range 0.33 to 9.56. Evaluative
vocabulary 0.362 words per 100, sd 0.262, n = 30.**

The ratio excludes three GCP incident reports that contain zero evaluative sentences, where it is
undefined. The classifiers behind both terms are lexical: a sentence counts as mechanism if it
carries a causal connective, and as evaluative if it carries an evaluative word and no number. So
*Since Monday the queue has drained* counts as mechanism, and the spread from 0.33 to 9.56 is wide
enough that 3.14 is a description of this corpus, not a target to write against.

A mechanism sentence carries a causal connective and says what makes something happen. An
evaluative sentence asserts quality without measuring it: *important, crucial, powerful, robust,
elegant, seamless, significant*. The corpus does not eliminate the second, it is simply outnumbered.

The reason is not taste. An evaluative adjective is a claim the reader cannot check, so it
transfers nothing and costs the writer credibility on the sentences that could have been checked.

```
before  Shuffle sharding is a powerful technique that provides excellent isolation between
        customers with minimal operational overhead.
after   Shuffle sharding gives each customer a random pair of the 8 available queues. A noisy
        tenant overlaps on at least one queue with 13 of the 28 possible pairs, and on both
        queues with 1 of them. A customer that shares one queue still has its other queue and,
        with retry and spare capacity, stays served. Only the 1-in-28 that drew the identical
        pair loses both alternatives.
```

```
before  This is a critical component of the architecture and its performance characteristics
        are extremely important to overall system behaviour.
after   Every read passes through this component and waits on it, so its 12 ms p99 is spent
        inside the 30 ms request budget before any downstream call starts. That is 40% of the
        budget, on the serial path.
```

```
before  The elegant solution here is to make the operation idempotent, which is a best practice
        that provides significant robustness benefits.
after   Make the operation idempotent, so a retry after an ambiguous timeout is safe. Without
        it the client cannot distinguish "the write failed" from "the response was lost", and
        retrying risks a duplicate write. The alternatives are a status query or a read-back,
        which cost a round trip and need the server to expose one.
```

## Rule 4. Hedge, qualify, or quantify. Do not ban hedging

**Measured: 1.383 hedges per 100 words, sd 0.692, range 0.415 to 2.881.** Expert engineering prose
hedges roughly fourteen times per thousand words.

| family | hedges / 100 words |
|---|---|
| industrialempathy (*Design Docs at Google*) | 2.45 |
| danluu | 2.05 |
| sre-book | 1.76 |
| aws-builders | 1.25 |
| gcp-incident | **0.64** |

The document that teaches engineers how to write design docs hedges the most, and the incident
reports hedge least. That ordering is not a quality ranking, it is an epistemics ranking: an
incident report states what happened, a design document argues about what will happen under
conditions nobody has observed.

Pinker's sequence is the usable rule. **Hedge, qualify, or quantify**: delete the hedge that
protects the writer, keep the one that states a bound, and replace it with a number when one
exists. The test is what becomes false if the word is deleted. Nothing becomes false, delete it.
Something becomes false, and you have just written the qualification.

```
before  This approach is generally somewhat more efficient in most cases.
after   This approach moves fewer bytes below batch 32. Above it, the two converge and the
        simpler one wins.
```

```
before  The service will handle the load.
after   The service handles 8,000 rps at p99 under 50 ms. We have not tested above 12,000,
        and the connection pool is sized for 10,000.
```

```
before  Removing all hedges: "Quadratic in sequence length."
after   The attention score matrix costs O(S^2) multiply-accumulates at fixed head dimension.
        Once S exceeds what on-chip memory holds, the same operation count is spread over more
        memory traffic, so measured runtime stops tracking the operation count. The exponent on
        the operation count has not changed; the thing setting runtime has.
```

The third pair is the over-correction. A claim stripped of its domain is not more confident, it is
less true, and it will be over-applied by exactly the readers who trusted it.

## Rule 5. Vary sentence length. There is no cap

**Measured: sentence mean 23.37 words, sd 6.05 across documents. Within-document sentence-length
sd averages 13.21, minimum 6.28. 21.67% of sentences exceed 30 words as a document-weighted mean,
20.92% pooled (1,473 of 7,040), range 0.00% to 54.32%.**

| family | mean | share over 30 words |
|---|---|---|
| aws-builders | 18.94 | 9.1% |
| rust-rfc | 20.07 | 10.0% |
| sre-book | 21.30 | 15.7% |
| allthingsdistributed | 22.47 | 22.1% |
| **danluu** | **32.36** | **45.6%** |

A 30-word cap rejects 45.6% of Dan Luu's sentences and 54.3% of one of his posts, and 26.8% of
*The Tail at Scale*. The cap does not describe this corpus; it describes one register
inside it, and enforcing it flattens the variation that carries the emphasis.

What the corpus supports is variance. A 9-word sentence after three 30-word ones lands hard, and
that is the main rhythmic instrument available in prose. Put the load-bearing claim in the short
one.

A long sentence fails when the reader cannot resolve each clause as it arrives, not when it passes
a word count. Check anything over 45 words for that, and do not attach a failure number.

```
before  The request arrives at the load balancer. The load balancer selects a backend. The
        backend checks the cache. The cache misses. The backend queries the database. The
        database returns 4 KB. The backend populates the cache. The response is returned.
after   A request arrives, the load balancer picks a backend, and the backend checks the cache
        before doing anything else. The cache misses. What follows is the expensive path: a
        database query returning about 4 KB, a cache write, and only then the response.
```

```
before  Because the connection pool is sized at 200 and each of the 40 application instances
        maintains its own pool, and because the database enforces a global connection limit of
        4,000 which the fleet therefore exactly saturates at full deployment, any instance
        added past the fortieth fails to acquire connections at startup and crash-loops.
after   Each instance opens a pool of 200 connections, and the database accepts 4,000 in total,
        so the twentieth instance takes the last of them. Instance 21 gets nothing at startup.
        It crash-loops.
```

```
before  The queue drained. The workers recovered. Throughput returned. Latency followed.
        The incident closed.
after   The queue drained and the workers recovered within about 90 seconds of the rollback,
        and throughput and latency came back together over the next four minutes. The incident
        closed at 15:02.
```

The five short sentences are not wrong; five in a row are. The repair keeps one short sentence
for the sharp fact -- the closing time -- and lets the rest run long enough to carry the order
of events, which is what the reader needs and what five equal clauses flatten.

## Rule 6. Paragraphs run about 85 words, and long ones are a minority rather than an error

**Measured: paragraph mean 84.38 words, sd 21.83, range 46.7 to 131.4. 17.23% of paragraphs exceed
120 words as a document-weighted mean, 15.72% pooled (307 of 1,953), range 0% to 45.45%, n = 29.**

One document is excluded from these: *The Tail at Scale* is a two-column PDF that extracts as six
818-word blocks with no paragraph breaks. Leaving it in moved the corpus paragraph mean from 84.4
to 108.9 and its sd from 21.8 to 135.7, which is an extraction failure setting a rule.

A 120-word paragraph is not a defect. Roughly one in six is over it. What is a defect is a
paragraph carrying two claims, because the reader cannot tell which one the paragraph was for.

```
before  The regression came from a 3x increase in serialisation cost after the schema change,
        which we found by diffing CPU profiles across the deploy, and rolling back takes 11
        minutes because the config has to drain through three regions in sequence, which is
        also why we could not roll back during the incident window without extending it.
after   The regression came from a 3x increase in serialisation cost after the schema change.
        A CPU profile diff across the deploy put 71% of the added time in the encoder.

        Rolling back takes 11 minutes, because the config drains through three regions in
        sequence. That is longer than the incident window we were working in, which is why we
        patched forward instead.
```

```
before  The migration is complete.
        Latency is unchanged.
        Cost fell 22%.
        No incidents were attributed to it.
after   The migration is complete and cost 22% less than the old path, with latency unchanged
        and no incidents attributed to it over the six-week bake.
```

```
before  The client opens a connection.
        The proxy accepts it.
        The proxy looks up the route.
        The route is cached.
        The cache is cold.
        The proxy queries the control plane.
        The control plane is rate limited.
        The query is queued.
        The connection times out.
after   The client opens a connection and the proxy accepts it, then looks up the route in a
        cache that is cold on a fresh proxy. The lookup falls through to the control plane.

        The control plane rate-limits route lookups at 50 per second per proxy, so on a cold
        start the queries queue behind each other. The client's 5-second timeout expires while
        its lookup is still in the queue.
```

The nine steps all survive. They are no longer nine paragraphs, and the two that carry the
mechanism -- the cold cache and the rate limit -- are now the ones the reader lands on.

---

## What is deliberately not here

**Words before the first concrete noun.** Requested, and not measurable with the instrument
available. 17.73% of this corpus's tokens are outside the Brysbaert concreteness norms - *gpu*,
*throughput*, *kubelet*, *tensor* are all absent - and the two defensible treatments of
out-of-vocabulary tokens give 4.01 and 10.85 words, a factor of 2.7. Under the strict reading,
53.5% of sentences contain no concrete noun at all, which is simply false about this corpus. No
threshold is derived from it. The underlying instruction survives as R1: put the actor in the
subject, which you check by reading the subject.

**Hyphenated coinages per 100 words.** Requested, and the detector measures the wrong thing.
"Coinage" is not a property of a token in isolation, so the only corpus-relative proxy was rarity -
a hyphenated compound appearing at most twice across all 30 documents. That returns 581 types,
including `all-hands`, `actor-critic`, `always-on` and `api-level`, plus one entry that is a paper
title with its spaces replaced. Rarity in a 30-document corpus is not evidence of novelty. What
replaced it is a closed list of the specific compounds the negative set names, in
`references/negative-set.md`, which a script can check without an open-class rate.
