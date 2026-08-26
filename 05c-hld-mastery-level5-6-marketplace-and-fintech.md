# Stage 5 (Part C) — HLD Mastery: Level 5 Marketplace Systems & Level 6 FinTech Systems
Last updated: 2026-08-27
_Overview and notes._
Last updated: 2026-08-27

> **Framing question:** *Can I combine the building blocks appropriately instead of memorizing
architectures?*

Every design below is built from the same small set of primitives you already know: load balancers,
stateless services, a queue, a cache, a primary datastore with an explicit consistency model, an
index for search/geo, and idempotency keys wherever money or state mutation is involved. The skill
being tested is not "have you seen this exact system" — it's "can you pick the right consistency
model, the right lock/queue/cache trade-off, and the right failure story for *this* combination of
constraints." Read each design asking: *which primitive is load-bearing here, and what breaks if I
swap it out?*

FinTech systems (Level 6) get extra depth because this candidate is targeting PayPal-style
interviews, where ledger correctness, idempotency, and reconciliation are asked directly and
evaluated harshly.

---

## Table of Contents

**Level 5 — Marketplace Systems**
1. [E-commerce Platform](#1-e-commerce-platform)
2. [Inventory Management](#2-inventory-management)
3. [Booking System](#3-booking-system)
4. [Food Delivery](#4-food-delivery)
5. [Ride Sharing](#5-ride-sharing)

**Level 6 — FinTech Systems**
6. [Payment Gateway](#6-payment-gateway)
7. [Payment Processor](#7-payment-processor)
8. [Wallet](#8-wallet)
9. [Ledger](#9-ledger)
10. [Refund System](#10-refund-system)
11. [Reconciliation](#11-reconciliation)
12. [Fraud/Risk Pipeline](#12-fraudrisk-pipeline)

---

## 1. E-commerce Platform

### Requirements

**Functional**
- Browse/search catalog, view product detail pages (PDP)
- Cart: add/remove/update quantity, cart persists across sessions/devices
- Checkout: address, shipping method, payment, order confirmation
- Order management: order history, status tracking, cancellation

**Non-functional**
- Catalog reads: high volume, read-heavy (100:1 read:write), tolerate slight staleness (seconds)
- Cart: must survive service restarts, low latency (<100ms)
- Checkout: must be **correct** — no double charges, no orders placed without payment captured, inventory not oversold (see Design #2)
- Availability > consistency for browsing; consistency > availability for checkout/payment steps
- Search relevance and facets (price, brand, rating) within ~200ms p99

### Scale/Capacity Estimation

Assume a mid-large retailer:
- 50M MAU, 5M DAU, peak concurrency ~200K
- Catalog: 20M SKUs, 500KB avg (images external/CDN, this is metadata+text)
- PDP views: 5M DAU × 10 views/day = 50M views/day ≈ 580 QPS avg, peak (3x) ≈ 1,740 QPS
- Search: 5M DAU × 3 searches/day = 15M/day ≈ 175 QPS avg, peak ≈ 500 QPS
- Cart writes: 5M DAU × 5 add-to-cart events = 25M/day ≈ 290 QPS avg
- Orders: 2% of DAU checkout = 100K orders/day ≈ 1.2 QPS avg, peak (flash sale) 10-50x ≈ 60 QPS
- Storage: catalog 20M × 500KB metadata ≈ 10TB (mostly images on CDN/object store, not counted here); orders: 100K/day × 5KB × 365 × 5yr retention ≈ 900GB

### API Design

```
GET  /catalog/search?q=...&filter=brand:nike&page=2
GET  /catalog/products/{sku}
POST /cart/items                 { sku, qty }              -> 200 {cart}
PUT  /cart/items/{sku}           { qty }
DELETE /cart/items/{sku}
POST /checkout/sessions          { cartId, addressId }     -> 201 {checkoutSessionId, totals}
POST /checkout/sessions/{id}/pay { paymentMethodId, idempotencyKey }
GET  /orders/{orderId}
GET  /orders?userId=...&status=shipped
POST /orders/{orderId}/cancel
```
Idempotency key on `pay` is non-negotiable — client retries on timeout must not double-charge or
double-create orders.

### Data Model

| Store | Entity | Why |
|---|---|---|
| Elasticsearch/OpenSearch | Product search index (denormalized: title, brand, price, facets) | Full-text + faceted filter, eventual consistency from catalog is fine |
| PostgreSQL (or MySQL) — catalog service | `products(sku, title, price, category_id, attrs_jsonb, version)` | Source of truth, needs transactional updates (price changes, etc.) |
| Redis | `cart:{userId} -> {sku: qty}` hash, TTL 30 days | Low latency, cart is ephemeral/session-like, acceptable to lose rare edge cases if backed by async persistence |
| PostgreSQL — order service | `orders`, `order_items`, `payments` (see below) | Strong consistency, ACID transactions for order creation |
| S3/CDN | Product images | Static assets |

```sql
orders(order_id PK, user_id, status, total_cents, currency, created_at, version)
order_items(order_id FK, sku, qty, unit_price_cents)
payments(payment_id PK, order_id FK, idempotency_key UNIQUE, status, processor_ref)
```
`idempotency_key UNIQUE` at the DB layer is the actual double-charge guard, not just an app-level
check.

### High-Level Design

```
                         ┌────────────┐
                         │   CDN/WAF  │
                         └─────┬──────┘
                               │
                      ┌────────▼────────┐
                      │  API Gateway/LB │
                      └───┬─────┬───┬───┘
              ┌───────────┘     │   └────────────┐
      ┌───────▼──────┐  ┌───────▼──────┐  ┌───────▼───────┐
      │ Catalog Svc  │  │  Cart Svc    │  │ Checkout/Order│
      │ (search+PDP) │  │  (Redis)     │  │    Service    │
      └──────┬───────┘  └──────────────┘  └───────┬───────┘
             │                                     │
      ┌──────▼───────┐                    ┌────────▼────────┐
      │ Elasticsearch│                    │ Inventory Svc   │──▶ (Design #2)
      │  + Catalog DB│                    │ Payment Gateway │──▶ (Design #6)
      └──────────────┘                    │  Order DB (PG)  │
                                           └────────┬────────┘
                                                     │ async events
                                              ┌──────▼───────┐
                                              │ Kafka: order.created │
                                              └──────┬───────┘
                                    ┌─────────────────┼─────────────────┐
                              ┌─────▼─────┐    ┌──────▼─────┐    ┌──────▼─────┐
                              │ Notif Svc │    │ Fulfillment│    │ Analytics  │
                              └───────────┘    └────────────┘    └────────────┘
```

**Request flow (checkout):** client creates a checkout session → server snapshots cart + prices + computes totals → client submits payment with an idempotency key → order service calls **Inventory** to reserve stock (short TTL hold) → calls **Payment Gateway** to authorize/capture → on success, commits order row + reservation-to-sale conversion in one DB transaction → emits `order.created` to Kafka → downstream services (fulfillment, notifications, analytics) consume asynchronously. If payment fails, inventory reservation is released.

### Deep Dive

**Hard problem: checkout must be atomic across three systems (cart snapshot, inventory, payment) that you do not want in one distributed transaction.**

Solution: **Saga pattern** with compensating actions, orchestrated by the order service.
1. Reserve inventory (TTL 10 min) — idempotent call keyed by `checkoutSessionId`.
2. Authorize payment (not capture yet) — idempotent call keyed by `idempotencyKey`.
3. Capture payment.
4. Convert inventory reservation → decrement.
5. Persist order row, mark `CONFIRMED`.

If step 3 fails: release reservation (step 1's compensation), mark order `FAILED`, return actionable
error. If step 5's DB write fails after payment captured (rare but must be handled): a
reconciliation job polls "captured payments without a confirmed order" every few minutes and either
completes the order or triggers a refund. This is the same pattern used everywhere in fintech (see
Refund/Reconciliation designs) — **money-moving steps are ordered so the reversible step happens
first and the irreversible step (capture) happens last**, minimizing the compensation surface.

**Second hard problem: cart consistency across devices.** Use Redis as source of truth with a monotonically increasing `version` per cart; client sends last-known version, server does last-write-wins per item with version check, and merges conflicting adds (sum quantities) rather than overwriting — this matches user expectation ("I added it on two devices, I want both") better than LWW-only.

### Scaling the Design
- Catalog: read replicas + ES sharded by SKU hash; cache PDP responses at CDN edge with short TTL (60s) + cache-busting on price change events.
- Cart: Redis cluster sharded by `userId`; cold-cart fallback to DB-backed store for durability beyond TTL.
- Checkout: horizontally scale stateless order service; DB is the bottleneck — shard order DB by `user_id` or `order_id` range once single-primary throughput (~5-10K TPS on modern Postgres) is insufficient at this order volume; unlikely needed at 100K orders/day but sketch it for flash-sale spikes.
- Flash sales: pre-warm cache, queue checkout requests instead of rejecting, degrade to "confirm order, allocate inventory async" with clear customer messaging if reservation contention is extreme.

### Failure Handling
- Payment gateway timeout: never assume failure — query gateway for status before retrying capture (idempotency key makes this safe).
- Inventory service down: fail checkout fast with retry-able error rather than accepting orders you can't fulfill.
- Kafka consumer lag on `order.created`: acceptable — fulfillment/notification are async by design; order confirmation to the user does not wait on them.
- Partial order writes: reconciliation job (see Deep Dive) sweeps orphaned payment captures.

### Trade-offs
- Eventual consistency for catalog/search (stale price for a few seconds) vs strong consistency for checkout (correctness of money > freshness of UI). This split is the single most important call in the whole design.
- Redis cart (fast, simple) vs DB-backed cart (durable, slower) — chose Redis + async backup because losing an occasional cart is low-cost; losing a payment is not.
- Saga (loosely coupled, eventually consistent) vs distributed 2PC (strongly consistent, but couples uptime of 3 services and is operationally painful) — saga wins for anything crossing service/team boundaries.

---

## 2. Inventory Management

### Requirements

**Functional**
- Track stock per SKU per warehouse/location
- Reserve stock during checkout (temporary hold), commit on payment success, release on failure/expiry
- Support distributed stock across multiple warehouses with routing to nearest/cheapest
- Support oversell prevention under concurrent checkout attempts

**Non-functional**
- Zero oversell tolerance for scarce items (launch drops, low stock) — correctness > latency here
- High throughput during flash sales: must handle bursty write contention on hot SKUs
- Reservation expiry must be reliable (no permanently "stuck" reserved stock)
- Eventual global visibility of stock levels for browsing (can be a few seconds stale)

### Scale/Capacity Estimation
- 20M SKUs × 50 warehouses (sparse — most SKUs in a handful of warehouses) → ~80M SKU-warehouse rows
- Peak reservation rate during flash sale on a hot SKU: 50,000 concurrent checkout attempts for 500 units — this is the crux of the design (huge write contention on a single row)
- Steady state: 100K orders/day × 1.5 items avg = 150K reservation events/day ≈ 1.7 QPS avg, but hot-SKU peak can be 1,000+ QPS on a single row for seconds at a time
- Reservation TTL: 10 minutes → at peak, up to 500K reservations "in flight" system-wide

### API Design

```
GET  /inventory/{sku}?warehouse=nearest&lat=..&lng=..   -> {available, warehouse_id}
POST /inventory/reservations         { sku, qty, warehouse_id, checkoutSessionId } -> {reservationId, expiresAt}
POST /inventory/reservations/{id}/commit                 (idempotent)
POST /inventory/reservations/{id}/release                (idempotent)
GET  /inventory/{sku}/warehouses      -> [{warehouse_id, available, distance}]
```

### Data Model

Chose **relational DB with row-level locking / optimistic concurrency** (PostgreSQL) over a NoSQL KV
store for stock counters, *specifically because oversell prevention needs atomic conditional
decrements with strong consistency* — this is the one place in the whole marketplace stack where you
actively want to sacrifice throughput for correctness.

```sql
stock(sku, warehouse_id, on_hand, reserved, available GENERATED (on_hand - reserved),
      version INT, PRIMARY KEY(sku, warehouse_id))

reservations(reservation_id PK, sku, warehouse_id, qty, status ENUM(HELD,COMMITTED,RELEASED,EXPIRED),
             checkout_session_id UNIQUE, created_at, expires_at)
```
`checkout_session_id UNIQUE` makes reservation creation idempotent — retries from the checkout saga
don't double-reserve.

### High-Level Design

```
Checkout/Order Svc
       │ POST /reservations
       ▼
┌─────────────────┐        ┌───────────────┐
│ Inventory Service│──────▶│ Stock DB (PG) │  (sharded by sku hash across warehouses)
│  (stateless)     │        │ row-level lock │
└────────┬─────────┘        └───────────────┘
         │ writes reservation, schedules expiry
         ▼
   ┌─────────────┐
   │ Redis TTL   │  key: reservation:{id}, on expiry -> event -> release job
   │ / delay queue│
   └─────────────┘
         │
         ▼
   ┌─────────────────────┐
   │ Reservation Sweeper  │ (cron/consumer): finds expired HELD rows not yet released, releases them
   └─────────────────────┘

Read path (browse "in stock?"):
Client -> CDN/cache (short TTL) -> Inventory read replica -> aggregated across warehouses
```

**Request flow (reserve):** order service calls `POST /reservations`. Inventory service runs, inside one DB transaction: `UPDATE stock SET reserved = reserved + qty WHERE sku=? AND warehouse_id=? AND available >= qty` (conditional update using the generated `available` column, or `on_hand - reserved >= qty` directly). If 0 rows affected → out of stock, return 409. If success, insert `reservations` row and set a TTL-based expiry (Redis key with keyspace-notification, or a delayed queue message). On payment success, order service calls `/commit` which flips `reserved -= qty; on_hand -= qty` and marks reservation `COMMITTED`. On failure/timeout, `/release` or the sweeper decrements `reserved` back.

### Deep Dive

**Hardest problem: preventing oversell under massive concurrent write contention on a single hot-SKU row, without serializing the whole system.**

Three viable strategies, in order of what I'd actually reach for:

1. **Conditional atomic UPDATE (optimistic, DB-enforced)** — the `UPDATE ... WHERE available >= qty` pattern above. This is a single atomic statement; the DB's row lock does the concurrency control for you, no app-level locking needed. This is correct and simple, and for most SKUs (99% of catalog) this is sufficient — pick this by default.

2. **Sharded counters for genuinely hot SKUs** (flash-sale drops): split `on_hand` for one SKU into N sub-counters (e.g., 20 shards of 25 units each) to spread contention across 20 rows instead of 1. Reservation requests hash to a random shard with available stock; this trades a small chance of false "out of stock" near the tail (shard A empty while shard B has 3 left — a background rebalancer fixes this) for dramatically higher throughput, since you're no longer serializing 50,000 requests on one row's lock.

3. **In-memory reservation via Redis `DECRBY` with Lua script** for extreme-hot items, with async write-behind to Postgres for durability: `EVAL "if redis.call('get',KEYS[1]) >= ARGV[1] then return redis.call('decrby',...) else return -1 end"`. Redis single-threaded execution gives atomicity for free and can do 100K+ ops/sec on one key. Risk: a Redis crash before write-behind flushes loses reservations — mitigate with AOF persistence and treating Postgres as the periodic reconciliation source of truth (Redis count must never diverge upward from Postgres, only be a cache of it).

For a PayPal/enterprise interview, the expected answer is #1 as the default, #2 as the "what do you
do for a Taylor Swift ticket drop" follow-up, and a clear statement that **pessimistic row locks
(`SELECT ... FOR UPDATE`) are the wrong first move** — they serialize writers and collapse
throughput under exactly the contention pattern this problem is testing for.

**Second hard problem: reservation expiry reliability.** A reservation whose TTL fires but whose release never executes leaks stock forever. Don't rely solely on a Redis TTL callback (keyspace notifications can be missed on Redis restarts). Use a belt-and-suspenders approach: TTL-based fast path for the common case, plus a periodic sweeper job (`WHERE status='HELD' AND expires_at < now()`) as the guaranteed backstop — the sweeper is the source of truth, the TTL callback is just a latency optimization.

### Scaling the Design
- Shard stock table by `sku_hash` across multiple Postgres instances (or use Citus/Vitess) — inventory reservation is naturally partitionable since a single order rarely touches more than a handful of SKUs, so cross-shard transactions are rare.
- Read replicas for "check availability" browsing traffic, with a short-TTL cache layer in front — browsing tolerates staleness, reservation does not.
- For warehouse routing, pre-compute nearest-N warehouses per postal code region and cache; don't do a live geo-query per request.

### Failure Handling
- DB partition/shard down: fail reservation attempts for affected SKUs fast (503) rather than allowing inconsistent reads to pass validation.
- Sweeper job down: reservations still expire logically (checked via `expires_at` on read), just not proactively cleaned — degrade gracefully, don't corrupt correctness.
- Double-release (network retry): `/release` and `/commit` are idempotent via reservation status checks (`if status != HELD: return 200 no-op`).

### Trade-offs
- Strong consistency (row locks/atomic updates) for stock counts vs. eventual consistency for stock *visibility* in search/browse — deliberately different consistency levels for the same data depending on whether it gates a write (reservation) or just informs a read (browsing "3 left!" badge).
- Sharded counters add complexity and a small false-negative rate near stock exhaustion, only worth it for the small fraction of SKUs that are genuinely hot.

---

## 3. Booking System

### Requirements

**Functional**
- Search availability (hotel rooms / appointment slots) by date range, location, filters
- Hold a slot during checkout, confirm booking on payment, cancel/refund
- Prevent double-booking of the same room/slot for overlapping time ranges

**Non-functional**
- **Zero double-booking tolerance** — this is the core hard problem, harder than e-commerce inventory because bookings are **range-based** (date ranges, time ranges), not simple unit counts
- Search must be fast (<300ms) even though correctness-critical writes are slow/serialized
- Support both hotel-style (N identical rooms of a type) and appointment-style (1 resource, 1 slot) booking models

### Scale/Capacity Estimation
- 10,000 hotels × 100 rooms avg = 1M room inventory units; each room has ~365 date-rows/year of state ≈ 365M rows/year for a naive per-night model (this motivates a range-based model instead, see below)
- Search QPS: 2M searches/day ≈ 23 QPS avg, peak 100 QPS
- Booking writes: 200K bookings/day ≈ 2.3 QPS avg, but concentrated on popular properties/dates (e.g., a popular room type for New Year's Eve) — contention is on (room_type, date_range), not spread randomly
- Appointment booking (dentist, salon): 1 resource can only serve 1 person per slot — contention is per (resource_id, time_slot), typically lower fan-in per row than hotels but same correctness requirement

### API Design

```
GET  /search?location=..&checkin=..&checkout=..&guests=2   -> [{hotel, roomType, price, available}]
POST /holds              { roomTypeId, checkin, checkout, qty } -> {holdId, expiresAt}  (TTL ~10 min)
POST /bookings            { holdId, paymentMethodId, idempotencyKey } -> {bookingId}
POST /bookings/{id}/cancel
GET  /availability/{roomTypeId}?from=..&to=..   -> per-night remaining count
```

### Data Model

The naive "one row per room per night" table works but is enormous and makes range queries
(checkin→checkout overlap) awkward. Two better patterns:

**Option A — Nightly inventory counter (hotel-style, N identical rooms):**
```sql
room_type_inventory(room_type_id, stay_date, total_rooms, booked_count,
                     PRIMARY KEY(room_type_id, stay_date))
```
A booking for `[checkin, checkout)` becomes a range UPDATE across each date in the range, all inside
one transaction: `UPDATE room_type_inventory SET booked_count = booked_count + 1 WHERE
room_type_id=? AND stay_date=ANY(?) AND booked_count < total_rooms` for all dates, checking
`rowcount == num_nights` before committing. This is chosen over exclusion constraints for the hotel
case specifically because "N identical interchangeable rooms" is a *counter* problem per night, not
a range-overlap problem per unit.

**Option B — Exclusion constraint on time ranges (appointment-style, 1 specific resource):**
```sql
CREATE EXTENSION btree_gist;
bookings(booking_id PK, resource_id, time_range TSTZRANGE, status,
         EXCLUDE USING gist (resource_id WITH =, time_range WITH &&) WHERE (status='CONFIRMED'))
```
PostgreSQL's `EXCLUDE` constraint with `btree_gist` **guarantees at the database level** that no two
confirmed bookings for the same `resource_id` can have overlapping `time_range` — this is the single
cleanest technique for double-booking prevention and is exactly the kind of DB-native answer a staff
interview wants to see instead of hand-rolled app-level locking.

DB choice: **PostgreSQL** for both — need ACID transactions, range types, and exclusion constraints;
NoSQL stores generally lack native range-overlap constraints, forcing you to reimplement this logic
(badly) in application code.

### High-Level Design

```
              ┌──────────────┐
   client --> │ Search Svc   │──▶ Elasticsearch (denormalized availability, refreshed async, few sec stale)
              └──────┬───────┘
                      │ user picks a room/slot
                      ▼
              ┌──────────────┐        ┌────────────────────┐
              │  Hold Service │──────▶│ Booking DB (PG)     │
              │ (creates HOLD,│        │ room_type_inventory │
              │  TTL 10 min)  │        │ or exclusion-range  │
              └──────┬───────┘        └─────────┬───────────┘
                     │                            │
                     ▼                            │
              ┌──────────────┐                    │
              │ Payment GW   │                    │
              └──────┬───────┘                    │
                     │ on success                 │
                     ▼                            │
              ┌──────────────┐  commits hold ──────┘
              │ Booking Svc  │  -> status=CONFIRMED
              └──────┬───────┘
                     │ async
                     ▼
              Kafka: booking.confirmed -> notifications, host/property dashboards, search-index refresh
```

**Request flow:** search hits a denormalized, slightly-stale ES index for speed. Selecting a room creates a `HOLD` — a real row/range insert in Postgres with `status=HELD` and a short expiry, which **already occupies the slot** (this is what actually prevents double-booking: the hold itself is enforced by the same constraint as a confirmed booking, just with a TTL and a lower-priority status that a sweeper cleans up). Payment proceeds against the hold; on success the row flips to `CONFIRMED`; on failure/timeout it's released, freeing the slot.

### Deep Dive

**Hardest problem: preventing double-booking under concurrent holds for overlapping ranges, at reasonable latency.**

This is harder than the e-commerce inventory problem because inventory is "N units of a fungible
thing," while a hotel *specific room* or *appointment slot* is a range-overlap check — a naive
`SELECT count(*) WHERE overlaps` followed by an `INSERT` has a classic TOCTOU race: two concurrent
transactions can both read "0 overlapping bookings" before either commits.

Three approaches, and why the third is the one to lead with in an interview:

1. **Pessimistic locking**: `SELECT ... FOR UPDATE` on the resource row before checking overlap and inserting. Correct, but serializes all bookings for that resource — fine for a single appointment resource, bad for a popular hotel room type with lots of concurrent shoppers on different dates (locks the whole room type, not just the contended date).

2. **Optimistic locking with version/counter columns** (Option A above): works well when the entity is a *count*, not a *range* — no true range-overlap semantics needed, just "is capacity left on this specific date."

3. **Database-native exclusion constraints** (Option B, PostgreSQL `EXCLUDE USING gist`): the database itself rejects the second INSERT if it overlaps an existing CONFIRMED/HELD range for the same resource — no race window exists because the constraint check and the insert are atomic at the storage engine level, unlike an app-level check-then-insert. This is the correct answer for single-resource range-based booking (a specific hotel room instance, a doctor's specific slot) and the one that best demonstrates staff-level DB knowledge: **push the invariant into the schema, don't reimplement it in application code with locks that are easy to get subtly wrong** (e.g., forgetting to lock in a consistent order across two resources, causing deadlocks).

For hotels specifically, most real systems use Option A (nightly counters) because rooms of the same
type are interchangeable — you don't care *which* physical room 204 vs 205 the guest gets, just that
count doesn't exceed total. Reach for Option B when the resource is truly a single non-substitutable
unit (one doctor, one court, one specific unique room).

**Second hard problem: hold expiry must be enforced by the same mechanism as confirmation**, otherwise you get "phantom availability" — a hold that logically expired but whose row is still counted as occupied until a sweeper runs. Mitigate with a short TTL (5–10 min, matches typical checkout flow duration) and a sweeper that runs every 30–60s; treat the sweeper as the authority (same pattern as inventory management, Design #2) — any read of "is this slot free" during the pending-expiry gap should treat still-HELD-but-past-expiry rows as free (`WHERE status='HELD' AND expires_at > now()`).

### Scaling the Design
- Search: fully denormalized, cached, eventually-consistent ES index refreshed from booking events every few seconds — never query the transactional Postgres DB for search-path availability.
- Write path: shard Postgres by `hotel_id` or `resource_id` — a booking transaction never needs to span more than one property/resource, so this partitions cleanly with no cross-shard transactions.
- Popular-date hot spots (New Year's Eve at a specific hotel) get the same "reduce contention window" treatment as Design #2 — short hold TTLs and queuing excess demand rather than lock pile-ups.

### Failure Handling
- Payment succeeds but hold-to-confirm transition fails: reconciliation sweep on "captured payments with a still-HELD hold" (identical pattern to e-commerce checkout saga).
- Search index lag causes a user to see availability that's actually gone: hold creation is the real gate — a failed hold attempt returns "sorry, just booked" gracefully, which is an acceptable and expected UX for any booking system (airlines/hotels all have this).
- Double-submit from client retry: idempotency key on `POST /bookings` prevents duplicate confirmed bookings from the same hold.

### Trade-offs
- Nightly-counter model (fast, simple, works for fungible room types) vs. exclusion-constraint model (handles true 1:1 range-overlap correctly, more expensive per-write due to GiST index maintenance) — pick per resource type, not globally.
- Short hold TTL (less phantom-unavailability risk, but users lose their cart faster) vs. long TTL (better UX, more contention/perceived unavailability for popular slots) — 10 minutes is the typical industry balance.

---

## 4. Food Delivery

### Requirements

**Functional**
- Customer: browse restaurants/menus, place order, track delivery in real time
- Restaurant: receive orders, accept/reject, mark ready
- Delivery partner: receive delivery offers, navigate, update location, mark delivered
- Matching: assign the right delivery partner to the right order considering distance, restaurant prep time, partner availability

**Non-functional**
- Real-time location tracking: sub-5-second update latency for the tracking map
- Matching must be fast (<2s decision) and reasonably fair/efficient (not always the same partner)
- Three-sided consistency: order state must be visible consistently to customer, restaurant, and partner apps
- High availability during meal-time peaks (lunch/dinner spikes, 5-10x baseline)

### Scale/Capacity Estimation
- 5M orders/day concentrated in ~6 peak hours (lunch+dinner) → avg 230 orders/sec during peaks, ~15/sec off-peak
- Active delivery partners during peak: 500K, each sending location pings every 5s → 100K location-update writes/sec system-wide
- Matching decisions: 230/sec at peak, each considering ~20-50 nearby candidate partners
- Order lifecycle events (placed→accepted→preparing→ready→picked-up→delivered): ~7 state transitions × 5M orders/day = 35M events/day

### API Design

```
POST /orders                       { restaurantId, items, addressId } -> {orderId}
GET  /orders/{orderId}/status
PUT  /restaurants/{id}/orders/{orderId}/accept
PUT  /restaurants/{id}/orders/{orderId}/ready
POST /partners/{id}/location        { lat, lng, ts }         (high-frequency, via WebSocket/gRPC stream ideally)
POST /matching/offers/{offerId}/accept   (partner accepts a delivery offer)
GET  /orders/{orderId}/tracking     -> {partnerLat, partnerLng, etaSeconds}   (or WebSocket subscribe)
```

### Data Model

| Store | Entity | Why |
|---|---|---|
| PostgreSQL | `orders`, `order_items`, `restaurants`, `menu_items` | Transactional order lifecycle, needs consistency |
| Redis Geo (or dedicated geo-index) | `partner_locations` — `GEOADD partners lng lat partnerId`, TTL-refreshed each ping | Sub-second nearest-partner queries, ephemeral data, doesn't need durability beyond "last known position" |
| Kafka | `order.state_changed`, `partner.location_updated` topics | Fan-out to customer/restaurant/partner apps and to the matching service without tight coupling |
| Cassandra/DynamoDB | `delivery_tracking_history` (append-only pings, time-series) | High write volume, no need for complex queries, TTL-expire old pings |

```sql
orders(order_id PK, customer_id, restaurant_id, partner_id NULL, status, created_at)
order_status_history(order_id, status, ts)   -- append-only audit trail
```

### High-Level Design

```
Customer App        Restaurant App          Partner App
     │                    │                       │
     └──────┬─────────────┴───────────┬───────────┘
            ▼                         ▼
       ┌─────────┐              ┌───────────┐
       │ Order Svc│─────────────▶│ Kafka:     │
       │ (PG)     │  events      │ order.*    │
       └────┬─────┘              └─────┬──────┘
            │                          │ fan-out
            │ order confirmed          ▼
            ▼                   ┌─────────────────┐
     ┌──────────────┐           │ Notification Svc │──▶ push to all 3 apps
     │ Matching Svc  │           └─────────────────┘
     │  (geo query)  │
     └──────┬────────┘
            │ GEOSEARCH nearby partners
            ▼
     ┌──────────────┐
     │ Redis Geo     │◀── partners stream location every 5s via
     │ (partner locs)│    WebSocket gateway (persistent conn, sticky LB)
     └──────────────┘
            │ offer sent to top-K candidates
            ▼
     Partner accepts -> Matching Svc locks assignment -> Order Svc updates status
                                                              │
                                                              ▼
                                                    Tracking Svc streams
                                                    partner location to
                                                    customer via WebSocket
```

**Request flow:** customer places order → Order Service persists it, emits `order.placed` → restaurant accepts (or auto-accepts based on their settings) → prep begins → shortly before food is ready, Matching Service queries Redis Geo for nearby available partners within a radius, ranks by ETA (distance + current load), and sends offers to the top few candidates (first to accept wins, others' offers expire) → assigned partner's app starts streaming location → customer's tracking view subscribes via WebSocket to a filtered stream of that partner's position → delivery completion transitions order to `DELIVERED`, closing the loop with rating/payment capture.

### Deep Dive

**Hardest problem: real-time, efficient matching of delivery partners to orders at scale, balancing customer wait time, partner earnings fairness, and system throughput.**

Key design decisions:
- **Geo-indexing**: use **geohash** or **H3** (Uber's hexagonal hierarchical index) rather than a naive lat/lng scan. Geohash buckets nearby coordinates into shared string prefixes, so "find partners near me" becomes a prefix range query instead of a full scan; H3 additionally gives uniform-area hexagonal cells (geohash cells are non-uniform rectangles that distort near poles and at boundaries), which matters when you're bucketing by "how many minutes away," not just raw distance. Redis's native `GEOADD`/`GEOSEARCH` uses geohash internally and is sufficient for most interviews; mention H3 as the more sophisticated alternative used by Uber/Lyft-scale systems, particularly for surge-zone definition (see Design #5).
- **Batching over greedy assignment**: naive "assign nearest available partner the instant an order is ready" is greedy and can be globally suboptimal (assigns a nearby partner to a far order when a slightly-farther partner would have been better for the *system* considering all pending orders). At scale, batch unassigned orders every 5-10 seconds and solve a small bipartite matching / assignment problem (Hungarian algorithm or a simpler greedy-by-score heuristic for latency reasons) over the batch, rather than matching one order at a time. This is the same idea as ride-sharing dispatch (Design #5) and is worth naming explicitly — interviewers want to hear "batch matching beats greedy at scale" as a concrete insight, not just "find nearest driver."
- **Offer expiry and fallback**: send offer to top-3 candidates simultaneously with a 15s accept window (not sequential — sequential is too slow and loses partners to boredom/other apps); first accept wins, others get "offer taken." If nobody accepts, widen the radius and retry.

**Second hard problem: real-time location tracking at 100K writes/sec without melting the DB.**
Location pings are high-volume but low-value individually and highly perishable (only the latest
matters for live tracking) — this is the textbook case for **not** writing every ping to a durable
relational store. Approach: partner app streams location over a persistent WebSocket/gRPC connection
to a location gateway; gateway writes only the *latest* position to Redis (in-memory, ephemeral,
overwrite-in-place, no history needed for live tracking) and asynchronously batches pings to a time-
series-friendly store (Cassandra/S3) for analytics/ETA-model training, decoupled from the live-
tracking hot path entirely.

### Scaling the Design
- Partition Redis Geo by city/region — a "nearby partners" query never needs to span cities, so this shards cleanly with no cross-shard queries.
- WebSocket connections: use a dedicated connection-gateway tier (e.g., a fleet of stateful gateway nodes with sticky routing) separate from stateless business logic services, since long-lived connections don't horizontally scale the same way as stateless HTTP.
- Matching service scales horizontally per-region since matching decisions are geographically local.

### Failure Handling
- Partner app loses connectivity mid-delivery: order doesn't get stuck — a timeout on "no location update for N minutes" triggers a support/reassignment flow rather than leaving the customer with a frozen map forever.
- Matching service can't find any partner within radius: escalate radius progressively, and after a max threshold, surface "no partners available" to the restaurant/customer rather than hanging.
- Restaurant fails to accept within SLA: auto-cancel with refund flow (see Design #10), notify customer proactively rather than silent timeout.

### Trade-offs
- Batch matching (better global efficiency, adds latency of the batch window) vs. greedy real-time matching (instant, locally suboptimal) — batch wins at scale, greedy is fine for low-density markets/off-peak.
- Redis-only location store (fast, simple, no history) plus async time-series sink (adds a pipeline) vs. writing every ping straight to a durable DB (simpler pipeline, doesn't scale to 100K writes/sec affordably) — the split is worth the added component.

---

## 5. Ride Sharing

### Requirements

**Functional**
- Rider requests a ride (pickup, destination), gets matched to a nearby driver
- Real-time location tracking for both rider and driver during the trip
- Dynamic (surge) pricing based on supply/demand imbalance
- Trip lifecycle: requested → matched → driver en route → in progress → completed → paid

**Non-functional**
- Matching latency: <3-5 seconds from request to driver assignment
- Location freshness: driver positions updated every 2-4 seconds
- Surge pricing recalculated frequently (every 1-2 min) per geographic zone, must be visible to riders *before* they confirm the ride (no bait-and-switch)
- Must handle extreme regional demand spikes (concerts, weather events) without falling over

### Scale/Capacity Estimation
- 10M rides/day globally, concentrated in metro areas and peak commute hours → peak ~2,000-5,000 ride requests/sec across all cities combined, but each city is an independent geo-partition so per-city peak is much lower (a mid-size city might peak at 50-100 req/sec)
- Active drivers during peak: 1M, location ping every 3s → ~330K location writes/sec system-wide
- Surge computation: recalculate per H3 hex cell (roughly city-block to neighborhood granularity) every 60-90s; a large city might have ~5,000 hex cells at the chosen resolution
- Matching: each request evaluates candidate drivers within an expanding radius, typically 20-100 candidates

### API Design

```
POST /rides/requests          { pickup:{lat,lng}, destination:{lat,lng} } -> {rideId, estimatedFare, surgeMultiplier}
POST /rides/{id}/confirm       { paymentMethodId }
GET  /rides/{id}/status
POST /drivers/{id}/location     { lat, lng, ts, heading }   (streamed)
POST /drivers/{id}/availability { status: ONLINE|OFFLINE }
PUT  /rides/{id}/driver-arrived
PUT  /rides/{id}/start
PUT  /rides/{id}/complete       -> triggers fare finalization + payment capture
```

### Data Model

| Store | Entity | Why |
|---|---|---|
| Redis Geo / H3-indexed in-memory store | driver live positions, keyed by hex cell | Sub-second nearest-driver queries at massive write volume |
| PostgreSQL (sharded by city_id) | `rides`, `fares`, `drivers`, `riders` | Transactional trip lifecycle, needs ACID for fare finalization + payment linkage |
| Redis (per hex cell) | `surge:{hexId} -> multiplier`, recalculated periodically | Fast read on the hot path (every ride request reads current surge), write-seldom |
| Kafka | `ride.requested`, `driver.location`, `ride.completed` | Decouples matching, tracking, surge computation, and billing consumers |
| Cassandra/S3 | historical trip + location data | Analytics, ML training (ETA models, surge models), not on the request hot path |

```sql
rides(ride_id PK, rider_id, driver_id NULL, pickup_geo, dest_geo, status,
      requested_fare_cents, surge_multiplier, final_fare_cents, created_at)
```

### High-Level Design

```
Rider App                                        Driver App
    │  POST /rides/requests                           │ location stream (every 3s)
    ▼                                                  ▼
┌───────────────┐                             ┌─────────────────┐
│  Ride Service  │                             │ Location Gateway │
│ (reads surge,  │                             │ (WebSocket/gRPC) │
│  creates ride) │                             └────────┬─────────┘
└──────┬─────────┘                                      │
       │ query nearby drivers                           ▼
       ▼                                          ┌──────────────┐
┌───────────────┐                                │ Geo Index     │
│ Matching Svc   │◀───────────────────────────────│ (H3 cells,    │
│ (batch every   │      GEOSEARCH / H3 kRing      │  Redis)       │
│  ~2-4s window) │                                └──────────────┘
└──────┬─────────┘
       │ dispatch offer to best-ranked driver(s)
       ▼
  Driver accepts -> Ride Service updates status -> both apps notified via push/WebSocket
       │
       ▼
┌────────────────────┐         ┌──────────────────────┐
│ Surge Pricing Svc    │◀──────│ Kafka: ride.requested, │
│ (streaming aggregate,│        │ driver.availability   │
│  per H3 cell, ~90s   │        └──────────────────────┘
│  windows)             │
└──────────────────────┘
       │ writes multiplier per cell
       ▼
   Redis: surge:{hexId}
```

**Request flow:** rider requests a ride → Ride Service looks up current surge multiplier for the rider's H3 cell (cheap Redis read) → returns an upfront quoted fare including surge, rider confirms → Matching Service finds nearby available drivers using H3 k-ring expansion (start at the rider's cell, expand outward ring by ring until enough candidates found) → dispatches to the best candidate(s) by a scoring function (distance, driver rating, acceptance likelihood) → on acceptance, both apps get real-time updates → location streaming continues throughout the trip for live tracking → on completion, fare is finalized (actual route/time may differ from estimate) and payment is captured (hands off to Payment Processor, Design #7).

### Deep Dive

**Hardest problem #1: geo-indexing for sub-second nearest-driver queries at massive scale, with a granularity that supports both matching AND surge pricing consistently.**

This is why **H3** (or a similar hierarchical hex grid) is the answer of choice over plain geohash
for ride-sharing specifically, more so than for food delivery: ride-sharing needs the *same* spatial
partitioning scheme for two different purposes — nearest-driver search (fine granularity, small
cells) and surge-zone definition (coarser granularity, cells should roughly correspond to "a
neighborhood," and be fairly uniform in area so surge feels geographically fair rather than
arbitrary along cell boundaries). H3 supports this natively via its **resolution hierarchy**: use
resolution 9 (~0.1 km² cells) for driver-matching k-ring searches, and aggregate up to resolution 7
(~5 km² cells) for surge computation, using the same underlying index — you don't maintain two
separate geo systems. Geohash can be made to work but its rectangular, latitude-distorted cells make
"uniform neighborhood size" harder to reason about, which is exactly why Uber built H3 in the first
place — worth saying this explicitly in an interview to show you know *why* H3 exists, not just its
name.

Matching mechanics: given a rider's H3 cell at resolution 9, do a `kRing(cell, k=1)` (7 cells:
center + 6 neighbors) to find candidate drivers; if too few, expand `k=2`, `k=3`. Score candidates
by a weighted function of `(ETA to pickup, driver rating, driver's current trip-completion streak)`
rather than pure distance — pure-nearest can create a "always the same unlucky driver gets short
trips" fairness problem at the fleet level, which is a real production concern worth naming.

**Hardest problem #2: surge pricing — computing it correctly, updating it frequently without flapping, and guaranteeing the rider sees the actual price they'll be charged.**

Surge multiplier per H3 cell ≈ f(active ride requests in cell over last N min, available idle
drivers in cell) — a live supply/demand ratio, computed as a streaming aggregation (Kafka Streams /
Flink windowed job) over `ride.requested` and `driver.availability` events, written to Redis every
60-90s. Two correctness requirements that matter more than the pricing formula itself:

- **Price lock-in**: once a rider is quoted a surge-inclusive fare and confirms within a short window (e.g., 60s), that exact multiplier is pinned to the ride record at request time — recalculating surge mid-negotiation and charging a *different* number than what was shown is both a terrible UX and, for a fintech-adjacent interview, exactly the kind of "silent bait-and-switch" correctness bug an interviewer is probing for. Store `surge_multiplier` denormalized onto the `rides` row at creation time; never re-derive it from the live surge table at billing time.
- **Smoothing to prevent flapping**: naive per-window recompute can oscillate (surge spikes 3x for one minute because 5 ride requests landed in a small cell, then drops) which erodes rider trust. Apply an exponential moving average across windows and cap the rate of change per update cycle (e.g., max ±0.2x per recompute) rather than jumping straight to the raw instantaneous ratio.

### Scaling the Design
- Everything is geo-partitioned: shard Postgres, Redis, and Kafka topics by `city_id` (or a coarser geo-region) — a ride, its matching, and its surge computation never cross city boundaries, making this an unusually clean horizontal-scaling story compared to most systems in this document.
- Location ping ingestion follows the same "don't persist every ping durably on the hot path" pattern as food delivery: Redis for live position, async sink to Cassandra/S3 for history/ML.
- During extreme regional spikes (concerts letting out, severe weather), surge pricing is also the *scaling* mechanism — it throttles demand and pulls in supply from adjacent cells, which is a legitimate answer to "how do you handle a 20x demand spike in one neighborhood" beyond pure infrastructure scaling.

### Failure Handling
- Matching service can't find a driver even after max k-ring expansion: return "no drivers available" rather than an infinite/slow search; log the demand-supply gap for surge/incentive systems to react to.
- Driver disconnects mid-trip: location gateway detects missed heartbeats, flags the ride for the rider ("we've lost your driver's signal, support has been notified") rather than freezing silently.
- Surge computation pipeline lags/fails: fall back to the last known good multiplier per cell (cached with a max staleness), never fail open to "no surge" (undercharges, revenue-incorrect) or hard-fail the ride request (availability regression) — degrade to stale-but-safe.

### Trade-offs
- H3 hierarchical indexing (more setup complexity, unifies matching + surge geo systems) vs. plain geohash (simpler, adequate for matching alone, awkward for uniform surge zones) — H3 wins once surge pricing is in scope.
- Pinning surge at quote time (protects rider trust, means the platform occasionally "loses" a bit of margin if true demand spiked between quote and confirm) vs. re-pricing at confirm time (protects margin, risks trust/bait-and-switch perception) — pin it; the trust cost of the alternative is asymmetric and expensive to earn back.

---

## 6. Payment Gateway

> **Gateway vs. Processor, stated plainly (this distinction gets asked directly):** a **payment
gateway** is the merchant-facing front door — it captures card/payment details securely (often via a
hosted field or SDK so the merchant's servers never touch raw PANs), tokenizes them, performs basic
fraud/format checks, and *routes* the transaction onward. A **payment processor** (Design #7) is the
back-end engine that actually talks to card networks/banks and moves money.
Stripe/Braintree/PayPal's own checkout are gateways; Visa/Mastercard's network plus the acquiring
bank relationship is the processing layer underneath. A gateway can sit in front of multiple
processors and choose which one to route to (for cost, reliability, or geographic reasons) — that
routing flexibility is a big part of a gateway's value.

### Requirements

**Functional**
- Merchant integrates via SDK/API to collect payment details without touching raw card data (PCI scope reduction)
- Tokenize card/payment method for reuse (saved cards, subscriptions)
- Route transaction to an appropriate processor/acquirer
- Return a clear authorization result (approved/declined/error) synchronously to the merchant's checkout flow
- Support multiple payment methods (card, bank transfer, wallet) behind one API

**Non-functional**
- **PCI-DSS**: gateway must never let raw PAN (card number) touch the merchant's servers or unencrypted storage; use hosted fields/iframes or client-side tokenization so the PAN goes directly from the customer's browser to the gateway's PCI-compliant environment
- Latency: authorization must return in <2-3s p99 (checkout abandonment rises sharply beyond this)
- Idempotency: retried authorization requests must never double-charge
- High availability: gateway downtime = merchant can't take payments — target 99.99%
- Auditability: every transaction attempt logged immutably for disputes/compliance

### Scale/Capacity Estimation
- Assume gateway serving many merchants: 50M transactions/day ≈ 580 TPS avg, peak (holiday shopping) 10x ≈ 5,800 TPS
- Tokenization requests roughly match transaction volume for new cards, much less for saved-card reuse: ~10M new tokenizations/day ≈ 115 TPS avg
- Processor round-trip latency: typically 200ms-1.5s depending on network/issuer
- Data retention: transaction records must be retained 7 years typically for compliance — 50M/day × 2KB × 365 × 7 ≈ 250TB (cold storage tier)

### API Design

```
POST /v1/tokens                { cardNumber, exp, cvv }  -- via hosted field / client-side only, never merchant server
                                -> { token: "tok_xxx" }   (PAN never touches merchant backend)
POST /v1/charges                { amount, currency, token, idempotencyKey, merchantId }
                                -> { chargeId, status: authorized|declined, processorRef }
POST /v1/charges/{id}/capture   { idempotencyKey }
POST /v1/charges/{id}/void
GET  /v1/charges/{id}
POST /v1/webhooks/subscribe     { merchantId, url, events:[...] }   -- async status updates to merchant
```
Note the split: `charges` create an **authorization** (funds held, not moved); a separate `capture`
call actually moves money — this two-step pattern is standard and matters a lot for the
refund/reconciliation designs later.

### Data Model

```sql
tokens(token_id PK, encrypted_card_ref, card_bin, last4, exp_month, exp_year, merchant_id, created_at)
-- actual PAN lives only in a PCI-scoped vault (HSM-backed), tokens table stores a reference, never the PAN itself

charges(charge_id PK, merchant_id, token_id, amount_cents, currency, status,
        idempotency_key UNIQUE, processor_id, processor_ref, created_at, updated_at)

charge_events(event_id PK, charge_id FK, event_type, payload_jsonb, created_at)  -- append-only audit trail
```
DB choice: **PostgreSQL** for `charges`/`tokens` — needs the `idempotency_key UNIQUE` constraint
enforced transactionally (this is *the* mechanism preventing double-charges, not an app-level check
which has a race window). `charge_events` can live in the same DB or a separate append-only store
(Kafka + cold storage) since it's write-heavy and read-rarely (only for disputes/audits).

**Card vault**: raw PAN, if stored at all (many gateways don't store it themselves and instead rely on the processor/network token vaults), sits in a separate, minimally-scoped, HSM-encrypted vault service — isolating PCI scope to one small service rather than the whole platform is the entire point of tokenization architecturally, not just a compliance checkbox.

### High-Level Design

```
Customer Browser
      │  (card details entered into hosted iframe served by Gateway, NOT merchant's page)
      ▼
┌─────────────────────┐
│ Tokenization Service │──▶ Card Vault (HSM-encrypted, PCI-scoped, isolated network segment)
└──────────┬───────────┘
           │ returns token to merchant's page (safe to handle)
           ▼
   Merchant Server ──POST /v1/charges (token, amount, idempotencyKey)──▶
                                                                        ▼
                                                            ┌────────────────────┐
                                                            │  Gateway API (LB)   │
                                                            └─────────┬──────────┘
                                                                      ▼
                                                            ┌────────────────────┐
                                                            │  Charge Service     │── idempotency check (DB unique constraint)
                                                            │  (stateless)        │── fraud pre-check (Design #12, sync, fast)
                                                            └─────────┬──────────┘
                                                                      ▼
                                                            ┌────────────────────┐
                                                            │  Routing Engine     │── picks processor (cost/reliability/geo)
                                                            └────┬───────┬───────┘
                                                     ┌───────────┘       └───────────┐
                                              ┌──────▼──────┐              ┌────────▼───────┐
                                              │ Processor A  │              │  Processor B    │──▶ (Design #7)
                                              │ (e.g. Visa   │              │  (e.g. ACH/bank) │
                                              │  network)    │              └────────────────┘
                                              └──────────────┘
                                                      │
                                                      ▼ result
                                          Charge Service persists status,
                                          returns to merchant synchronously,
                                          also emits webhook async
```

**Request flow:** customer's card details are captured by a hosted field the gateway serves (so they never transit the merchant's own JS/servers) → tokenized immediately, raw PAN goes straight to the vault → merchant's backend receives only the token, calls `/v1/charges` with an idempotency key → Charge Service checks the idempotency key against the DB unique constraint (if a charge with this key already exists, return its existing result instead of processing again — this is the double-charge guard) → runs a fast synchronous fraud pre-check → Routing Engine selects a processor based on cost, historical success rate, and currency/geography support → processor call executes the actual authorization → result persisted and returned synchronously to the merchant, with a webhook fired for any later async status changes (e.g., a delayed decline).

### Deep Dive

**Hardest problem: keeping raw cardholder data (PAN) out of the merchant's PCI scope while still giving the merchant a fast, flexible checkout experience — this is what "PCI-DSS awareness" concretely means architecturally, not a compliance checklist.**

The mechanism is **tokenization + iframe/hosted-field isolation**:
- The merchant embeds an iframe or SDK-rendered field owned by the gateway; the DOM/network boundary means the merchant's JavaScript literally cannot read the card number even if compromised (a huge reduction in blast radius vs. the merchant's own form posting raw PAN to their own server).
- On submit, the PAN goes directly from the customer's browser to the gateway's PCI-compliant infrastructure, which returns an opaque token.
- The merchant's server only ever sees and stores the token — a value useless outside the gateway's own system, meaningless to an attacker who breaches the merchant.
- This is why a data breach at a merchant using proper tokenization is a much smaller incident than a breach at a merchant who — against PCI rules — captures raw PANs on their own servers.

A second, complementary layer: **network tokenization** (EMVCo tokens issued by the card networks
themselves, e.g., Visa Token Service) — the gateway can further exchange its own token for a network
token before routing to the processor, which also improves auth rates (issuers trust network tokens
more) and allows card-on-file updates without the merchant re-collecting card details when a card is
reissued (token continuity).

**Second hard problem: idempotent authorization under network uncertainty.** A merchant's `POST /v1/charges` call can time out on their end while the gateway actually succeeded — the merchant doesn't know if it worked. Naive retry double-charges. Fix: `idempotency_key` (client-generated UUID, unique per logical attempt) is required on every charge request; the DB enforces uniqueness transactionally, and a retried request with the same key returns the *original* result (whatever it was — approved, declined, or still-processing) rather than re-executing. Critically, the idempotency check and the charge-record insert must happen in the same transaction, not as a separate "check then insert" pair, or you reintroduce the exact race you're trying to close.

### Scaling the Design
- Charge Service is stateless, horizontally scaled behind the LB; the DB (idempotency enforcement) is the constraint — shard by `merchant_id` since a merchant's charges never need cross-merchant transactions.
- Routing Engine can cache processor health/success-rate stats in-memory (refreshed every few seconds) to make routing decisions without a synchronous health-check call per transaction.
- Tokenization Service and Card Vault are deliberately kept as a small, separately-scaled, separately-secured tier — PCI audit scope should map to the smallest possible set of services.

### Failure Handling
- Processor timeout/unknown result: **never treat "no response" as "declined."** Query the processor's status endpoint before deciding, and if truly unknown, hold the charge in `PENDING` and reconcile async (see Design #11) rather than guessing — guessing wrong in either direction is either a lost sale or a double-charge risk.
- One processor down: routing engine fails over to a secondary processor automatically for new transactions (in-flight ones with the down processor go to `PENDING`/reconciliation, not silently resubmitted to a different processor — that could double-charge).
- Fraud pre-check service down: fail toward the safer default per merchant risk tolerance — typically allow with lower confidence and flag for async review, rather than blocking all checkout traffic gateway-wide on one dependency.

### Trade-offs
- Hosted-field tokenization (best PCI posture, slightly more integration friction for merchants, less checkout UI customization) vs. merchant collecting card data directly (more flexible UI, merchant absorbs full PCI-DSS Level 1 scope — expensive and risky) — nearly every gateway pushes merchants toward hosted fields for exactly this reason.
- Synchronous fraud pre-check (adds latency to every checkout) vs. fully async fraud scoring (faster checkout, risk of approving a fraudulent transaction before the async score comes back) — see Design #12 for the full sync/async trade-off discussion; gateways typically do a fast synchronous rules-based check plus async ML scoring for the harder cases.

---

## 7. Payment Processor

### Requirements

**Functional**
- Execute the actual authorization, capture, and settlement of funds between payer and payee accounts, interfacing with card networks/bank rails (ACH, SWIFT, card networks)
- Support multi-step money movement: authorize (hold funds) → capture (move funds) → settle (batch funds transfer to merchant's bank, typically T+1/T+2)
- Handle multiple rails (cards via networks, ACH, wire, real-time payment rails) behind a consistent internal interface
- Provide settlement reports/reconciliation data to gateways and merchants

**Non-functional**
- **Correctness is non-negotiable**: no lost transactions, no double-moves of money, every state transition auditable
- Every operation idempotent — this is the most important non-functional requirement in the entire document, because at this layer a retried request that isn't idempotent literally moves money twice
- Durability: transaction records must survive any single failure (multi-AZ/region persistence)
- Latency: authorization <1-2s to the gateway; settlement is inherently batch/async (hours, not seconds)

### Scale/Capacity Estimation
- Processing 50M transactions/day (same volume as the gateway sitting on top of it) ≈ 580 TPS avg, 5,800 TPS peak
- Settlement batches: typically run per merchant per day (T+1) — 50M transactions batched into settlement files, grouped by acquiring bank/merchant, each batch might contain thousands to millions of line items
- State transitions per transaction: authorize, capture, settle, (possibly) refund, (possibly) chargeback ≈ 3-5 events × 50M/day = 150-250M ledger events/day
- Storage: full transaction + ledger history retained 7+ years for regulatory reasons

### API Design (internal — called by the gateway, not exposed to merchants directly)

```
POST /internal/authorize   { amount, currency, paymentMethodRef, merchantAccountId, idempotencyKey }
                            -> { authId, status, networkResponseCode }
POST /internal/capture     { authId, amount, idempotencyKey }         (amount can be <= authorized amount)
POST /internal/void        { authId, idempotencyKey }
POST /internal/refund      { captureId, amount, idempotencyKey }      -> hands off details to Design #10
GET  /internal/transactions/{id}
POST /internal/settlement/runs                                        (scheduled, not client-triggered)
```

### Data Model

This is where the **ledger** (Design #9) becomes load-bearing rather than optional — a processor's
core data model *is* a ledger.

```sql
transactions(txn_id PK, merchant_account_id, amount_cents, currency, status
             ENUM(AUTHORIZED,CAPTURED,SETTLED,VOIDED,REFUNDED,FAILED),
             idempotency_key UNIQUE, rail ENUM(CARD,ACH,WIRE), created_at, updated_at)

ledger_entries(entry_id PK, txn_id FK, account_id, direction ENUM(DEBIT,CREDIT),
               amount_cents, currency, created_at)
-- every txn produces at least 2 balanced ledger_entries (double-entry, see Design #9 for full depth)

settlement_batches(batch_id PK, merchant_account_id, period_start, period_end, total_amount_cents, status)
settlement_batch_items(batch_id FK, txn_id FK)
```
DB choice: **PostgreSQL/relational** — this layer's entire value proposition is ACID correctness for
money movement; a document store or eventually-consistent store is actively wrong here. Horizontal
scale is achieved by sharding (by `merchant_account_id` or region), not by relaxing consistency.

### High-Level Design

```
                    Gateway (Design #6)
                          │ authorize/capture calls (idempotency key required)
                          ▼
                ┌───────────────────┐
                │  Processor API     │  (stateless, validates idempotency key against DB)
                └─────────┬─────────┘
                          ▼
                ┌───────────────────┐
                │  Transaction Svc   │── writes transactions + ledger_entries in ONE DB transaction
                └─────────┬─────────┘
              ┌───────────┼────────────┐
       ┌──────▼─────┐ ┌───▼──────┐ ┌───▼──────────┐
       │ Card Network│ │  ACH Rail │ │ Wire/RTP Rail │   (external, outside our control)
       │ (Visa/MC)   │ │ (NACHA)   │ │               │
       └──────┬─────┘ └───┬──────┘ └───┬───────────┘
              └────────────┼────────────┘
                           ▼ async response (network can be slow/queued, esp. ACH which is batch-based)
                ┌───────────────────┐
                │ Response Handler   │── updates transaction status, emits event
                └─────────┬─────────┘
                          ▼
                Kafka: txn.authorized / txn.captured / txn.settled
                          │
               ┌──────────┼───────────┐
        ┌──────▼─────┐ ┌──▼────────┐ ┌▼─────────────┐
        │ Gateway     │ │ Ledger Svc │ │ Reconciliation│──▶ (Design #11)
        │ webhook     │ │ (Design #9)│ │   Service     │
        └────────────┘ └───────────┘ └───────────────┘

Nightly:
        ┌───────────────────┐
        │ Settlement Job     │── batches captured txns by merchant/bank, generates settlement file,
        │ (scheduled batch)  │   submits to acquiring bank, produces settlement_batches records
        └───────────────────┘
```

**Request flow (authorize→capture→settle):** gateway calls `/authorize` with an idempotency key → Transaction Service checks the key (DB unique constraint, same pattern as the gateway layer, but now this is the *actual* money-moving system, so this check is the single most important line of code in the whole platform) → on a new key, writes a `transactions` row as `AUTHORIZED` plus balanced ledger entries (a hold, not yet a real fund movement) inside one DB transaction → forwards the authorization to the appropriate rail (card network, ACH, etc.) → rail responds (sometimes synchronously in ~1s for cards, sometimes async/batched for ACH which can take hours) → Response Handler updates status and emits events. Later, `/capture` is called (often immediately after authorize for e-commerce, or after a delay for e.g. hotel checkout) which actually commits the fund movement — this updates the ledger entries from a "hold" state to a "settled debit/credit" and triggers eventual settlement. Overnight, a batch job groups all captured-but-unsettled transactions per merchant and generates a settlement file to move actual funds to the merchant's bank account (T+1/T+2 typical).

### Deep Dive

**Hardest problem: guaranteeing exactly-once money movement across a request path that includes at least one slow, sometimes-unreliable external network hop (the card network/bank rail) that you don't control and can't easily query for "did this actually happen."**

This is fundamentally the same idempotency problem as the gateway layer, but harder, because:
1. The external rail may itself be slow/async (ACH settlement can take 1-3 business days; even card auth can occasionally time out at the network level).
2. A retry at this layer, done wrong, moves real money — there's no "just show the user an error and let them retry" luxury the way there is at checkout.

The concrete mechanism:
- **Idempotency key stored with the request, checked transactionally before any external call is made.** If the processor crashes *after* calling the card network but *before* recording the response, a retry with the same key must not call the network again — it must instead check "did I already send this authorization" and, if uncertain, **query the network/rail for the status of that specific reference** rather than blindly resubmitting. This is why processors always generate and store their own outbound reference ID *before* making the external call, so a crash-recovery path has something to query against.
- **State machine with a `PENDING`/`IN_FLIGHT` intermediate status**, not just `SUCCESS`/`FAILURE`: a transaction that crashed mid-flight sits in `IN_FLIGHT` until a recovery job resolves it by querying the rail — this is the processor-layer equivalent of the "reconciliation sweep" pattern that shows up in every fintech design in this document (checkout saga, inventory reservation, booking holds — it's the same idea every time: **never let ambiguous external state resolve itself via blind retry; always resolve it by querying the source of truth and reconciling**).
- **Two-phase authorize/capture split is itself a correctness tool, not just a UX feature**: separating "hold funds" from "move funds" gives you a safe point to retry the *capture* idempotently without ever risking a double *authorization* against the customer's available credit, and gives merchants (hotels, e-commerce with delayed shipping) the ability to adjust or cancel before funds actually move.

**Second hard problem: settlement batching correctness** — every captured transaction must appear in exactly one settlement batch, with the batch total reconciling exactly to the sum of its line items (this sounds trivial; at 50M transactions/day with retries, partial failures, and multi-currency rounding, it is not). Mitigate with: settlement batch generation as an idempotent, resumable job keyed by `(merchant_account_id, period)`, a unique constraint preventing a transaction from being included in two batches, and an explicit reconciliation step (Design #11) comparing the batch total against the sum of debits/credits in the ledger before the file is submitted to the bank.

### Scaling the Design
- Shard by `merchant_account_id` — transactions rarely need cross-merchant consistency (a payment moves funds between one payer and one merchant's account, not across merchants), so this partitions the transactional hot path cleanly.
- Settlement batch generation can be parallelized per merchant/shard, then aggregated for reporting.
- Read replicas for reporting/reconciliation queries so they never compete with the transactional hot path for DB resources.

### Failure Handling
- Rail timeout with unknown outcome: `IN_FLIGHT` status + recovery job that queries the rail's status API — never guess.
- Partial settlement batch failure (bank rejects some line items): batch job must support partial success with per-item status, not all-or-nothing rollback of a million-item batch.
- Processor DB failover: multi-AZ synchronous replication for the transactional core (accept the latency cost) — this is one of the few places in the whole document where "eventual consistency is fine" is the wrong answer; a lost or duplicated write here is a real money incident, not a UX blemish.

### Trade-offs
- Synchronous authorize (fast feedback to checkout, but couples checkout latency to card-network latency) vs. fully async authorize-with-webhook (decouples latency, worse checkout UX for the ~1-2s case, though most gateways still want the sync path for the common case and reserve async purely for slow rails like ACH).
- Strong consistency/synchronous replication for the transactional core (higher latency, higher infra cost) vs. eventual consistency (cheaper, faster) — money-movement correctness wins this trade-off unconditionally; this is the one system in the whole document where you should actively push back if an interviewer suggests relaxing consistency "for scale."

---

## 8. Wallet

### Requirements

**Functional**
- Maintain a balance per user (and per currency, if multi-currency)
- Support deposit (top-up from card/bank), withdrawal (to card/bank), peer-to-peer transfer, and pay-merchant debit
- Provide transaction history per user
- Support holds/freezes (e.g., a pending transaction reserves funds before it clears)

**Non-functional**
- Balance must always be correct — no negative balances (unless explicitly overdraft-enabled), no lost/duplicated funds
- Reads of "what's my balance" must be fast (<100ms) since it's shown on every app open
- All balance-changing operations must be idempotent and auditable
- Support high transfer volume without balance-row contention becoming a bottleneck (P2P during a viral event, payroll disbursement bursts, etc.)

### Scale/Capacity Estimation
- 20M wallet users, 5M active weekly
- Balance reads: 5M users × 10 app opens/day = 50M reads/day ≈ 580 QPS avg, cacheable heavily
- Transactions (transfers, top-ups, payments): 10M/day ≈ 115 TPS avg, peak (payday, promotions) 5-10x ≈ 700-1,150 TPS
- A single popular merchant or a payroll-disbursement account can be the *destination* of a huge burst of concurrent credits — this is the hot-row problem, analogous to the hot-SKU problem in Design #2, but for money instead of stock

### API Design

```
GET  /wallets/{userId}/balance                       -> { available_cents, pending_cents, currency }
POST /wallets/{userId}/transfers   { toUserId, amount_cents, idempotencyKey }
POST /wallets/{userId}/topup       { amount_cents, sourcePaymentMethodId, idempotencyKey }
POST /wallets/{userId}/withdraw    { amount_cents, destinationAccountId, idempotencyKey }
GET  /wallets/{userId}/transactions?since=...
```

### Data Model

**Balance is a derived/cached value backed by the ledger (Design #9) as source of truth** — this is the single most important modeling decision for a wallet, and it's exactly the "balance derivation vs. stored balance" trade-off the ledger design covers in depth. Practically:

```sql
accounts(account_id PK, user_id, currency, cached_balance_cents, cached_balance_version, updated_at)
-- cached_balance_cents is a materialized view of "sum of all ledger entries for this account,"
-- maintained transactionally alongside ledger writes, NOT independently updated

ledger_entries(entry_id PK, account_id, txn_id, direction ENUM(DEBIT,CREDIT), amount_cents, created_at)
-- append-only, immutable, source of truth (full detail in Design #9)
```
DB choice: **PostgreSQL**, same reasoning as the processor — this is a money-correctness system,
ACID transactions are required to keep `cached_balance_cents` and `ledger_entries` from ever
diverging. The wallet service's `transfer` operation is a single DB transaction that writes two
ledger entries (debit sender, credit receiver) **and** updates both accounts' cached balances
atomically.

### High-Level Design

```
Client
   │ GET /balance
   ▼
┌────────────────┐        ┌───────────────┐
│  Wallet API     │───────▶│ Redis cache    │  (cache cached_balance_cents, TTL short, invalidated on write)
│  (stateless)    │        └───────────────┘
└────────┬────────┘
         │ POST /transfers (idempotencyKey)
         ▼
┌────────────────────────────┐
│  Transfer Service            │
│  1. idempotency check        │
│  2. lock/validate sender bal │
│  3. write 2 ledger entries   │
│     + update 2 balances      │
│     (ONE DB transaction)     │
└──────────┬──────────────────┘
           ▼
     PostgreSQL (accounts + ledger_entries, sharded by account_id)
           │ async
           ▼
     Kafka: wallet.transfer.completed ──▶ notifications, statements, fraud pipeline (Design #12)
```

**Request flow (transfer):** client calls `/transfers` with an idempotency key → Transfer Service checks the key against the DB (unique constraint), returns cached result if a retry → within one DB transaction: re-check sender's `cached_balance_cents >= amount` (conditional, not blind), insert a DEBIT ledger entry for sender and a CREDIT entry for receiver, update both `cached_balance_cents` fields → commit → emit an async event for notifications/statements. The balance check and the ledger writes happen in the *same* transaction specifically so a concurrent transfer can't slip through between "check balance" and "write debit" (the classic TOCTOU race that would allow overdraft).

### Deep Dive

**Hardest problem: guaranteeing no negative balance under concurrent transfers, without serializing all activity on a popular account.**

The naive approach — read balance, check in application code, write debit — has the same race
condition oversell has in inventory management: two concurrent transfers can both read "balance =
$100," both think a $70 debit is fine, and overdraw to -$40. The fix is the same family of solution
as Design #2's conditional atomic update:

```sql
UPDATE accounts
SET cached_balance_cents = cached_balance_cents - :amount
WHERE account_id = :senderId AND cached_balance_cents >= :amount;
-- check affected row count == 1; if 0, insufficient funds, abort transaction
```
This single atomic conditional UPDATE, inside the same transaction as the ledger inserts, is what
actually prevents overdraft — the database's row lock serializes concurrent attempts on the *same*
account without requiring an app-level lock, and the `WHERE` clause makes "check-then-act" atomic
instead of two separate steps.

For a **hot destination account** (e.g., a payroll account crediting 100,000 employees, or a popular
merchant receiving a burst of payments) — credits don't have the overdraft risk (you can't "over-
credit" incorrectly in the same dangerous way), so this is less severe than hot-SKU/hot-sender
contention, but the row lock on the destination account row is still a throughput ceiling. Mitigate
the same way as Design #2's sharded counters: if the pattern is "many small credits into one
account," consider **deferred/batched balance aggregation** — write ledger entries immediately
(fast, append-only, no contention since each entry is a new row) and update `cached_balance_cents`
via a periodic or count-triggered batch reconciliation job instead of on every single credit,
accepting that `cached_balance_cents` for that one hot account is briefly a few seconds stale while
`ledger_entries` (the source of truth) is always current. This is the practical version of the
ledger design's "derive vs. store" trade-off playing out under load.

**Second hard problem: idempotent transfers across two accounts without deadlock.** If two concurrent transfers happen to touch the same pair of accounts in opposite order (A→B and B→A simultaneously), naive row locking (`SELECT FOR UPDATE` on sender, then receiver) can deadlock. Fix: **always acquire locks in a fixed, consistent order** — e.g., always lock the account with the lower `account_id` first regardless of whether it's sender or receiver — which eliminates the circular-wait condition that causes deadlocks. This is a small, easy-to-miss detail that's a great signal of experience in an interview.

### Scaling the Design
- Shard `accounts` and `ledger_entries` by `account_id` hash — a transfer touches exactly 2 accounts, and cross-shard transfers use a saga (debit locally, emit event, credit on the other shard, with compensation on failure) rather than a distributed transaction, same pattern as the e-commerce checkout saga.
- Cache balance reads aggressively (Redis, short TTL, invalidate-on-write) since reads (580+ QPS) vastly outnumber writes (115 TPS) and balance display tolerates a few hundred ms of staleness far better than a transfer does.
- Ledger entries are append-only and naturally partition-friendly (no updates, ever) — this table can grow essentially without bound and still perform well if partitioned by time + account shard.

### Failure Handling
- Crash mid-transfer (after debit committed, before credit): impossible if both are one DB transaction — this is precisely *why* they must be one transaction, not two separate calls. If cross-shard (saga-based), a crash after the debit-and-event-emit step leaves the transfer `PENDING`; a recovery job resolves it by retrying the credit step idempotently (keyed by transfer ID) or, if the credit side is permanently failing, compensating with a re-credit to the sender.
- Idempotency key collision from a genuinely different request (client bug reusing a key): treat as a hard error requiring manual review rather than silently overwriting — silent overwrite on an ambiguous case is worse than a rejected request.
- Cache/DB divergence: cache is a pure read-through of `cached_balance_cents`, never independently written, so divergence self-heals on the next write-triggered invalidation; a periodic job can also validate `cached_balance_cents == sum(ledger_entries)` per account as a background integrity check.

### Trade-offs
- Stored/cached balance (fast reads, requires careful transactional maintenance to avoid drift) vs. always deriving balance live from summing ledger entries (always correct by construction, too slow for a value read on every app open at this scale) — the wallet keeps both: ledger is truth, cached balance is a transactionally-maintained materialized view, reconciled periodically. This exact trade-off is explored in full in Design #9.
- Same-shard transactional transfers (simple, fast, strongly consistent) vs. cross-shard sagas (necessary at scale, eventually consistent during the saga window, more failure modes to handle) — accept the added complexity only once single-shard throughput is actually the bottleneck.

---

## 9. Ledger

> This is the question most likely to be asked directly and evaluated harshly at a company like
PayPal — treat it as the centerpiece of this whole document.

### Requirements

**Functional**
- Record every financial event as one or more **balanced double-entry postings** (every debit has a matching credit, sum = 0)
- Support querying: account balance as-of any point in time, full transaction history per account, full audit trail per transaction
- Support idempotent posting (the same economic event, submitted twice, posts exactly once)
- Never allow a modification or deletion of a posted entry — corrections happen via new, offsetting entries (a reversal), never an UPDATE or DELETE

**Non-functional**
- **Immutability**: append-only, cryptographically or at minimum structurally tamper-evident (no UPDATE/DELETE permissions on the entries table at the DB grant level, not just at the application level)
- Absolute correctness: the sum of all entries for any transaction must always be zero (double-entry invariant), enforceable, not just hoped for
- Auditability: regulators and internal audit must be able to reconstruct the exact state of any account at any historical timestamp
- High write throughput (this is the system every money-moving service in the platform writes to) with strict ordering per account

### Scale/Capacity Estimation
- Every transaction anywhere in the platform (payments, refunds, wallet transfers, fees, payouts) produces ≥2 ledger entries: at 50M payment transactions/day + wallet transfers + refunds + fee postings, assume ~150-250M ledger entries/day
- ≈ 1,700-2,900 entries/sec average, peak 5-10x ≈ 15,000-29,000 entries/sec
- Entry size: ~200 bytes → 250M/day × 200B × 365 × 7yr retention ≈ 127TB (append-only, compresses well, cold-tiers naturally by age)
- Balance queries: much higher read volume than write volume (every wallet balance check, every reporting dashboard) — this is why balance is generally **cached/materialized**, not always summed live (see Deep Dive)

### API Design

```
POST /ledger/postings     {
  transaction_id: "txn_123",       -- idempotency key: this exact economic event
  entries: [
    { account_id: "acct_A", direction: "DEBIT",  amount_cents: 5000, currency: "USD" },
    { account_id: "acct_B", direction: "CREDIT", amount_cents: 5000, currency: "USD" }
  ],
  metadata: {...}
} -> { posting_id, status: POSTED }   -- rejects if sum(debits) != sum(credits) or if transaction_id already posted

GET /ledger/accounts/{id}/balance?asOf=2026-08-01T00:00:00Z
GET /ledger/accounts/{id}/entries?from=...&to=...
POST /ledger/reversals   { original_transaction_id, reason }   -- posts an offsetting entry, never deletes
```

### Data Model

```sql
postings(transaction_id PK,     -- the idempotency key: one posting per economic event
         status ENUM(POSTED, REVERSED),
         created_at, metadata_jsonb)

ledger_entries(
  entry_id PK,
  transaction_id FK,             -- groups entries belonging to one posting
  account_id,
  direction ENUM(DEBIT, CREDIT),
  amount_cents BIGINT,           -- always positive; direction carries the sign meaning
  currency CHAR(3),
  created_at TIMESTAMPTZ,
  sequence_no BIGINT             -- monotonic per account_id, enables efficient as-of balance reconstruction
)
-- NO UPDATE OR DELETE GRANTS on ledger_entries at the DB role level — enforced structurally, not just by convention
-- CHECK/trigger: for every transaction_id, SUM(CASE WHEN direction='DEBIT' THEN amount ELSE -amount END) = 0

account_balances(              -- materialized/cached, NOT source of truth
  account_id PK,
  balance_cents BIGINT,
  last_applied_sequence_no BIGINT,
  updated_at
)
```
DB choice: **PostgreSQL** (or a specialized ledger database like a purpose-built event-sourced
store) — the double-entry balance invariant and append-only guarantee are most reliably enforced
with real ACID transactions, DB-level grants (revoke UPDATE/DELETE on `ledger_entries` entirely —
the *database* enforces immutability, not just application code that could have a bug), and a
`CHECK`/trigger-enforced sum-to-zero constraint per transaction.

### High-Level Design

```
Wallet Svc, Payment Processor, Refund Svc, Fee Engine, ...  (every money-moving service)
                              │  POST /ledger/postings (transaction_id = idempotency key)
                              ▼
                    ┌───────────────────┐
                    │  Ledger API        │── validates: sum(debits)==sum(credits), transaction_id not already posted
                    └─────────┬─────────┘
                              ▼
                    ┌───────────────────┐
                    │  Posting Service    │── ONE DB transaction:
                    │                     │     1. insert postings row (unique txn_id = idempotency)
                    │                     │     2. insert N balanced ledger_entries
                    │                     │     3. update account_balances (materialized) for affected accounts
                    └─────────┬─────────┘
                              ▼
                    PostgreSQL (ledger_entries: append-only, partitioned by time + account shard)
                              │ async, after commit
                              ▼
                    Kafka: ledger.posted ──▶ reporting, reconciliation (Design #11), statements
```

**Request flow:** any service that moves money (wallet transfer, payment capture, refund, fee deduction) calls `POST /ledger/postings` with a `transaction_id` that uniquely identifies *this specific economic event* (not a random UUID per HTTP call, but a stable ID for the event — retries of the same event use the same ID) and a list of balanced debit/credit entries. The Ledger API validates the double-entry invariant (`sum(debits) == sum(credits)`) *before* touching the DB — reject bad data early rather than relying solely on the DB constraint as the only line of defense, though the DB constraint remains the actual enforcement backstop. The Posting Service writes the `postings` row (whose primary key *is* the idempotency key) and all `ledger_entries` in one transaction, and updates the materialized `account_balances` for every affected account in the same transaction. A duplicate submission with the same `transaction_id` is rejected at the `postings` primary key and the original result is returned — no double-posting is possible even under network retries.

### Deep Dive

**Hardest problem #1: idempotent posting under retries, without double-crediting or double-debiting the same economic event.**

The mechanism is the `transaction_id` as **primary key** on `postings`, not merely a unique index
checked separately — this collapses "check if exists" and "insert" into one atomic operation via the
database's own conflict handling (`INSERT ... ON CONFLICT DO NOTHING` or catching the PK violation),
removing the TOCTOU race that a separate check-then-insert would have. The upstream service (wallet,
processor, etc.) is responsible for choosing a stable `transaction_id` — typically derived from its
own idempotency key or the underlying business event ID — so that *retrying the same business
operation* naturally reuses the same ledger `transaction_id`, and posting is safe to retry
indefinitely.

**Hardest problem #2: balance derivation vs. stored balance — the classic trade-off, and how to actually get both correctness and speed.**

Two pure approaches, both with a real cost:
- **Pure derivation**: balance = `SELECT SUM(...)` over all `ledger_entries` for an account, always. This is *always correct by construction* (a stored value can never drift from the truth if there is no stored value) but gets slower as history grows — summing millions of entries for a long-lived account on every balance check is not viable at the QPS a wallet balance endpoint sees.
- **Pure stored balance**: an `account_balances.balance_cents` field updated on every posting, read directly. Fast, but now you have two representations of the truth that can drift apart (a bug, a partial failure, a bypassed code path) with no self-healing mechanism.

The answer used in every real ledger system (and the one to state confidently in an interview):
**stored balance as a materialized, transactionally-maintained cache of the ledger, treated as
derived data that must always be reconstructible from source, never as an independent write path.**
- `account_balances` is updated *only* inside the same DB transaction that inserts the `ledger_entries` it reflects — never by an independent "update balance" call from elsewhere.
- `last_applied_sequence_no` on `account_balances` records exactly which entries are reflected, enabling **incremental catch-up**: if the materialized balance is ever suspected to have drifted (bug, manual data fix, migration), it can be rebuilt by summing `ledger_entries WHERE sequence_no > last_applied_sequence_no` rather than resumming the entire history — this is the practical trick that makes "derive when in doubt, cache for speed" affordable even for old, high-volume accounts.
- A periodic **integrity job** independently recomputes balances from raw `ledger_entries` (can run on a read replica, off the hot path) and alerts if it diverges from `account_balances` — this is a real production safety net that's worth naming explicitly; a staff-level answer treats drift detection as a first-class system component, not an afterthought.
- "Balance as-of a historical timestamp" (for statements/audits) is *always* computed by derivation over `ledger_entries WHERE created_at <= asOf`, since a single current materialized value can't answer a historical question — this is precisely why the immutable, timestamped entry log is the real source of truth and the stored balance is only ever an optimization for "balance right now."

**Immutability enforcement, concretely**: revoke `UPDATE`/`DELETE` grants on `ledger_entries` for every application DB role (only an `INSERT`-only role is granted); corrections are modeled as new entries referencing the original `transaction_id` via a `reversal_of` field, never as a mutation. This makes the audit trail trustworthy even against application bugs, not just malicious actors — a bug that tries to "fix" a bad entry in place is stopped by the database itself.

### Scaling the Design
- Partition `ledger_entries` by time range (e.g., monthly partitions) for easy archival/cold-tiering of old entries, combined with a shard key on `account_id` hash for write distribution — a single posting's entries typically span only 2-3 accounts, so cross-shard postings use the same saga/2-phase pattern as the wallet's cross-shard transfers.
- Read-heavy balance queries hit `account_balances` (small, hot, cacheable) and never the full `ledger_entries` table except for historical/audit queries, which can be routed to read replicas.
- Append-only tables are among the easiest things to scale horizontally (no update contention, natural time-based partitioning, easy to move old partitions to cheaper storage) — lean into this rather than fighting it.

### Failure Handling
- Partial write within the posting transaction: impossible by construction if entries + balance update are one DB transaction — reinforce in the interview that this is *why* it's one transaction, not an implementation detail.
- Detected balance drift (integrity job fires): never auto-correct silently — flag for manual/automated reconciliation review (Design #11) and recompute the materialized balance from source, but treat any drift as a P1 incident requiring root-cause analysis, since it implies a bypass of the single write path somewhere in the platform.
- Reversal of an already-reversed transaction (double reversal attempt): idempotency key on the reversal request itself (`transaction_id = "reversal_of_txn_123"`, stable and unique) prevents duplicate reversal postings the same way original postings are protected.

### Trade-offs
- Stored balance as a transactionally-maintained cache (fast reads, small risk of drift mitigated by integrity jobs) vs. pure live derivation (zero drift risk by construction, unusable read latency at scale) — the hybrid is the only real answer; presenting either pure extreme as "the" solution is a signal of shallow understanding.
- DB-level immutability enforcement (revoked grants, strongest guarantee, some operational friction for legitimate data-fix scenarios which must go through reversal postings instead of UPDATE) vs. application-level-only immutability (easier to bypass accidentally or via a bug, weaker audit story) — DB-level wins for anything regulator-facing.

---

## 10. Refund System

### Requirements

**Functional**
- Full and partial refunds against a previously captured payment
- Idempotent refund requests (retry-safe)
- Refund must reconcile precisely against the original transaction (can't refund more than was captured, across possibly multiple partial refunds)
- Reflect refund in the ledger as a proper reversing entry, not a deletion of the original

**Non-functional**
- Correctness: total refunded amount for a transaction must never exceed the original captured amount, even under concurrent partial-refund requests
- Latency: refund initiation should be fast (<2s) even though actual fund return to the customer's bank/card can take days
- Auditability: every refund traceable to its original transaction and to a specific actor/reason

### Scale/Capacity Estimation
- Refund rate typically 2-5% of transactions: at 50M transactions/day, ~1-2.5M refunds/day ≈ 12-29 TPS avg
- Partial refunds are less common than full refunds but must be supported (e.g., partial returns in e-commerce) — assume up to 3-4 partial refund events per original transaction in the worst case
- Refund-to-original-transaction lookup must be fast; refund processing itself is not on a tight real-time path (customer-facing "refund requested" confirmation is fast, actual bank-side fund return is async/days)

### API Design

```
POST /refunds     { chargeId, amount_cents, reason, idempotencyKey }
                   -> { refundId, status: PENDING|COMPLETED|FAILED }
GET  /refunds/{id}
GET  /charges/{chargeId}/refunds       -- full refund history for a charge
```

### Data Model

```sql
refunds(refund_id PK, charge_id FK, amount_cents, status, reason,
        idempotency_key UNIQUE, created_at, completed_at)

-- The critical constraint, enforced transactionally, not just checked in app code:
-- SUM(refunds.amount_cents WHERE charge_id = X AND status != FAILED) <= charges.captured_amount_cents
```
DB choice: **PostgreSQL**, same charges/transactions DB as the processor (Design #7) — a refund is
fundamentally a query-then-constrain operation against the original transaction's captured amount,
and doing this cross-database would reintroduce exactly the kind of distributed-transaction problem
this whole document teaches you to avoid via saga patterns; keeping refunds co-located with the
transaction they reference sidesteps that entirely.

### High-Level Design

```
Merchant/CS Agent/Customer
       │ POST /refunds (idempotencyKey)
       ▼
┌────────────────────┐
│  Refund Service      │
│  1. idempotency check│
│  2. lookup original   │◀── Payment Processor DB (charges table)
│     charge + sum of   │
│     prior refunds     │
│  3. validate amount   │
│     <= remaining       │
│  4. write refund row  │  (ONE DB transaction with the validation read, using SELECT FOR UPDATE
│     + post reversing   │   on the charge row to prevent concurrent partial-refund overshoot)
│     ledger entries     │
└──────────┬───────────┘
           ▼
   Ledger Service (Design #9): posts reversing debit/credit
           ▼
   Payment Processor: initiates actual fund return via original rail
   (async — card refunds settle in 5-10 business days typically)
           ▼
   Kafka: refund.completed ──▶ notify customer, update order status (Design #1), reconciliation (Design #11)
```

**Request flow:** a refund request (from a merchant dashboard, customer service tool, or automated return flow) arrives with an idempotency key → Refund Service looks up the original charge and sums all *non-failed* prior refunds against it → validates `amount ≤ captured_amount - already_refunded` → this check-and-insert must happen with the charge row locked (`SELECT ... FOR UPDATE` on the charge, or an atomic conditional UPDATE against a maintained `remaining_refundable_cents` column) to prevent two concurrent partial refunds from each independently passing the check and together over-refunding → on success, writes the refund row and posts a reversing entry to the ledger (debit the merchant's account, credit the original payment method/customer, mirroring but not deleting the original posting) → hands off to the Payment Processor to actually initiate the fund return on the original rail, which is inherently async.

### Deep Dive

**Hardest problem: preventing over-refund under concurrent partial-refund requests, exactly analogous to the oversell and overdraft problems seen in Designs #2 and #8 — same shape, different domain.**

This is worth naming explicitly in an interview: three completely different domains (inventory,
wallet balance, refunds) all reduce to the identical concurrency pattern — **"validate remaining
capacity, then consume some of it, atomically, without a check-then-act race."** The fix is the same
family of solution every time:
```sql
UPDATE charges
SET remaining_refundable_cents = remaining_refundable_cents - :amount
WHERE charge_id = :id AND remaining_refundable_cents >= :amount;
-- 0 rows affected => reject: amount exceeds what's left refundable
```
maintained as a denormalized column on `charges` specifically so this becomes one atomic conditional
UPDATE rather than a `SUM(refunds...)` aggregate query followed by a separate insert (which reopens
the race window between the sum and the insert). Recognizing "I've seen this shape before" across
inventory/wallet/refunds is a much stronger interview signal than solving each one from scratch as
if unrelated.

**Second hard problem: reconciling a refund against an original transaction that itself might not be in a terminal state** — e.g., refunding a transaction that hasn't fully settled yet, or refunding a transaction that's simultaneously under chargeback dispute. Handle by making refund eligibility a function of the charge's *status*, not just its amount: only `CAPTURED` or `SETTLED` charges are refundable; a charge already in `DISPUTED` (chargeback) status is routed to a different resolution flow rather than allowing a refund to layer on top of an active dispute (which would otherwise double-return funds to the customer — once via chargeback, once via refund). This is exactly the kind of edge case that separates a thorough answer from a superficial one at a fintech-focused interview.

**Idempotency nuance specific to refunds**: the idempotency key protects against *duplicate* refund requests, but a legitimate business flow may issue *multiple distinct* partial refunds against the same charge (different idempotency keys, same `charge_id`) — the system must not conflate "idempotent retry of refund A" with "a second, separate, legitimate partial refund B." This is why the idempotency key is scoped per refund *attempt*, while the over-refund guard is scoped per *charge* — two different invariants enforced at two different levels, and conflating them is a common design mistake worth explicitly avoiding.

### Scaling the Design
- Co-located with the processor's `charges` table (same shard, same DB) — refunds inherently need a strongly consistent view of "how much has already been refunded against this specific charge," so this is one of the few sub-systems where you deliberately avoid splitting into a separately-scaled service, trading some independent scalability for correctness simplicity.
- Refund initiation (fast, synchronous) is decoupled from actual fund return (slow, async, rail-dependent) via the same authorize-fast/settle-slow pattern used throughout the FinTech designs — the customer-facing "refund initiated" response doesn't wait on the bank.

### Failure Handling
- Refund initiated but the actual fund-return call to the rail fails after the ledger entry is posted: ledger entry stands (the *obligation* to refund is correctly recorded and irreversible per ledger immutability), but the refund's status stays `PENDING`/`FAILED_RETRYABLE` and a recovery job retries the rail call — the ledger and the "did the money actually move" state are deliberately decoupled so a rail hiccup never risks a duplicate ledger posting.
- Concurrent full refund + partial refund racing on the same charge: the same atomic conditional UPDATE on `remaining_refundable_cents` handles this uniformly regardless of how many concurrent requests or what mix of full/partial they are.

### Trade-offs
- Denormalized `remaining_refundable_cents` column (fast atomic check, must be kept perfectly in sync with the refunds table via the same transaction) vs. computing remaining amount by summing the refunds table live on every request (simpler schema, reopens the race window unless done under a row lock, and is slower under high refund volume on one charge) — denormalize for the same reason the wallet denormalizes cached balance: read/check-path speed matters more than schema purity here.
- Tight coupling of refunds to the processor's charge data (fast, consistent, simple) vs. a fully independent refund microservice with its own DB (better team/service boundary, requires a saga or synchronous cross-service call to enforce the over-refund invariant, adding real complexity for a correctness-critical check) — correctness wins; don't over-decompose services around a single tightly-coupled invariant.

---

## 11. Reconciliation

### Requirements

**Functional**
- Compare internal transaction/ledger records against external records (payment processor reports, bank settlement files, card network reports) to detect mismatches
- Categorize mismatches: missing internally (processor has it, we don't), missing externally (we have it, processor doesn't), amount mismatch, status mismatch (e.g., we think `CAPTURED`, processor says `REFUNDED`)
- Support automated resolution for known-safe patterns, and a manual review queue for ambiguous cases
- Produce daily/periodic reconciliation reports for finance/compliance

**Non-functional**
- Must run reliably on a schedule (typically daily, aligned with bank/processor settlement file delivery) without manual triggering
- Zero false "all matched" reports — a reconciliation system that silently swallows real mismatches is worse than none, because it creates false confidence
- Scalable to full daily transaction volume without the comparison job itself becoming a multi-day process
- Auditable: every mismatch and its resolution (auto or manual) must be logged

### Scale/Capacity Estimation
- 50M transactions/day to reconcile against external processor/bank files
- External settlement files typically arrive as batch files (CSV/fixed-width/ISO 20022 XML) once daily per processor/bank relationship, sizes ranging from MBs to multiple GBs depending on volume
- Expected mismatch rate in a healthy system: well under 0.1% (~50,000 transactions/day at 0.1%, though a mature system should see far fewer) — the reconciliation job must efficiently confirm the 99.9%+ that DO match, not just find the ones that don't
- Reconciliation job window: must complete comparison well within a business day to leave time for manual review of flagged items before finance close

### API Design

Reconciliation is largely an internal batch system, but exposes:
```
POST /reconciliation/runs                { processorId, period }     -- typically scheduled, not manually triggered
GET  /reconciliation/runs/{id}            -> { matched, mismatched, pending_review }
GET  /reconciliation/runs/{id}/mismatches?type=amount_mismatch
POST /reconciliation/mismatches/{id}/resolve  { resolutionType, notes, resolvedBy }
```

### Data Model

```sql
external_records(record_id PK, run_id FK, external_ref, amount_cents, status, raw_payload_jsonb)
-- ingested verbatim from the processor/bank file before any matching logic runs

reconciliation_runs(run_id PK, processor_id, period_start, period_end, status, started_at, completed_at)

reconciliation_mismatches(
  mismatch_id PK, run_id FK, internal_txn_id NULL, external_record_id NULL,
  mismatch_type ENUM(MISSING_INTERNAL, MISSING_EXTERNAL, AMOUNT_MISMATCH, STATUS_MISMATCH),
  internal_amount_cents NULL, external_amount_cents NULL,
  status ENUM(OPEN, AUTO_RESOLVED, MANUALLY_RESOLVED),
  resolution_notes, created_at, resolved_at
)
```
DB choice: **PostgreSQL** for the matching/mismatch tables (needs relational joins between internal
transactions and external records, plus transactional status updates as items get resolved); the raw
external file ingestion can land first in object storage (S3) for auditability/replay before being
parsed into `external_records` — never parse-and-discard the raw file, since a parsing bug
discovered later needs to be re-run against the original source.

### High-Level Design

```
Processor/Bank ──(daily settlement file, SFTP/API)──▶ ┌─────────────────┐
                                                        │ File Ingestion   │──▶ S3 (raw file, immutable archive)
                                                        └────────┬────────┘
                                                                 ▼
                                                        ┌─────────────────┐
                                                        │ Parser/Normalizer│──▶ external_records table
                                                        └────────┬────────┘
                                                                 ▼
                                          ┌──────────────────────────────────┐
                                          │        Matching Engine             │
                                          │  joins external_records against    │
                                          │  internal transactions/ledger      │
                                          │  (by external_ref / processor_ref) │
                                          └──────┬───────────────┬───────────┘
                                     matched      │               │  mismatched
                                 (mark reconciled)│               ▼
                                                  │      ┌──────────────────┐
                                                  │      │ Mismatch Classifier│── categorizes type
                                                  │      └────────┬─────────┘
                                                  │               ▼
                                                  │      ┌──────────────────┐
                                                  │      │ Auto-Resolution    │── known-safe patterns
                                                  │      │ Rules Engine       │   (e.g., timing lag < 24h)
                                                  │      └────────┬─────────┘
                                                  │        unresolved
                                                  │               ▼
                                                  │      ┌──────────────────┐
                                                  └─────▶│ Manual Review     │──▶ Finance/Ops dashboard
                                                         │ Queue              │
                                                         └──────────────────┘
                                                                 │
                                                                 ▼
                                                       Daily reconciliation report
                                                       (matched %, open mismatches, $ at risk)
```

**Request flow:** the external processor/bank delivers a settlement file (SFTP, S3 drop, or API pull) once daily → File Ingestion stores it immutably in object storage first (so re-parsing after a bug fix never depends on the source system re-sending it) → Parser normalizes the file's format-specific structure into `external_records` → Matching Engine joins these against internal `transactions`/`ledger_entries` by a shared reference (`processor_ref`, the ID exchanged at authorization time in Design #7) → matched pairs where amount and status agree are marked reconciled and closed out → mismatches are classified by type and run through an auto-resolution rules engine for well-understood, low-risk patterns (e.g., "external record arrived one day later than expected due to a known processing lag, but amount matches exactly" → auto-resolve) → anything the rules engine can't confidently resolve lands in a manual review queue surfaced to finance/ops → a daily report summarizes match rate and total dollar amount at risk.

### Deep Dive

**Hardest problem: matching records across two systems that don't share a primary key, at volume, without either missing real mismatches or drowning the manual queue in false positives.**

The matching key itself is the foundation: this is *why* Design #7 (processor) stores
`processor_ref` on every transaction at authorization time — without a shared reference ID
established at the point of initial contact with the external system, matching degrades to fuzzy
heuristics (amount + approximate timestamp + merchant ID), which is unreliable at any real volume.
**The single highest-leverage design decision in the whole reconciliation problem is ensuring the
reference ID is captured and stored at the point of the original transaction, not reconstructed
later.**

Given a reliable join key, the matching engine becomes a large batch join (external_records LEFT
JOIN internal_transactions ON processor_ref, and the reverse), classified into exactly four buckets:
1. **Present in both, amounts and status agree** → matched, no action. 2. **Present internally,
missing externally** → either a timing lag (external file just hasn't caught up — very common,
expected, should auto-resolve if it clears within a defined SLA window on the next day's run) or a
real problem (we think we charged someone, the processor has no record — potentially a phantom
transaction that needs to be reversed). 3. **Present externally, missing internally** → we're
missing a record of money that moved — often the more serious category, since it suggests either a
lost webhook/event or a genuine unauthorized transaction; escalate to manual review by default
rather than auto-resolving, since the cost of missing a genuine anomaly here is higher than the
annoyance of a review queue item. 4. **Present in both, amount or status disagrees** → almost always
requires manual review; auto-resolve only for well-characterized patterns like currency-rounding
differences below a fixed cent threshold.

**Auto-resolution rules must be conservative and narrowly scoped, reviewed periodically, and every auto-resolution must still be logged** (never silently discarded) — the failure mode to actively design against is an auto-resolution rule that's slightly too broad and starts silently swallowing real discrepancies, which is worse than having no automation at all because it erodes the very trust the reconciliation system exists to provide. A good pattern: auto-resolution rules ship with a "shadow mode" period where they're evaluated and logged but don't actually close the mismatch, so their false-positive rate can be measured against manual review outcomes before they're trusted to auto-close.

**Second hard problem: reconciliation at scale without the join becoming a multi-hour table scan.** Index both sides on the matching key (`processor_ref`), partition the internal transactions table by date range matching the settlement period being reconciled (limits the join's working set to a bounded window rather than scanning all history), and run the match as a set-based batch operation (SQL join or a Spark/Flink batch job for very large processors) rather than row-by-row lookups, which would be far too slow at 50M/day.

### Scaling the Design
- Partition reconciliation runs by `processor_id` — each processor relationship reconciles independently and in parallel, since there's no cross-processor matching needed.
- For very high-volume processors, move the matching join from a single-node SQL query to a distributed batch framework (Spark) reading from a data warehouse replica, keeping the transactional OLTP database untouched by the heavy analytical join.
- Manual review queue scales by routing mismatch types to specialized review teams (amount mismatches to finance, missing-internal to engineering/on-call) rather than one undifferentiated queue.

### Failure Handling
- Settlement file fails to arrive on schedule: alert immediately rather than silently skipping that day's reconciliation — a missed reconciliation run is itself a risk event, not a no-op.
- Parser fails on a malformed file (processor changed their format): fail the run loudly, do not partially reconcile against a partially-parsed file and report a false "mostly matched" status.
- Auto-resolution rule found to be incorrect after the fact: because raw external files are archived immutably in S3 and every resolution (auto or manual) is logged with which rule fired, any incorrect auto-resolution can be identified and the affected mismatches re-opened and reprocessed — this replay capability is the entire reason for archiving the raw file rather than discarding it after parsing.

### Trade-offs
- Conservative auto-resolution (fewer false "resolved" mismatches, larger manual queue, more ops labor) vs. aggressive auto-resolution (less manual work, real risk of silently swallowing genuine discrepancies) — for a payments company, err conservative; the cost asymmetry (a missed fraud/error vs. some extra analyst time) strongly favors it.
- Daily batch reconciliation (simple, matches how bank/processor settlement files are actually delivered, up to 24h detection lag) vs. real-time/streaming reconciliation against processor webhooks (lower detection latency, but external bank/network settlement data often genuinely isn't available in real time regardless of architecture — you can't stream-reconcile against a file that hasn't been generated yet) — batch is usually not a choice but a constraint imposed by the external systems.

---

## 12. Fraud/Risk Pipeline

### Requirements

**Functional**
- Score every transaction (and potentially account-level actions like login, password change) for fraud/risk in real time
- Combine rules-based checks (velocity limits, blocklists, geo-mismatch) with ML-based scoring (behavioral anomaly detection)
- Support both synchronous (block/allow before transaction completes) and asynchronous (flag for review after the fact) scoring paths
- Feed decisions and outcomes (confirmed fraud, false positive) back into the system for continuous model improvement

**Non-functional**
- Synchronous scoring must add minimal latency to the checkout/authorization path — realistically under 100-200ms budget, since it sits inside the payment gateway's already-tight latency budget
- High recall on fraud (missing fraud is directly costly) balanced against false-positive rate (blocking legitimate customers is also directly costly — lost revenue and trust)
- Feature computation must reflect near-real-time account/transaction history (a velocity check needs "transactions in the last 10 minutes," not last night's batch numbers)
- Explainability: risk/compliance teams need to know *why* a transaction was flagged, not just a black-box score

### Scale/Capacity Estimation
- Scoring volume roughly matches transaction volume: 50M scored events/day ≈ 580 QPS avg, peak 5,800 QPS
- Feature store reads: each scoring event might read 20-50 features (velocity counts, historical averages, device/IP reputation) → 580 QPS × 30 features ≈ 17,400 feature reads/sec at average load
- Model inference latency budget: <20-50ms for the synchronous path (rules can be a few ms; ML inference on a lightweight model, e.g., gradient-boosted trees, typically 5-20ms; deep models pushed to async-only if too slow)
- Feature freshness requirement: velocity features (e.g., "transactions in last 5 min") need sub-second update latency from a streaming pipeline

### API Design

```
POST /risk/score      {
  transactionId, userId, amount_cents, merchantId, deviceFingerprint, ipAddress, ...
} -> { score: 0.0-1.0, decision: ALLOW|CHALLENGE|BLOCK, reasons: [...], latencyMs }
      -- called synchronously inline in the payment gateway's authorization path

POST /risk/events      { userId, eventType: LOGIN|PASSWORD_CHANGE|..., ...}
                        -- lower-stakes events, can be fully async

GET  /risk/cases/{caseId}     -- for manual review queue / analyst tooling
POST /risk/cases/{caseId}/label   { outcome: CONFIRMED_FRAUD|FALSE_POSITIVE }   -- feeds model retraining
```

### Data Model

| Store | Entity | Why |
|---|---|---|
| Feature store (e.g., Redis for online/low-latency, offline store like a data warehouse for training) | `features:{userId} -> {txn_count_5min, avg_amount_30d, distinct_devices_7d, ...}` | Sub-10ms feature reads required for synchronous scoring; the online/offline split is the standard feature-store pattern — same feature definitions, two storage tiers with very different latency/consistency needs |
| Postgres/data warehouse | `risk_scores`, `risk_cases`, `labels` | Audit trail of every decision, needed for compliance and model evaluation |
| Kafka/streaming (Flink) | real-time feature computation from `transaction.created`, `login.attempted` events | Keeps velocity/behavioral features fresh at sub-second latency, decoupled from the synchronous scoring path itself |

```sql
risk_scores(score_id PK, transaction_id, score, decision, model_version, reasons_jsonb, scored_at, latency_ms)
risk_cases(case_id PK, transaction_id, status ENUM(OPEN,CONFIRMED_FRAUD,FALSE_POSITIVE), assigned_to, created_at)
```

### High-Level Design

```
Payment Gateway (Design #6)
        │  POST /risk/score  (inline, synchronous, tight latency budget)
        ▼
┌─────────────────────┐
│  Risk Scoring API     │
└──────────┬───────────┘
           ▼
┌─────────────────────┐        ┌────────────────────┐
│  Rules Engine          │◀────▶│ Blocklists/Allowlists│  (fast, deterministic, checked first)
│ (velocity, geo, amount)│      └────────────────────┘
└──────────┬───────────┘
           │ not auto-blocked/allowed by rules
           ▼
┌─────────────────────┐        ┌────────────────────┐
│  ML Scoring Service    │◀────▶│ Online Feature Store │  (Redis, sub-10ms reads)
│ (lightweight model,     │      └──────────┬─────────┘
│  e.g. GBT, <20ms)        │                 ▲
└──────────┬───────────┘                 │ near-real-time writes
           ▼                              │
     decision returned                ┌────────────────┐
     synchronously to gateway          │ Streaming Feature│◀── Kafka: transaction.*, login.*
     (ALLOW/CHALLENGE/BLOCK)           │ Computation (Flink)│    events from across the platform
                                        └────────────────┘
           │ async, regardless of decision
           ▼
┌─────────────────────┐        ┌────────────────────┐
│ Async Deep Scoring    │───▶  │ Manual Review Queue  │──▶ analyst labels outcome
│ (heavier models,       │      └──────────┬─────────┘
│  cross-txn pattern      │                 │ feeds back
│  detection, no latency  │                 ▼
│  budget)                │      ┌────────────────────┐
└─────────────────────┘        │ Offline Feature Store│──▶ model retraining pipeline
                                 │ (data warehouse)      │
                                 └────────────────────┘
```

**Request flow:** the payment gateway calls `/risk/score` synchronously, inline, as part of authorization (Design #6's "fast synchronous fraud pre-check"). The Rules Engine runs first — cheap, deterministic checks (known bad IP/device blocklist, hard velocity limits like "more than 10 transactions in 60 seconds," amount thresholds) that can immediately ALLOW (trusted returning customer, low amount) or BLOCK (hard blocklist hit) without needing ML at all, which both saves latency and gives a fully explainable reason for the majority of clear-cut cases. Transactions that aren't resolved by rules alone go to the ML Scoring Service, which pulls precomputed features from the low-latency online Feature Store (velocity counts, behavioral aggregates — computed continuously by a streaming job consuming platform-wide transaction/login events, *not* computed on-demand at scoring time, which would blow the latency budget) and returns a score plus a decision (ALLOW/CHALLENGE e.g. step-up authentication/BLOCK) within the tight synchronous window. Independently of the synchronous decision, every transaction also flows into an async deep-scoring path with no latency constraint — heavier models, cross-transaction pattern detection, graph-based fraud ring detection — which can retroactively flag a transaction that was initially allowed, triggering a case for manual review and potentially a reversal/hold action after the fact.

### Deep Dive

**Hardest problem: the sync vs. async scoring trade-off, and how to get the benefits of both without either blowing the checkout latency budget or missing sophisticated fraud that only shows up in slower, richer analysis.**

The core tension: the best fraud signals often require either heavy computation (deep models, cross-
account graph analysis) or data that simply isn't available yet at authorization time (e.g., "did
this card get disputed" — that's information from days later). But checkout can't wait for that. The
resolution is a **tiered/cascading architecture**, not a single scoring step, and being explicit
about *why* each tier exists is the actual interview signal:

- **Tier 0 — Rules (µs-ms)**: deterministic, fully explainable, handles the highest-confidence cases (known-bad blocklist, hard velocity caps) without touching ML at all. This tier exists because a huge fraction of real fraud (and a huge fraction of clearly-legitimate traffic) doesn't need a model to classify correctly, and rules are trivially auditable for compliance in a way ML scores aren't.
- **Tier 1 — Lightweight synchronous ML (5-20ms)**: a model chosen specifically for inference speed (gradient-boosted trees or a small linear/logistic model over precomputed features) over raw accuracy — this is a deliberate trade of some model sophistication for a hard latency ceiling, because a checkout flow that takes 3 extra seconds loses more to abandonment than a slightly-better model gains in fraud caught. Feature *computation* is never done inline here; only feature *lookup* from the pre-materialized online store is, which is what keeps this tier fast.
- **Tier 2 — Asynchronous deep scoring (seconds to minutes, no user-facing latency constraint)**: this is where the more expensive/sophisticated models live — graph-based analysis (is this account connected to a known fraud ring via shared device/IP/payment method with other flagged accounts), longer-window behavioral models, ensemble scoring. Because it runs after the transaction has already been allowed, its output isn't "block the checkout" but "open a case, and potentially trigger a hold/reversal/step-up-auth on the account for future transactions."
- **Feedback loop**: analyst labels from the manual review queue (confirmed fraud vs. false positive) flow into the offline feature store and retraining pipeline — this is what keeps Tier 1's lightweight model from going stale, and it's worth stating explicitly that a fraud model without a labeling feedback loop degrades over time as fraud patterns shift (adversarial, adaptive attackers), unlike most ML systems where the underlying distribution is comparatively stable.

**Second hard problem: feature freshness for velocity-style features without recomputing from scratch on every score request.** "Transactions in the last 5 minutes for this user" cannot be a live aggregate query against the transactional DB on every scoring call (too slow, and hammers the OLTP DB with an analytical query pattern it's not built for). Instead, a streaming job (Flink/Kafka Streams) consumes the platform-wide `transaction.created` event stream and maintains sliding-window aggregates per user directly in the online feature store (Redis), incrementally updated as events arrive rather than recomputed — this is the standard **feature store** pattern: one continuously-updated source of truth for a feature, read by many consumers (sync scoring, async scoring, and, via the offline mirror, training pipelines), rather than every consumer independently computing its own version of "recent transaction count" and risking definitional drift between, say, the model that was trained and the service that scores in production.

### Scaling the Design
- Rules Engine and Tier 1 ML scoring are both stateless and horizontally scaled behind the gateway's synchronous call — the actual scaling bottleneck is almost always the online feature store's read throughput, so that's the component to shard (by `userId`) and provision generously ahead of the scoring services themselves.
- Streaming feature computation scales by partitioning the Kafka topic by `userId` (ensuring all events for one user are processed in order on one partition, which matters for correct sliding-window aggregation) and scaling Flink task parallelism with partition count.
- Async deep-scoring tier can run on cheaper, more elastic infrastructure (batch/spot compute) since it has no latency SLA, decoupling its cost profile entirely from the synchronous tier's always-on, low-latency requirement.

### Failure Handling
- Feature store unavailable at scoring time: fail toward a conservative default determined by risk appetite — typically fall back to rules-only scoring (skip ML tier, don't skip fraud checking entirely) rather than either blocking all traffic or allowing all traffic blindly; log the degraded-mode decision distinctly so it can be reviewed.
- ML model serving latency spikes beyond budget: enforce a hard timeout on the synchronous ML call with a documented fallback decision (usually "fall back to rules-engine-only verdict") rather than let a slow model call cascade into checkout timeouts platform-wide — the synchronous fraud check must never become the reason checkout fails.
- Streaming feature pipeline lags (Kafka consumer lag builds up): features become stale but not wrong-shaped; scoring continues on slightly-outdated velocity counts (acceptable degradation) while alerting on the lag so it's fixed before staleness becomes severe enough to matter for real decisions.

### Trade-offs
- Tiered sync/async architecture (higher engineering complexity — multiple models, a feature store, a streaming pipeline, a case-management/labeling loop) vs. a single synchronous scoring step (simpler, but forces every model to fit an unrealistically tight latency budget, capping how sophisticated fraud detection can ever get) — the tiered approach is essentially mandatory once fraud sophistication and false-positive cost both matter, which they do at any real payments scale.
- Conservative fallback on any component failure (rules-only, never fully open or fully closed) vs. optimizing purely for uptime by failing open — for a payments company, failing toward "still do *some* fraud checking, degrade gracefully" is almost always the right call, since the cost of a fraud loss during a degraded window can be substantial and is exactly the scenario risk/compliance teams will ask about directly.

---

**Framing question, closing:** *Can I combine the building blocks appropriately instead of memorizing architectures?* Notice how few genuinely distinct primitives these twelve systems actually use — atomic conditional updates for contention (inventory, wallet, refunds), saga/compensating-transaction patterns for cross-service correctness (checkout, cross-shard transfers, booking), idempotency keys enforced as DB constraints everywhere money or state changes, geo-indexing (H3/geohash) for anything location-matching, and the append-only-ledger-plus-materialized-cache pattern for anything requiring both auditable correctness and fast reads. The systems differ in *domain*; the hard sub-problems and their solutions repeat. That repetition is the actual thing to walk into the interview room with.
