# Senior Java Lead / Architect Quick Revision
Last updated: 2026-08-27

_Use this file before interviews. Use the deep-dive files only when a topic feels weak._

## How To Use This Study Set

The existing notes are intentionally deep. They are good for learning, but too heavy for daily
revision. For interview preparation, use three reading modes:

| Mode | Time | Use when | What to read |
|---|---:|---|---|
| Quick scan | 30-45 min | Before/after work, daily revision | This file only |
| Focused revision | 2-3 hours | A topic feels rusty | The relevant deep-dive topic and its interview questions |
| Mock prep | 45-60 min | Weekend or day before interview | One HLD/LLD prompt + verbal explanation |

## The 17-Year Profile Bar

For a Java Lead / Architect, interviewers are not only checking whether you know Java syntax or
Spring annotations. They are checking whether you can:

- Explain trade-offs clearly.
- Design systems that survive failure.
- Choose consistency, latency, cost, and reliability deliberately.
- Lead migration and modernization conversations.
- Debug production issues from symptoms to root cause.
- Mentor teams toward maintainable design.
- Communicate decisions in simple language.

Your answers should sound like: "Here is what I would choose, here is why, here is what can fail,
and here is how I would operate it in production."

## Priority Reading Order

If interview time is limited, do not read everything from top to bottom.

| Priority | File | Why it matters |
|---:|---|---|
| 1 | [08-staff-principal-architecture.md](08-staff-principal-architecture.md) | Builds senior/architect trade-off language |
| 2 | [05c-hld-mastery-level5-6-marketplace-and-fintech.md](05c-hld-mastery-level5-6-marketplace-and-fintech.md) | Best for PayPal/Visa/payment-style system design |
| 3 | [java-core-jvm-deep-dive.md](java-core-jvm-deep-dive.md) | Java/JVM depth expected from a senior Java profile |
| 4 | [spring-boot-microservices-deep-dive.md](spring-boot-microservices-deep-dive.md) | Spring Boot, microservices, security, observability |
| 5 | [03-reliability-resilience-production-engineering.md](03-reliability-resilience-production-engineering.md) | Production maturity: timeouts, retries, SLOs, incidents |
| 6 | [07b-lld-practice-problems.md](07b-lld-practice-problems.md) | LLD practice with class modeling |
| 7 | [09-interview-mastery.md](09-interview-mastery.md) | How to perform in the interview room |

## Java / JVM Must-Know List

Read the deep dive only for topics where you cannot explain the bullets below in 2-3 minutes.

### Language And Collections

- Functional interfaces: SAM, `@FunctionalInterface`, lambda vs anonymous class.
- Streams: lazy intermediate operations, terminal operations, parallel stream traps.
- Optional: return type use, avoid fields/parameters and `get()` without check.
- Records, sealed classes, pattern matching: where they improve domain modeling.
- `HashMap`: hashing, buckets, treeification, resizing, equals/hashCode contract.
- `ConcurrentHashMap`: lock striping/bin locking, weakly consistent iteration.

### Concurrency

- Java Memory Model: visibility, happens-before, `volatile`.
- `synchronized` vs `ReentrantLock` vs `ReadWriteLock`.
- ExecutorService: pool sizing for CPU-bound vs I/O-bound work.
- CompletableFuture: composition, exception handling, thread selection.
- CAS and atomics: compare-and-swap, ABA risk, when lock-free is useful.
- Deadlock: prevention using lock ordering, timeout, reducing shared state.
- Virtual threads: great for blocking I/O, not a cure for CPU-bound work.

### JVM And Performance

- Heap vs stack vs metaspace vs code cache.
- GC basics: G1 as common default, ZGC for low-latency/large heaps.
- Class loading: parent delegation, custom classloaders, classpath conflicts.
- JIT: warm-up, inlining, escape analysis, why microbenchmarks lie.
- Profiling: JFR, async-profiler, GC logs, thread dumps, heap dumps.

## Spring Boot / Microservices Must-Know List

### Spring Core

- Auto-configuration: conditional beans, starters, override rules.
- Dependency Injection: constructor injection, bean lifecycle, scopes.
- Transactions: proxy behavior, propagation, isolation, self-invocation trap.
- REST APIs: validation, error contracts, pagination, idempotency.
- Testing: unit, slice, integration, Testcontainers.

### Microservices

