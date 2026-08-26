# MyPreparation
Last updated: 2026-08-27
_Overview and notes._
Last updated: 2026-08-27

# Senior/Staff System Design — Study Guide Index
Last updated: 2026-08-27
_Overview and notes._
Last updated: 2026-08-27

Target: Group-1 companies (PayPal, Oracle, TCS, and similar enterprise-scale interviews).

This curriculum follows the 9-stage roadmap agreed on (HLD before LLD). Stages 5 and 7 were each
split into multiple files so every topic could get full depth without one file becoming unmanageable
— the stage numbering and content coverage still match the original plan exactly.

## Foundation

| Stage | File | Covers |
|---|---|---|
| 1 — Architecture Building Blocks | [01-architecture-building-blocks.md](01-architecture-building-blocks.md) | Networking/request flow, caching & data stores, messaging, coordination, traffic protection, specialized infra, observability |
| 2 — Distributed Systems Fundamentals | [02-distributed-systems-fundamentals.md](02-distributed-systems-fundamentals.md) | Mental model & fallacies, consistency, data distribution, coordination/concurrency, delivery/ordering, distributed transactions, time & recovery |
| 3 — Reliability, Resilience & Production Engineering | [03-reliability-resilience-production-engineering.md](03-reliability-resilience-production-engineering.md) | Failure thinking, dependency/overload protection, HA, DR, production observability, incident thinking |

## Architecture

| Stage | File | Covers |
|---|---|---|
| 4 — HLD Foundations | [04-hld-foundations.md](04-hld-foundations.md) | Requirements, capacity estimation, API/contract design, data modeling, decomposition, scaling, architecture review |
| 5 — HLD Mastery (Level 1–2) | [05a-hld-mastery-level1-2-foundation-and-scale.md](05a-hld-mastery-level1-2-foundation-and-scale.md) | URL Shortener, Pastebin, Rate Limiter, File Storage, News Feed, Autocomplete, Distributed Cache, Metrics System |
| 5 — HLD Mastery (Level 3–4) | [05b-hld-mastery-level3-4-async-and-realtime.md](05b-hld-mastery-level3-4-async-and-realtime.md) | Notification Platform, Logging Platform, Job Scheduler, Webhook Delivery, Chat, Presence, Live Location, Collaborative Editing |
| 5 — HLD Mastery (Level 5–6) | [05c-hld-mastery-level5-6-marketplace-and-fintech.md](05c-hld-mastery-level5-6-marketplace-and-fintech.md) | E-commerce, Inventory, Booking, Food Delivery, Ride Sharing, Payment Gateway, Payment Processor, Wallet, Ledger, Refunds, Reconciliation, Fraud Pipeline — **read this one closely for PayPal-style interviews** |
| 5 — HLD Mastery (Level 7) | [05d-hld-mastery-level7-large-scale-architecture.md](05d-hld-mastery-level7-large-scale-architecture.md) | YouTube/Netflix, Google Drive, Uber, Amazon-like platform, Multi-region architecture |

## Software Design

| Stage | File | Covers |
|---|---|---|
| 6 — LLD Foundations | [06-lld-foundations.md](06-lld-foundations.md) | Object modeling, OOP, SOLID (with before/after code), interfaces/DI, state machines, concurrency, code quality |
| 7 — LLD Mastery (Patterns) | [07a-lld-design-patterns.md](07a-lld-design-patterns.md) | All 17 GoF patterns (Creational/Structural/Behavioral) with motivating problem, code, UML, trade-offs, symptom→pattern table |
| 7 — LLD Mastery (Practice Problems) | [07b-lld-practice-problems.md](07b-lld-practice-problems.md) | Parking Lot, Vending Machine, Elevator, Library System, ATM, Coffee Machine, Logger, Cache, Task Scheduler, Splitwise, Chess, Cab Booking, Notification Framework |

## Seniority & Interview

| Stage | File | Covers |
|---|---|---|
| 8 — Staff/Principal Architecture | [08-staff-principal-architecture.md](08-staff-principal-architecture.md) | Trade-off thinking, scale-tier evolution (1K→100M), migration strategy, multi-region, governance/ADRs, security architecture, cost & ops |
| 9 — Interview Mastery | [09-interview-mastery.md](09-interview-mastery.md) | Opening/whiteboarding technique, stock challenge questions with model answers, recovery tactics, company-style mocks, full mock structure + scoring rubric |

## Supplementary Deep Dives

| Topic | File | Covers |
|---|---|---|
| Kafka Deep Dive | [kafka-deep-dive.md](kafka-deep-dive.md) | Full 35-lesson Kafka curriculum (~36,700 words). Fundamentals (topics/partitions/partition-key choice, offsets, consumer groups) → Internals (replication/ACKs/ISR/leader election, KRaft, producer/consumer internals, log segments, page cache, zero copy, batching, compression) → Enterprise/reliability patterns (idempotent producer, transactions/exactly-once, Kafka Connect, Schema Registry, Kafka Streams, ksqlDB, DLQ, retry topics, Kafka-specific Outbox/Saga, event sourcing, CDC/Debezium, MirrorMaker 2) → running it at scale (multi-region, security, monitoring, production case studies). Goes far beyond Stage 1's Kafka overview; read it alongside or after Stage 1 Phase 3 if Kafka is likely to come up in depth (e.g. PayPal-style interviews). |

## Suggested reading order

Read top-to-bottom in the table order above — each stage is written to build on the one before it
(Stage 4 assumes Stages 1–3; Stage 5's designs assume Stage 4's checklist; Stage 7 assumes Stage 6's
OOP/SOLID grounding; Stage 9 assumes everything else).

For PayPal/Visa-style interviews specifically, treat **05c** and **08's trade-off section** as the
highest-leverage material, then run the PayPal-style mock prompt at the end of **09**.
