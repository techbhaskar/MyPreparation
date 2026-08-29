---
slug: /
---

# Senior/Staff System Design — Study Guide Index
Last updated: 2026-08-27

_A compact roadmap and study guide for senior engineering interviews._

**Target audience:** Group-1 companies (PayPal, Oracle, TCS, and similar enterprise-scale interviews)

_Last updated: 2026-08-27_

This curriculum follows the 9-stage roadmap (HLD before LLD). Stages 5 and 7 are split into multiple
files so each topic can get full depth without making individual files unmanageable.

---

## Foundation

| Stage | File | Covers |
|---|---|---|
| 1 — Architecture Building Blocks | [01-architecture-building-blocks.md](01-architecture-building-blocks.md) | Networking/request flow, caching & data stores, messaging, coordination, traffic protection, specialized infra, observability |
| 2 — Distributed Systems Fundamentals | [02-distributed-systems-fundamentals.md](02-distributed-systems-fundamentals.md) | Mental model & fallacies, consistency, data distribution, coordination/concurrency, delivery/ordering, distributed transactions, time & recovery |
| 3 — Reliability, Resilience & Production Engineering | [03-reliability-resilience-production-engineering.md](03-reliability-resilience-production-engineering.md) | Failure thinking, dependency/overload protection, HA, DR, production observability, incident thinking |

---

## Architecture

| Stage | File | Covers |
|---|---|---|
| 4 — HLD Foundations | [04-hld-foundations.md](04-hld-foundations.md) | Requirements, capacity estimation, API/contract design, data modeling, decomposition, scaling, architecture review |
| 5 — HLD Mastery (Level 1–2) | [05a-hld-mastery-level1-2-foundation-and-scale.md](05a-hld-mastery-level1-2-foundation-and-scale.md) | URL Shortener, Pastebin, Rate Limiter, File Storage, News Feed, Autocomplete, Distributed Cache, Metrics System |
| 5 — HLD Mastery (Level 3–4) | [05b-hld-mastery-level3-4-async-and-realtime.md](05b-hld-mastery-level3-4-async-and-realtime.md) | Notification Platform, Logging Platform, Job Scheduler, Webhook Delivery, Chat, Presence, Live Location, Collaborative Editing |
| 5 — HLD Mastery (Level 5–6) | [05c-hld-mastery-level5-6-marketplace-and-fintech.md](05c-hld-mastery-level5-6-marketplace-and-fintech.md) | E-commerce, Inventory, Booking, Food Delivery, Ride Sharing, Payment Gateway, Payment Processor, Wallet, Ledger, Refunds, Reconciliation, Fraud Pipeline — **read this one closely for PayPal-style interviews** |
| 5 — HLD Mastery (Level 7) | [05d-hld-mastery-level7-large-scale-architecture.md](05d-hld-mastery-level7-large-scale-architecture.md) | YouTube/Netflix, Google Drive, Uber, Amazon-like platform, Multi-region architecture |

---

## Software Design

| Stage | File | Covers |
|---|---|---|
| 6 — LLD Foundations | [06-lld-foundations.md](06-lld-foundations.md) | Object modeling, OOP, SOLID (with before/after code), interfaces/DI, state machines, concurrency, code quality |
| 7 — LLD Mastery (Patterns) | [07a-lld-design-patterns.md](07a-lld-design-patterns.md) | All 17 GoF patterns (Creational/Structural/Behavioral) with motivating problem, code, UML, trade-offs, symptom→pattern table |
| 7 — LLD Mastery (Practice Problems) | [07b-lld-practice-problems.md](07b-lld-practice-problems.md) | Parking Lot, Vending Machine, Elevator, Library System, ATM, Coffee Machine, Logger, Cache, Task Scheduler, Splitwise, Chess, Cab Booking, Notification Framework |

---

## Seniority & Interview

| Stage | File | Covers |
|---|---|---|
| 8 — Staff/Principal Architecture | [08-staff-principal-architecture.md](08-staff-principal-architecture.md) | Trade-off thinking, scale-tier evolution (1K→100M), migration strategy, multi-region, governance/ADRs, security architecture, cost & ops |
| 9 — Interview Mastery | [09-interview-mastery.md](09-interview-mastery.md) | Opening/whiteboarding technique, stock challenge questions with model answers, recovery tactics, company-style mocks, full mock structure + scoring rubric |
| 10 — Quick Revision | [10-senior-java-architect-quick-revision.md](10-senior-java-architect-quick-revision.md) | High-signal revision layer for 17-year Java Lead / Architect interviews; use before reading the heavy deep dives |
| 11 — Java/Spring/Architecture Simple Explanations | [11-java-simple-explanations-for-interviews.md](11-java-simple-explanations-for-interviews.md) | Plain-English Java, Spring Boot, microservices, SOLID, design patterns, and architecture explanations before deep dives |

---

## Supplementary Deep Dives

| Topic | File | Covers |
|---|---|---|
| Kafka Deep Dive | [kafka-deep-dive.md](kafka-deep-dive.md) | Full 35-lesson Kafka curriculum (~36,700 words). Fundamentals → Internals → Enterprise/reliability patterns → running it at scale. Read alongside or after Stage 1 Phase 3 for deep Kafka interview prep. |
| Spring Boot Microservices Deep Dive | [spring-boot-microservices-deep-dive.md](spring-boot-microservices-deep-dive.md) | 17-topic deep dive for Java/Spring Boot backgrounds. Foundations → Microservices → Production & Security (cross-referenced with Kafka doc). |
| Core Java & JVM Deep Dive | [java-core-jvm-deep-dive.md](java-core-jvm-deep-dive.md) | 24-topic deep dive — language/JVM fundamentals underpinning LLD and framework-level concurrency and performance. |
| Java/Spring/Architecture Simple Explanations | [11-java-simple-explanations-for-interviews.md](11-java-simple-explanations-for-interviews.md) | Start here if the Java, Spring, LLD, or architecture deep dives feel too dense; then read the matching deep-dive topic. |

---

## Suggested reading order

For first-time learning, read top-to-bottom in the table order above — each stage builds on the
previous ones.

For interview revision, start with **10 — Quick Revision**. If Java or Spring topics feel difficult,
read **11 — Java/Spring Simple Explanations** before opening the deep dives.

For PayPal/Visa-style interviews, prioritize **05c** and the trade-offs in **08**, then run the
PayPal-style mock in **09**.