- Service boundaries: domain ownership, data ownership, transaction boundaries.
- API Gateway: routing, auth enforcement, rate limiting, observability.
- Service discovery: Kubernetes DNS vs Eureka/Consul, avoid double discovery.
- Resilience4j: timeout, retry, circuit breaker, bulkhead, rate limiter.
- Observability: logs, metrics, traces, correlation IDs.
- Security: OAuth/OIDC, JWT validation, mTLS, service-to-service auth.
- Kubernetes: readiness/liveness probes, graceful shutdown, config/secrets.

## System Design Must-Know List

For every HLD answer, cover these in order:

1. Clarify functional scope.
2. Clarify scale and traffic shape.
3. Identify consistency requirements.
4. Draw core services and data stores.
5. Explain write path and read path.
6. Choose data model and partition key.
7. Discuss caching and invalidation.
8. Discuss async processing and retries.
9. Discuss failure modes.
10. Discuss observability and operations.
11. Discuss security and compliance.
12. State trade-offs and future evolution.

## Payment / FinTech Must-Know List

For PayPal/Visa/banking-style interviews, be ready to explain:

- Idempotency key for payment initiation.
- Ledger as source of truth.
- Double-entry accounting.
- Authorization vs capture vs settlement.
- Wallet balance and available balance.
- Reconciliation between internal ledger and external processor.
- Refund and dispute handling.
- Fraud scoring as synchronous plus asynchronous layers.
- Exactly-once is usually "effectively once" using idempotency and deduplication.
- Never acknowledge money movement until the durable state is safely written.

## LLD Must-Know List

For a Java lead, LLD should show clean design, not pattern memorization.

- Start with use cases.
- Identify entities, value objects, services, repositories, policies.
- Put behavior close to the domain object when appropriate.
- Use interfaces for real variability, not everywhere.
- Prefer composition over inheritance.
- Model state transitions explicitly.
- Show thread-safety when shared mutable state exists.
- Add extension points only where requirements justify them.
- Mention tests for important invariants.

Good practice problems:

- Parking lot: object modeling and pricing strategy.
- Vending machine: state machine.
- Elevator: scheduling and concurrency.
- Logger framework: chain/strategy/appender design.
- Cache: eviction policy and thread safety.
- Splitwise: domain model and algorithmic simplification.

## Behavioral Stories To Prepare

Prepare 8-10 real stories using STAR format.

| Story | What it proves |
|---|---|
| Production incident you led | Ownership, debugging, calm under pressure |
| Architecture migration | Planning, risk reduction, incremental delivery |
| Technical debt decision | Business trade-off maturity |
| Disagreement with senior stakeholder | Influence without authority |
| Mentoring a weaker engineer/team | Leadership |
| Performance issue solved | Deep technical diagnosis |
| Failed design or wrong assumption | Learning and accountability |
| Security/compliance improvement | Architect-level risk thinking |
| Cost optimization | Business-aware engineering |
| Cross-team platform change | Communication and governance |

## Answer Templates

### Java Deep-Dive Answer

"At a high level, this works like X. The important internal detail is Y. In production, the risk is
Z. So my rule of thumb is A, except when B."

### Architecture Trade-Off Answer

"I would choose option A for this system because the main constraint is X. Option B is also valid if
Y matters more. The failure mode of A is Z, so I would mitigate it with these controls."

### Production Incident Answer

"First I would stabilize customer impact. Then I would identify the failing dependency or resource
saturation point using metrics, logs, and traces. After mitigation, I would add a prevention action:
alert, test, limit, or design change."

## Final 7-Day Revision Plan

| Day | Focus |
|---:|---|
| 1 | Java/JVM quick revision + 10 Java questions |
| 2 | Spring Boot + microservices + transactions/security |
| 3 | Distributed systems + reliability patterns |
| 4 | Payment/fintech HLD from `05c` |
| 5 | LLD practice: cache, logger, vending machine |
| 6 | Staff architecture: migration, multi-region, ADR, cost |
| 7 | Two mock interviews + behavioral stories |

## What Not To Do

- Do not memorize every paragraph from the deep dives.
- Do not answer with definitions only.
- Do not over-design every system as multi-region/event-driven/Kafka-based.
- Do not ignore production concerns.
- Do not skip behavioral preparation because the role is technical.

The goal is not to sound like a textbook. The goal is to sound like someone who has designed,
operated, repaired, and evolved real Java systems.
