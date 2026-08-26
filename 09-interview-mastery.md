# Stage 9 — Interview Mastery
Last updated: 2026-08-27
_Overview and notes._
Last updated: 2026-08-27

> Finally we train performance under pressure.

Stages 1–8 gave you the technical knowledge: scaling patterns, data stores, messaging, caching,
consistency models, FinTech-specific designs, and trade-off frameworks. This stage assumes all of
that is already in your head. What it drills instead is **execution** — how you behave in the 45–60
minutes where an interviewer is watching you think, not just checking whether you know the facts. At
Senior/Staff level, the bar is rarely "did you know CAP theorem" — it's "did you run the room like
someone we'd trust to lead a design review with no adult supervision."

Nothing below is new technology. It is all technique.

---

## Table of Contents

1. [Phase 1 — Opening](#phase-1--opening)
2. [Phase 2 — Whiteboarding](#phase-2--whiteboarding)
3. [Phase 3 — Interviewer Challenges](#phase-3--interviewer-challenges)
4. [Phase 4 — Recovery](#phase-4--recovery)
5. [Phase 5 — Company-Style Mocks](#phase-5--company-style-mocks)
6. [Phase 6 — Full Mock Interviews](#phase-6--full-mock-interviews)
7. [Self-Run Practice Prompts](#self-run-practice-prompts)

---

## Phase 1 — Opening

The first five minutes decide how much rope the interviewer gives you. A candidate who starts
drawing boxes immediately reads as junior, no matter how good the boxes are. A candidate who spends
the first few minutes visibly *shaping* the problem reads as someone who has shipped systems that
hurt people when scoped wrong.

### Clarifying Questions — reusable opening script

Do not ask questions randomly. Work through a fixed checklist out loud, in this order, so the
interviewer sees a method, not a stall:

**The 6-part opening checklist ("F.U.S.S.C.O." — say it in your head, not out loud):**

1. **Functional core** — "What's the one core action a user takes?" (e.g., "send money," "place an order," "post an update"). Nail this before anything else — everything is scoped relative to it.
2. **Users & scale** — "Roughly how many users, and what's the read/write ratio?" Get *a number*, even a rough one. Refuse to design against "it depends."
3. **Scope boundary** — "Should I include [adjacent feature X]?" Explicitly name things you're excluding.
4. **Consistency/latency needs** — "Is this the kind of flow where stale data for a few seconds is fine, or does it need to be correct the instant you read it?" (This is the single highest-leverage question for FinTech-flavored prompts.)
5. **Constraints** — "Any constraints I should design around — must run on-prem, must integrate with an existing system, compliance requirements?"
6. **Out of scope explicitly** — "I'll assume auth, notifications, and admin tooling are out of scope unless you want me to cover them — okay?"

**Script you can say almost verbatim in the first 90 seconds:**

> "Before I start drawing, let me make sure I'm solving the right problem. Can you tell me roughly
the scale we're targeting — daily active users and request volume? ... Got it. Is this more read-
heavy or write-heavy? ... And for the core write path, do we need strong consistency — e.g. can't
lose or double-apply anything — or is eventual consistency acceptable? ... Great, I'll design for
that and call out anywhere I deviate. I'm going to treat auth, admin tooling, and notification
delivery as out of scope unless you'd like me to cover them."

This takes 60–90 seconds and immediately signals: you scope before you build, you think about
consistency requirements as a first-class input (not an afterthought), and you manage the
interviewer's time.

### Scope Control — narrowing an overly broad prompt

Prompts like "design Twitter" or "design PayPal" are deliberately too broad for 45 minutes. Staff-
level candidates are expected to *cut the prompt down themselves*, not wait for permission.

**How to narrow politely, without seeming like you're dodging difficulty:**

- Name the full problem first, then propose a slice: *"'Design PayPal' is a huge surface — ledger, fraud, disputes, multi-currency, compliance. I'd like to focus deeply on the core money-movement path: initiate a payment, hold funds, settle, and handle failure/retry — and touch on fraud and reconciliation at a higher level if we have time. Does that work, or is there a piece you specifically want depth on?"*
- Always end a scoping statement with a check-in question. This converts a unilateral cut into a negotiated one — the interviewer either agrees or redirects you, and either way you look collaborative, not evasive.
- If they push back and want breadth, give breadth with less depth per component and say so explicitly: *"Okay, I'll go broader and shallower — flag which parts I'd want to go deeper on if we had more time."*

### Assumptions — stating and validating out loud

Never silently assume. Every assumption is a piece of scope negotiation, and Staff engineers make
trade-offs *visible*.

**Pattern:** state the assumption, state why it matters, invite a correction.

> "I'm going to assume we can tolerate a few seconds of replication lag on the read side, since the
prompt sounds more like a feed than a bank balance — tell me if that's wrong."

> "I'll assume peak traffic is roughly 10x average, which is typical for this kind of consumer app —
let me know if you have a real number in mind."

Write assumptions on the board/doc as a short bullet list at the top — this becomes your reference
point later when the interviewer challenges something ("What fails here?") — you can point back and
say "this is within the assumption I flagged earlier" or "this breaks the assumption I made — let me
revise it."

### Time Management — minute-by-minute budgets

Interviewers rarely stop you to manage your clock — that's your job. Bring a mental (or literal, if
allowed) budget and *narrate your position in it* ("I want to leave time for failure modes, so I'll
move on from the schema now").

**45-minute interview budget:**

| Minutes | Phase |
|---|---|
| 0–5 | Clarifying questions, scope, assumptions |
| 5–10 | High-level architecture (boxes and arrows, core flow) |
| 10–25 | Deep dive on 1–2 components (data model, API, the hard part) |
| 25–35 | Interviewer challenges (failure, scale, trade-offs) |
| 35–42 | Respond to challenges, revise design |
| 42–45 | Summary, explicit call-out of what you'd do with more time |

**60-minute interview budget:**

| Minutes | Phase |
|---|---|
| 0–7 | Clarifying questions, scope, assumptions |
| 7–15 | High-level architecture |
| 15–35 | Deep dive on 2–3 components |
| 35–50 | Interviewer challenges (failure/scale/trade-offs, usually 2–3 rounds) |
| 50–57 | Revisions, remaining edge cases |
| 57–60 | Summary and wrap-up |

**Rule of thumb:** if you're past the halfway mark and still on high-level architecture, say so out loud and cut scope — *"I'm going to stop adding boxes and go deep on the payment write path now, since that's likely the most interesting part."* Silence about time is what reads as poor judgment; running long while narrating your own budget rarely counts against you.

---

## Phase 2 — Whiteboarding

### Clean Diagrams — a visual vocabulary to stay consistent

Pick one convention before the interview and never deviate — consistency reads as rigor, and
inconsistency (a client box that looks like a database box five minutes later) actively costs you
clarity points.

**Recommended shape convention:**

- **Rectangle** = a stateless service/process (API gateway, application server, worker).
- **Cylinder** = a stateful data store (DB, cache, object store). Label the type inside it (e.g., "Postgres (primary)").
- **Rounded rectangle / hexagon** = a managed external system or queue (Kafka, SQS, a third-party payment processor).
- **Solid arrow** = synchronous call, labeled with the protocol if relevant (HTTP, gRPC).
- **Dashed arrow** = asynchronous/event-driven flow.
- **Small numbered circles on arrows** = sequence of a specific request flow, when you need to narrate a step-by-step path (e.g., ① client submits → ② gateway validates → ③ enqueue event → ④ worker processes).
- **A different color/box style for "region" or "AZ" boundaries** — draw the boundary box *first*, faintly, before placing components in it, so multi-region discussions don't require re-drawing everything.

Keep a top-left corner of the board reserved for your **assumptions list** and a top-right corner
for a **running numbers box** (QPS, storage estimate, replication factor) — interviewers will ask
"what's your read QPS again?" and pointing at a persistent number beats recalculating live.

### Narrating Thinking — out loud without rambling

The goal is **decision-oriented narration**, not stream-of-consciousness. A useful frame: every
sentence you say while drawing should be one of exactly three types —

1. **A decision** — "I'll put a queue between ingestion and processing so a slow downstream doesn't block writes."
2. **A reason** — "...because this endpoint needs to accept bursts we can't synchronously absorb."
3. **A flag for later** — "...I'll come back to what happens if the queue backs up."

If a sentence isn't one of those three, cut it. Avoid narrating *implementation trivia* out loud
("I'm just going to draw a box here... and another box... let me connect these") — that's dead air
with words in it.

**Example of good narration density:**

> "I'll put writes through a single primary Postgres instance for the ledger — decision — because
money-movement needs strong consistency and I don't want two replicas racing on a balance update —
reason. I'll flag that this primary becomes a scaling bottleneck at high write volume, and come back
to sharding it if we get to the scale challenge — flag."

That's three sentences covering a decision, a justification, and a deliberate deferral — in about 15
seconds. Compare to a bad version that just says "so I'm gonna use Postgres here, yeah, Postgres,
because it's relational and it's good for this" — no decision rationale, no flag, wastes time and
signals shallow thinking.

### Controlling Depth — signaling broad vs. deep, and recovering from over-depth

**To signal you're deliberately going broad:**

> "I'm going to stay at the box level for now and cover the full request lifecycle before drilling
into any one piece — I'll flag which piece seems highest-risk as I go."

**To signal you're deliberately going deep:**

> "This is the part I think is the crux of the problem, so I want to spend real time on it — let me
know if you'd rather I stay higher-level."

That check-in matters: it hands the interviewer a steering wheel, which is exactly what they want
from a Staff candidate — someone calibrating to the room, not performing a monologue.

**Recovering from going too deep too early** (you've spent 12 minutes on the schema for a "nice-to-have" table and haven't drawn the rest of the system):

1. **Name it, don't apologize excessively.** One sentence: *"I've gone deeper than I should have on this piece — let me zoom back out and finish the rest of the architecture, then return here if there's time."*
2. **Immediately zoom out** — draw the remaining boxes at low fidelity, even placeholder boxes with a one-word label, so the interviewer sees the full shape of your system.
3. **Do not re-litigate the over-depth** — no need to explain *why* you went deep, just correct course. Dwelling on the mistake burns more time than the mistake itself did.

---

## Phase 3 — Interviewer Challenges

These are not gotchas — they're the actual test. Anyone can draw a happy-path architecture; Staff-
level judgment shows up in how you reason about the questions below. For each, the model answer
includes the **underlying framework** so you can adapt it to whatever specific system you're
designing, not just recite it.

### "Why Kafka?"

**Framework:** justify a messaging choice along four axes — *delivery semantics needed, ordering needed, throughput/retention needed, and operational cost you're willing to accept*. Never justify a technology by its reputation ("it's what everyone uses").

**Model answer:**
> "I chose Kafka here for three reasons tied to this system's needs, not because it's the default.
First, we need at-least-once delivery with replay — if a downstream consumer (fraud scoring) goes
down for 10 minutes, I don't want to lose events, and Kafka's retention lets it catch up. Second, we
need ordering per key — per-account event ordering matters for the ledger, and Kafka's per-partition
ordering gives me that if I partition by account ID. Third, we have multiple independent consumers
of the same event stream — ledger, fraud, notifications — and a pub/sub log lets each consume at its
own pace without the producer knowing about them. If instead we only had one consumer and needed
simple task distribution, I'd reach for SQS instead — less operational overhead, and we wouldn't be
using Kafka's replay/multi-consumer strengths anyway."

**Generalizes to:** "Why SQS/RabbitMQ/Kinesis?" — swap in the relevant axes (SQS: simplicity + at-least-once + no ordering guarantee across a queue; RabbitMQ: flexible routing + smaller-scale; Kinesis: managed Kafka-alternative with AWS-native integration).

### "Why not PostgreSQL?"

**Framework:** this question almost always means "convince me you considered the boring, reliable default and are deviating deliberately." Answer by naming the specific access pattern that Postgres struggles with — write throughput past vertical scaling limits, a graph-shaped query pattern, an unstructured/schema-flexible payload, or a need for horizontal write scaling beyond what read replicas solve.

**Model answer:**
> "Postgres is actually my default, and I'd keep it for the ledger and account data — strong
consistency, transactions, and mature tooling win there. Where I moved away from it is the
event/activity feed, because that access pattern is high-write, append-mostly, queried by time range
and partition key rather than by relational joins — a wide-column or log-oriented store fits that
shape better and scales writes horizontally more easily than a single Postgres primary. So it's not
'Postgres is bad,' it's 'this specific access pattern doesn't play to Postgres's strengths, and I
don't want to bend the tool to fit the data.'"

**Generalizes to:** "Why not MySQL / why NoSQL / why not a relational model at all?" — same shape: name the specific pattern (join-heavy vs. key-lookup-heavy, strong consistency vs. eventual, fixed schema vs. flexible), and always concede where the "boring" choice is still correct elsewhere in the same system. Conceding partial ground makes the deviation more credible, not less.

### "What fails here?"

**Framework:** systematically walk single points of failure in this order — **network partition → node/process crash → dependency slowness/timeout → data corruption/bad write → human error (bad deploy/config)**. Pick the one or two most consequential for *this* system rather than listing all five shallowly.

**Model answer:**
> "Let me walk the critical path and find the weakest link. The single Postgres primary is the
biggest one — if it goes down, all writes stop until failover completes, and if failover takes 30
seconds, we've dropped a window of payments. I'd mitigate with synchronous replication to a standby
and automated failover, and on the client side, have the write path retry with an idempotency key so
a client retry after a failover doesn't double-charge. Second-biggest: the message queue's
downstream consumer for fraud scoring — if it can't process events fast enough, does the money move
before or after fraud clears? I'd make sure the design explicitly puts fraud check on the
synchronous critical path or clearly documents that it's async post-hoc review, because that's a
business decision, not just a technical one."

**Generalizes to:** any "what breaks" question — always end with *how you'd detect it* (monitoring/alerting) and *how you'd contain blast radius* (retries, circuit breakers, idempotency), not just "it would break."

### "What happens at 10x traffic?"

**Framework:** don't redesign from scratch — identify the **first bottleneck to break** (usually the least horizontally-scalable component: a single DB primary, a synchronous fan-out call, a hot partition key) and describe the *specific* next step, with a rough number.

**Model answer:**
> "At 10x, the first thing to break is almost certainly the Postgres primary's write throughput — if
we're at, say, 2,000 writes/sec now, 20,000 is past what a single well-tuned primary handles
comfortably. The fix path: first, make sure writes are batched/pipelined where possible; second,
shard the ledger by account ID range or hash, since account-scoped queries stay within a shard;
third, revisit whether the cache in front of reads is absorbing enough — at 10x read load if cache
hit rate stays the same, absolute cache traffic also goes up 10x, so I'd check whether the cache
tier itself needs to scale out. I would *not* jump straight to 'add more shards everywhere' — I'd
scale the actual bottleneck first and re-measure."

**Generalizes to:** any scale multiplier question — always name a concrete current number (even estimated), show the arithmetic, and name the *first* thing to break rather than vaguely gesturing at "everything gets harder."

### "Can you simplify this?"

**Framework:** this is usually testing whether you over-engineered out of habit. Look for: components justified by "future-proofing" rather than a stated current requirement, and multiple technologies solving the same problem. Be willing to *actually cut something* — proposing a fake simplification (renaming boxes) is worse than proposing none.

**Model answer:**
> "Yes — actually, looking back, I added a separate caching layer and a read-replica fleet. If our
actual read QPS is only a few hundred per second, as we said earlier, a single well-indexed primary
probably handles that without a cache at all — I added the cache reflexively, not because we hit a
measured bottleneck. I'd cut it, and add it back only if we see read latency or DB load become a
real problem — that's a decision I can make with actual metrics rather than guessing now."

**Generalizes to:** the ability to say "I over-built this, here's what I'd remove" is itself a Staff-level signal — juniors treat every added component as a sunk-cost commitment; Staff engineers treat their own diagram as disposable.

### "What if Redis goes down?"

**Framework:** distinguish whether the cache is used as (a) a pure performance optimization (cache-aside, safe to lose — falls back to DB with higher latency) vs. (b) load-bearing for correctness or availability (session store, rate limiter, distributed lock, idempotency-key store) — the answer is completely different depending on which.

**Model answer:**
> "It depends on what I'm using Redis for here. If it's just a read-through cache for product data,
losing it means a latency spike and a thundering herd on the DB as everything falls through — I'd
mitigate with request coalescing and a brief circuit breaker so we don't hammer the DB with
duplicate lookups for the same key. But if I were using Redis for something load-bearing — say, the
idempotency-key store for payment retries — losing it is much worse, because I could lose the
ability to detect a duplicate payment request. For anything load-bearing like that, I'd either
persist it in the primary datastore as well (write idempotency keys to Postgres, not just Redis) or
use Redis in a highly-available cluster mode with persistence enabled, accepting the added
complexity because correctness is at stake."

**Generalizes to:** "What if [any cache/dependency] goes down?" — always split into "is this an optimization or a correctness dependency" first; the answer writes itself after that.

### "What if two regions lose connectivity?" (network partition)

**Framework:** this is CAP theorem in disguise — force yourself to state which side of the partition keeps availability and which sacrifices it, *per data type*, because most real systems don't pick one CAP answer globally — they pick per subsystem.

**Model answer:**
> "This is a partition, so per CAP I have to choose between consistency and availability for each
partitioned dataset. For the ledger/balance data, I'd choose consistency over availability — I'd
rather the affected region reject writes (or degrade to read-only) than risk two regions
independently approving overlapping withdrawals against the same balance that can't be reconciled
once the partition heals. For something like a user's notification preferences or profile data, I'd
choose availability — let both regions keep serving reads/writes locally, and reconcile with last-
write-wins or a CRDT-style merge once the partition heals, since the cost of a stale preference is
negligible. I'd also make sure each region can detect the partition itself (not just rely on a
health check that might also be affected) and fail into a well-defined degraded mode rather than an
undefined one."

**Generalizes to:** any partition/split-brain question — the strong answer always differentiates by data criticality rather than giving one global answer, and always mentions the reconciliation step for the "available" side.

### Five Additional Curveball Questions

**"How would you migrate this system with zero downtime?"**
> Framework: expand-contract. Model answer: "I'd do this in three phases. Expand: deploy the new
schema/service alongside the old one, writing to both (dual-write) or writing to old and backfilling
new. Migrate: switch reads over gradually — feature-flag a percentage of traffic, verify parity
between old and new outputs, and roll forward or back based on live comparison. Contract: once 100%
of traffic is on the new path and it's been stable for a burn-in period, remove the old path and
stop dual-writing. The key discipline is never doing a hard cutover — always have a path back at
every step, and always verify with real traffic comparison before removing the old system, not just
before-migration testing."

**"How do you know this design actually meets the latency requirement you started with?"**
> Framework: walk the critical path and sum worst-case (or p99) latency at each hop, don't just
assert it's fine. Model answer: "Let's add it up — client to gateway is ~5ms, gateway to service
~5ms, service to DB read ~10ms at p99, serialization/network back ~5-10ms — that's roughly 25-30ms
for the fast path, well within a 200ms budget. If we add the fraud-check call synchronously, that's
an external call that could be 100-300ms at p99, which would blow the budget — that's exactly why
I'd want fraud scoring to either be async-post-approval or have a strict timeout with a fallback
(approve-then-review) rather than block the user on it."

**"Your two services need to agree on something — how do they avoid a distributed transaction?"**
> Framework: reach for the Saga pattern or outbox pattern rather than 2PC. Model answer: "I'd avoid
a two-phase commit across services — it couples their availability and doesn't scale well. Instead
I'd use the transactional outbox pattern: the service writes its local state change and an outgoing
event to an outbox table in the same local transaction, then a separate process publishes that event
reliably. The downstream service consumes it and does its own local transaction, publishing a
compensating event if it fails. This is a Saga — eventual consistency with explicit compensating
actions for failure, instead of trying to force atomicity across a network boundary."

**"If you could only add one piece of monitoring to this system, what would it be and why?"**
> Framework: pick the metric that would have caught the single biggest failure mode you already
identified in the "what fails here" discussion — tie it back rather than picking generically. Model
answer: "Given the ledger-write bottleneck we discussed, I'd add p99 write latency and write-queue
depth on the primary DB, alerting before it saturates — that's the leading indicator that would give
us minutes of warning before writes start failing outright, versus a generic 'DB is down' alert that
fires only after damage is done."

**"Someone on your team wants to add a second database for a new feature — how do you decide if that's the right call?"**
> Framework: this tests operational judgment/polyglot-persistence discipline, not just technical
correctness. Model answer: "I'd ask three things: does the new access pattern genuinely not fit the
existing store's strengths (not just 'this new DB is trendy'), is the operational cost of running a
second store type — backups, monitoring, on-call familiarity, another failure mode to reason about —
worth the fit improvement, and can we get 80% of the benefit by just modeling the data differently
in the store we already run. If the answer to the first is a clear yes and the second is affordable,
I'd approve it, but I'd push back hard on adding infrastructure diversity for a marginal gain —
every additional storage technology is a permanent tax on the whole team's cognitive load and on-
call burden."

---

## Phase 4 — Recovery

Staff-level interviews are not scored on "never got stuck." They're scored on what you do *when* you
get stuck, wrong, or hinted — because that's what actually happens in real design reviews.

### Getting Stuck — self-talk and recovery technique

The panic response is to keep talking to fill silence. Resist it. Use this internal sequence:

1. **Name it internally, then externally, in one breath.** *"Give me a second, I want to think through this properly rather than guess out loud."* Silence for 10-15 seconds is completely acceptable and reads as deliberate, not lost — as long as you flag that you're taking it.
2. **Retreat to the last solid ground.** Ask yourself: "What's the last decision I was confident about?" Restate it out loud — this often unsticks the next step because saying the last known-good fact primes the next inference.
3. **Decompose the stuck point into a smaller question.** If "how do I make this idempotent" is the wall, narrow it: "Let me just think about the write path specifically — what's the natural unique key for a request here?"
4. **If still stuck after ~20-30 seconds, ask a targeted question instead of guessing blindly.** *"I'm trying to decide between two approaches here — can I think through both out loud with you?"* This converts a stall into a collaborative moment, which is exactly the working style the interviewer is evaluating for.

### Correcting Wrong Assumptions Mid-Interview

The exact phrasing matters — it should read as continuous rigor, not a scramble.

> "Actually, let me revise something I said earlier — I assumed reads and writes were roughly
balanced, but given the access pattern we just discussed, this is clearly read-heavy, maybe 100:1.
That changes my earlier decision to skip a cache — I'd add one now."

The formula: **name what you're revising → name the new evidence that triggered it → state the
concrete design change that follows.** Never apologize more than once ("sorry, sorry, that was wrong
of me") — one clean correction reads as rigor; over-apologizing reads as anxiety.

### Handling Hints Gracefully

An interviewer hint is a gift, not an accusation. Take it at face value and build on it rather than
defending your prior position.

> Interviewer: "Have you thought about what happens if two requests race on that update?"
> Good response: "Good point — I hadn't fully worked that through. Let me think about it: if two
updates race on the same row, I'd want either a compare-and-swap on a version column, or to push the
update through a single-writer queue keyed by the entity ID so races can't happen in the first
place. I'll go with optimistic locking via a version column since it's simpler and this doesn't
sound like a high-contention key."

Avoid: "Oh yeah, I was going to get to that" (transparently defensive, and the interviewer knows
it), or silently changing the design without acknowledging the hint (looks like you didn't
understand why it mattered).

### Changing Your Design Gracefully

A full pivot doesn't have to look like a collapse if you frame it as **narrowing**, not
**replacing**.

> "I want to change my approach here — not because the first one was unworkable, but because now
that we've talked through the consistency requirement, a queue-based approach fits better than the
direct synchronous call I started with. Everything else we discussed — the schema, the API shape —
stays the same; it's really just this one arrow that changes from solid to dashed."

The framing move: explicitly state what does **not** change. This bounds the blast radius of the
pivot in the interviewer's mind and demonstrates that most of your design was sound — only one
component needed revision, which is a normal and healthy part of iterative design, not a sign the
whole thing was wrong.

---

## Phase 5 — Company-Style Mocks

Different companies weight the same 60 minutes very differently. Calibrating to house style is
itself a signal of preparation.

### Google — scale and distributed-systems rigor

**Style:** Expect deep probing on consistency models, partitioning strategy, and the actual mechanics of distributed algorithms (consensus, replication, hashing) rather than high-level architecture. Interviewers often push past the point where most candidates run out of depth, specifically to find where your knowledge ends. Expect "why not" questions stacked three deep on any storage or consistency choice.

**Practice prompt:** *"Design a globally distributed key-value store with tunable consistency, used as the backing store for another service's session data."*
**Pointer:** Stage 3 (data stores, partitioning/replication) and Stage 8's CAP/PACELC trade-off framework are your core backing knowledge here — be ready to go two levels deeper than usual on quorum reads/writes and hinted handoff.

### Amazon — leadership-principle tie-in and trade-off obsession

**Style:** Amazon interviewers frequently ask you to narrate *why* you made a call in terms of a trade-off you accepted, and may explicitly connect design decisions to "Ownership," "Bias for Action," or "Frugality"-style reasoning ("did you actually need that extra service, or were you optimizing for showing off breadth?"). Expect repeated "why not the simpler thing" pressure — this overlaps heavily with the "Can you simplify this?" pattern in Phase 3.

**Practice prompt:** *"Design a same-day delivery scheduling and dispatch system for a regional warehouse network."*
**Pointer:** Stage 8's trade-off framework (this vs. that, with an explicit cost you accept) is exactly what's being tested — practice narrating every decision as "I chose X, which costs us Y, and I'm accepting that because Z."

### Microsoft — pragmatic breadth, enterprise integration awareness

**Style:** Tends to be less adversarial than Google/Amazon, more collaborative — interviewers often build the design *with* you, and value awareness of enterprise realities (on-prem/hybrid cloud constraints, backward compatibility, integration with existing identity/directory systems). Depth expectations are real but the interaction style rewards clear communication as much as raw distributed-systems trivia.

**Practice prompt:** *"Design a document collaboration and real-time co-editing system (like a shared document editor) that must also support offline edits that sync later."*
**Pointer:** Stage 6/7-style conflict-resolution and sync patterns (operational transform / CRDT territory) plus Stage 8's consistency trade-off framework for the offline-sync reconciliation piece.

### PayPal — consistency, idempotency, and reconciliation obsession

**Style:** Money-movement correctness dominates. Expect the interviewer to probe hard on: exactly-once-effect semantics (even over at-least-once delivery), idempotency keys, double-entry ledger correctness, reconciliation jobs, and what happens on partial failure mid-transaction (crash between debit and credit). "What fails here?" in a PayPal interview almost always means "walk me through a crash between step 2 and step 3 of your money movement."

**Practice prompt:** *"Design a peer-to-peer money transfer system that must never double-charge or lose a transfer, even under retries and partial failures."*
**Pointer:** Use your Level 5/6 FinTech ledger design from earlier stages, plus Stage 8's idempotency and Saga/compensating-transaction frameworks — this is the single most important pattern to have cold for this company style.

### Visa / Mastercard — network-scale consistency, fraud, and settlement timing

**Style:** Similar correctness obsession to PayPal but layered with network-of-networks concerns: authorization vs. clearing vs. settlement as distinct phases with different latency/consistency requirements, fraud scoring on the critical path under a strict latency SLA (often sub-100ms for auth), and multi-party reconciliation (issuer, acquirer, network) rather than a single ledger owner.

**Practice prompt:** *"Design the authorization flow for a card payment network, where an authorization decision must be returned within 100ms and later reconciled against a batch settlement process."*
**Pointer:** Stage 8's latency-budget-under-critical-path framework plus the FinTech reconciliation/settlement design from Stage 5/6 — be ready to explicitly separate the fast synchronous decision from the slower async settlement truth.

### Walmart / ServiceNow-style Staff interviews — pragmatic scale, operational maturity

**Style:** These enterprise/retail-scale companies (and similarly Oracle/TCS-adjacent "Group 1" shops) tend to emphasize operational maturity over cutting-edge distributed-systems trivia: how you'd roll this out safely, how you monitor and degrade gracefully, multi-tenant considerations, and cost-consciousness at scale (Walmart-scale traffic on thin margins). Expect "what's your rollout plan" and "how do you avoid a bad deploy taking down checkout on Black Friday" style questions layered onto the core design.

**Practice prompt:** *"Design an inventory management system that must stay accurate across thousands of stores and a website, with a seasonal 10x traffic spike (holiday sale)."*
**Pointer:** Stage 8's scale-multiplier framework ("what happens at 10x") and Stage 7's deployment/rollout and graceful-degradation patterns are the core backing knowledge — this style rewards operational war-story-shaped answers more than raw algorithmic depth.

---

## Phase 6 — Full Mock Interviews

### Structure and Time Allocation

Run every self-mock through this exact seven-phase shape. It maps directly onto the 45/60-minute
budgets in Phase 1 but names each block by function so you can grade yourself phase-by-phase.

| Phase | 45-min allocation | 60-min allocation | What happens |
|---|---|---|---|
| Requirements | 5 min | 7 min | Clarifying questions, scope cut, assumptions stated |
| Architecture | 5 min | 8 min | High-level boxes/arrows, core flow narrated |
| Deep dive | 15 min | 20 min | Data model, API shape, the hardest 1-2 components |
| Failure challenge | 6 min | 8 min | "What fails here?" style pressure |
| Scale challenge | 6 min | 8 min | "What happens at 10x?" style pressure |
| Trade-off challenge | 5 min | 6 min | "Why X not Y / can you simplify?" pressure |
| Feedback | 3 min | 3 min | Interviewer (or self, in a solo mock) recaps strengths/gaps |

### Scoring Rubric

Self-grade every practice session against this table. Be honest — a 3 across the board with one
honest 1 is a far more useful signal than an inflated set of 5s.

| Dimension | 1 (Weak) | 3 (Adequate) | 5 (Strong) |
|---|---|---|---|
| **Requirements** | Jumps straight to drawing; no scale numbers or consistency needs established | Asks a few clarifying questions but misses at least one major axis (e.g., never asks about consistency) | Runs a full clarifying pass, gets concrete numbers, explicitly negotiates scope and states assumptions out loud |
| **Architecture** | Boxes are inconsistent/unlabeled; flow is unclear even after explanation | Clear high-level diagram, core flow makes sense, but boundaries (services vs. data stores) are fuzzy | Clean, consistent visual vocabulary; core flow and boundaries are unambiguous at a glance; scales visually to add detail later |
| **Distributed systems** | No mention of replication, partitioning, or consistency; treats system as if it runs on one machine | Mentions relevant distributed-systems concepts but applies them generically, not tailored to this system's needs | Correctly identifies which parts need strong vs. eventual consistency, reasons about partition tolerance and replication trade-offs specific to this design |
| **Scalability** | No discussion of load, or numbers are made up without justification | Identifies the obvious bottleneck (e.g., "the DB") but doesn't propose a specific, sized fix | Names the first-to-break component with real arithmetic, proposes a specific scaling path (sharding key, cache strategy, horizontal scale-out) with rough numbers |
| **Reliability** | No failure-mode discussion unless prompted; answers "what fails" with vague hand-waving | Identifies 1-2 real failure modes when asked, proposes generic mitigations (retries, "add redundancy") | Proactively walks failure modes unprompted, proposes specific mitigations (idempotency keys, circuit breakers, compensating transactions) tied to this system |
| **Data** | No explicit schema or data model; can't answer "what does this table look like" | Has a reasonable schema/data shape but hasn't thought about access patterns driving the choice | Data model is clearly derived from access patterns; can justify every field/index/partition key by a specific query it serves |
| **Trade-offs** | States a choice with no justification ("I'll use Kafka") or justifies by popularity | Gives a plausible reason for a choice but doesn't acknowledge the cost/downside | Every major choice is stated as "X over Y, because Z, accepting cost W" — trade-offs are explicit in both directions |
| **Communication** | Long silences with no narration, or rambling without clear decision points | Explains most decisions but mixes trivia narration with real reasoning, making it hard to follow the thread | Every statement is a decision, a reason, or a flag; interviewer never has to ask "wait, why did you do that" |
| **Staff-level signals** | Never revises the design, never pushes back on scope, treats every interviewer comment as a correction to obey silently | Handles hints reasonably and makes some revisions, but doesn't proactively self-critique or simplify unprompted | Proactively narrows scope, self-identifies over-engineering, handles pivots by naming what stays vs. changes, negotiates with the interviewer as a peer rather than an examiner |

**How to use this table in a solo mock:** record yourself (audio is enough), run the full 45/60-minute structure against a prompt below, then re-listen and score each row honestly before moving to the next practice prompt. Two consecutive sessions scoring 4+ across every row is a reasonable signal of readiness for real interviews at this level.

---

## Self-Run Practice Prompts

Use these for full timed solo mocks. Set a real timer, follow the Phase 6 structure exactly, and
self-score with the rubric above afterward.

### Prompt 1 — PayPal-style payments system

> **"Design a digital wallet system that lets users hold a balance, send money to other users
instantly, and top up from a linked bank account. The system must never lose money, never double-
apply a transaction, and must reconcile correctly even if a step fails mid-flow."**

Backing knowledge: your Level 5/6 FinTech ledger and wallet design, plus Stage 8's idempotency,
Saga/compensating-transaction, and consistency trade-off frameworks. Expect to be challenged hardest
on "what happens if the process crashes between debiting sender and crediting receiver" — have that
answer cold before you start the clock.

### Prompt 2 — General Staff-level "design X" prompt

> **"Design a URL shortener that also supports custom aliases, click analytics, and link expiration,
at a scale of 100M new links per day."**

Backing knowledge: Stage 2/3 scaling and data-store patterns for the core write/redirect path, Stage
4's caching patterns for the hot-redirect path, and Stage 8's 10x-scale framework — this prompt is
intentionally "simple on the surface" specifically to test whether you manufacture appropriate depth
(hot-key handling, analytics as an async side pipeline, expiration as a background sweep vs. lazy
check) rather than staying shallow because the prompt sounds easy.

### Prompt 3 — Oracle-enterprise-style prompt

> **"Design a multi-tenant enterprise resource planning (ERP) module for invoice processing, used by
thousands of corporate customers, each with strict data isolation requirements, configurable
approval workflows, and integration with each customer's own on-prem or cloud accounting system."**

Backing knowledge: Stage 6/7 multi-tenancy and integration patterns, Stage 8's trade-off framework
for isolation strategy (shared schema vs. schema-per-tenant vs. database-per-tenant), and the
operational-maturity framing from the Walmart/ServiceNow mock style above — this prompt specifically
rewards enterprise pragmatism (configurability, backward-compatible integration points, tenant
isolation) over pure internet-scale distributed-systems flourish.
