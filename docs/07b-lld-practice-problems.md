# Stage 7 (Part B) — LLD Mastery: Practice Problems
Last updated: 2026-08-27
_Overview and notes._
Last updated: 2026-08-27

> **"Can I create software that remains clean when requirements change?"**

This is the question every one of the 13 problems below is testing. An interviewer at PayPal,
Oracle, or any large enterprise doesn't care whether you can draw a `ParkingLot` class — they care
whether your `ParkingLot` survives the follow-up question "now add EV charging spots and surge
pricing" without a rewrite.

## The one rule that matters

For every problem, work in this order, every time:

1. **Requirements** — pin down the 3-5 use cases that actually matter. Say them out loud before writing a class.
2. **Entities & use cases** — nouns become classes, verbs become methods. Assign one responsibility per class (SRP from Part A).
3. **Identify what VARIES** — this is the step everyone skips and it's the only one that matters. Ask: "what is the axis along which this system will change over its life?" Pricing rules? Notification channels? Eviction policy? Vehicle types? That axis is where a pattern belongs.
4. **Apply the pattern that fits that variation** — not the pattern you memorized most recently. If nothing varies, don't add a pattern — a plain class is the correct answer and adding a `Strategy` for one implementation is over-engineering, not design skill.
5. **Class diagram**, then **code skeleton**.

**Never start from "which pattern should I use."** That question produces `FactorySingletonObserverManager` classes that solve a problem nobody has. Start from the variation, and the pattern falls out on its own — that's also how you defend your design when the interviewer pushes back.

All code below is Java, chosen for consistency across all 13 problems (matches typical PayPal/Oracle
interview conventions). Every design decision below is a *deliberate* pattern application — the
variation is identified first, in writing, before the pattern is named.

---

## Table of Contents

1. [Parking Lot](#1-parking-lot)
2. [Vending Machine](#2-vending-machine)
3. [Elevator System](#3-elevator-system)
4. [Library Management System](#4-library-management-system)
5. [ATM](#5-atm)
6. [Coffee Vending Machine](#6-coffee-vending-machine)
7. [Logger Framework](#7-logger-framework-mini-log4jslf4j)
8. [In-Memory Cache](#8-in-memory-cache-with-pluggable-eviction)
9. [Task Scheduler](#9-task-scheduler)
10. [Splitwise (Expense Sharing)](#10-splitwise-expense-sharing--debt-simplification)
11. [Chess Game](#11-chess-game)
12. [Cab Booking (LLD)](#12-cab-booking-lld)
13. [Notification Framework](#13-notification-framework)

---

## 1. Parking Lot

### Requirements
A multi-level parking lot admits motorcycles, cars, and buses; each level has a fixed count of
small/medium/large spots. On entry, a vehicle gets a ticket bound to an assigned spot; on exit, it
pays based on duration and vehicle type, and the spot frees up. The lot must report real-time
availability per level and support adding new levels without touching existing code.

### Key entities
- **ParkingLot** — the single physical facility; owns levels, orchestrates entry/exit. One per process → Singleton.
- **Level** — owns a list of `ParkingSpot`s, tracks free/occupied counts.
- **ParkingSpot** — one physical spot with a `SpotSize` and occupancy state.
- **Vehicle** (abstract) → `Motorcycle`, `Car`, `Bus` — each knows which `SpotSize` it needs.
- **Ticket** — issued at entry, carries entry time, spot, vehicle; closed at exit.
- **SpotAssignmentStrategy** — *how* a free spot is chosen for a vehicle (nearest-to-entrance, first-available, load-balanced-across-levels).
- **FeeCalculationStrategy** — *how* the bill is computed (flat-per-hour, vehicle-type-tiered, weekday/weekend).
- **EntrancePanel / ExitPanel** — the two interaction points.

### Design decisions
The thing that changes over this system's life is **not** the vehicle/spot hierarchy (three vehicle
types is a closed, stable set for the interview scope) — it's **assignment policy** and **pricing
policy**, both of which product/ops will tweak constantly ("give EVs the nearest spot," "add weekend
surge pricing"). That's the axis of variation, so it gets **Strategy** (Part A: Strategy Pattern) on
both axes, injected into `ParkingLot` at construction. `ParkingLot` itself is a **Singleton** (Part
A: Singleton Pattern) because there is exactly one lot per process and global, uncoordinated
instantiation would let two `ParkingLot`s double-book the same spot.

Deliberate simplification: `ParkingSpot` is **one concrete class parameterized by a `SpotSize`
enum**, not a `SmallSpot`/`MediumSpot`/`LargeSpot` hierarchy — spot behavior doesn't differ by size,
only a field does, so subclassing here would be inheritance used for data, not behavior (an anti-
pattern flagged in Part A). Vehicle *does* get a small hierarchy because "does this vehicle fit this
spot" is genuine polymorphic behavior.

### Class diagram
```
                     +----------------------+
                     |     ParkingLot       |<--- Singleton
                     |----------------------|
                     | -levels: List<Level> |
                     | -assignStrategy      |----------> SpotAssignmentStrategy   <<interface>>
                     | -feeStrategy         |----------> FeeCalculationStrategy   <<interface>>
                     |----------------------|                 ^          ^
                     | +parkVehicle(v)      |                 |          |
                     | +unparkVehicle(t)    |         NearestSpotStrategy  LoadBalancedStrategy
                     +----------+-----------+
                                |
                                | 1..*
                        +-------v-------+
                        |     Level     |
                        |---------------|
                        | -spots        |
                        | +findFree(sz) |
                        +-------+-------+
                                |
                                | 1..*
                        +-------v-------+
                        |  ParkingSpot  |
                        |---------------|
                        | -size: SpotSize (SMALL|MEDIUM|LARGE)
                        | -occupied: boolean
                        | -vehicle: Vehicle
                        +---------------+

    +-----------+        +-----------+       parked in       +-----------+
    |  Vehicle  |<>------|  Ticket   |----------------------->|ParkingSpot|
    | (abstract)|        |-----------|                        +-----------+
    +-----+-----+        |entryTime  |
          |              |exitTime   |
   +------+------+       +-----------+
   |      |      |
Motorcycle Car  Bus
```

### Code skeleton
```java
public enum SpotSize { SMALL, MEDIUM, LARGE }

public abstract class Vehicle {
    private final String licensePlate;
    protected Vehicle(String licensePlate) { this.licensePlate = licensePlate; }
    public abstract SpotSize requiredSpotSize();
    public String getLicensePlate() { return licensePlate; }
}
public class Motorcycle extends Vehicle {
    public Motorcycle(String plate) { super(plate); }
    public SpotSize requiredSpotSize() { return SpotSize.SMALL; }
}
public class Car extends Vehicle {
    public Car(String plate) { super(plate); }
    public SpotSize requiredSpotSize() { return SpotSize.MEDIUM; }
}
public class Bus extends Vehicle {
    public Bus(String plate) { super(plate); }
    public SpotSize requiredSpotSize() { return SpotSize.LARGE; }
}

public class ParkingSpot {
    private final String id;
    private final SpotSize size;
    private Vehicle occupant;
    public ParkingSpot(String id, SpotSize size) { this.id = id; this.size = size; }
    public boolean isFree() { return occupant == null; }
    public SpotSize getSize() { return size; }
    public void assign(Vehicle v) { this.occupant = v; }
    public void release() { this.occupant = null; }
    public String getId() { return id; }
}

// --- Strategy: assignment policy varies independently of the lot ---
public interface SpotAssignmentStrategy {
    Optional<ParkingSpot> findSpot(List<Level> levels, SpotSize required);
}
public class NearestAvailableStrategy implements SpotAssignmentStrategy {
    public Optional<ParkingSpot> findSpot(List<Level> levels, SpotSize required) {
        for (Level level : levels) {                 // levels ordered near-to-far already
            for (ParkingSpot spot : level.getSpots()) {
                if (spot.isFree() && spot.getSize() == required) return Optional.of(spot);
            }
        }
        return Optional.empty();
    }
}

// --- Strategy: pricing policy varies independently of the lot ---
public interface FeeCalculationStrategy {
    double calculateFee(Vehicle vehicle, Duration parkedDuration);
}
public class TieredHourlyFeeStrategy implements FeeCalculationStrategy {
    public double calculateFee(Vehicle vehicle, Duration parkedDuration) {
        long hours = Math.max(1, parkedDuration.toHours());
        double rate = vehicle.requiredSpotSize() == SpotSize.LARGE ? 8.0
                    : vehicle.requiredSpotSize() == SpotSize.MEDIUM ? 4.0 : 2.0;
        return hours * rate;
    }
}

public class Ticket {
    private final String id;
    private final Vehicle vehicle;
    private final ParkingSpot spot;
    private final Instant entryTime;
    private Instant exitTime;
    public Ticket(Vehicle v, ParkingSpot s) {
        this.id = UUID.randomUUID().toString();
        this.vehicle = v; this.spot = s; this.entryTime = Instant.now();
    }
    public void close() { this.exitTime = Instant.now(); }
    public Duration duration() { return Duration.between(entryTime, exitTime); }
    public Vehicle getVehicle() { return vehicle; }
    public ParkingSpot getSpot() { return spot; }
}

public class ParkingLot {
    private static ParkingLot instance;
    private final List<Level> levels = new ArrayList<>();
    private final SpotAssignmentStrategy assignmentStrategy;
    private final FeeCalculationStrategy feeStrategy;

    private ParkingLot(SpotAssignmentStrategy a, FeeCalculationStrategy f) {
        this.assignmentStrategy = a; this.feeStrategy = f;
    }
    public static synchronized ParkingLot getInstance(SpotAssignmentStrategy a, FeeCalculationStrategy f) {
        if (instance == null) instance = new ParkingLot(a, f);
        return instance;
    }
    public void addLevel(Level level) { levels.add(level); }

    public Ticket parkVehicle(Vehicle vehicle) {
        ParkingSpot spot = assignmentStrategy.findSpot(levels, vehicle.requiredSpotSize())
            .orElseThrow(() -> new IllegalStateException("Lot full for size " + vehicle.requiredSpotSize()));
        spot.assign(vehicle);
        return new Ticket(vehicle, spot);
    }

    public double unparkVehicle(Ticket ticket) {
        ticket.close();
        double fee = feeStrategy.calculateFee(ticket.getVehicle(), ticket.duration());
        ticket.getSpot().release();
        return fee;
    }
}
```

### Extension question
*"How would you add EV charging spots that also need to reserve a charger and bill for electricity used?"*

Add `EV_CHARGING` as a new `SpotSize`-adjacent attribute (or a `boolean hasCharger` flag on
`ParkingSpot`) and a `Chargeable` capability rather than a new `Vehicle` subclass hierarchy — an
`ElectricCar` is still a `Car` for sizing purposes. Introduce a new `SpotAssignmentStrategy`
implementation, `EvAwareStrategy`, that filters for `hasCharger` spots when the vehicle requests
one, and a `CompositeFeeStrategy` that adds an energy-usage component on top of the existing hourly
`FeeCalculationStrategy`. Because both assignment and pricing were already extracted behind
interfaces, this is two new classes and zero changes to `ParkingLot`, `Level`, or `Ticket` — exactly
the point of isolating the variation up front.

---

## 2. Vending Machine

### Requirements
A machine sells items from numbered slots, each with a price and stock count. A customer selects a
slot, inserts money (coins/notes, accepted incrementally), the machine dispenses the item and
change, or refunds if the item is out of stock or money is insufficient. The whole thing is
inherently a sequence of states — idle, has-money, dispensing, out-of-stock — and that sequencing is
the part that breaks if it's written as a pile of booleans.

### Key entities
- **VendingMachine** — the context; holds current `VendingState`, current balance, selected slot.
- **VendingState** (interface) → `IdleState`, `HasMoneySelectedState`, `DispensingState`, `OutOfStockState` — each defines what `selectItem`, `insertCoin`, `dispense`, `refund` mean *in that state*.
- **Slot** — item, price, quantity.
- **Inventory** — the set of slots, keyed by code (e.g. "A3").
- **CoinMechanism / ChangeDispenser** — accepts money, computes change denominations.

### Design decisions
The variation here is **behavior changing by current state**, not by a swappable algorithm —
inserting a coin means something different depending on whether the machine is idle, mid-
transaction, or jammed. That's the textbook signature of **State** (Part A: State Pattern), not
Strategy: the transitions themselves are part of the model, and each state decides which transitions
are legal. Contrast with the Cache problem below where eviction is a pure interchangeable algorithm
— that's Strategy, this is State, and confusing the two is the single most common LLD interview
mistake on this problem.

### Class diagram
```
+------------------+          +----------------------+
|  VendingMachine  |--------->|    VendingState       |<<interface>>
|------------------|  state   |----------------------|
| -state           |          | +selectItem(m,code)   |
| -balance         |          | +insertCoin(m,amt)    |
| -selectedSlot    |          | +dispense(m)          |
| -inventory       |          | +refund(m)            |
+------------------+          +-----------+-----------+
                                           |
              +---------------+-----------+-----------+----------------+
              |               |                       |                |
        IdleState  HasMoneySelectedState        DispensingState   OutOfStockState

+-----------+       +---------+
| Inventory |------>|  Slot   |
|-----------|  1..* |---------|
| +get(code)|       | price   |
+-----------+       | qty     |
                     | item   |
                     +---------+
```

### Code skeleton
```java
public interface VendingState {
    void selectItem(VendingMachine m, String code);
    void insertCoin(VendingMachine m, int cents);
    void dispense(VendingMachine m);
    void refund(VendingMachine m);
}

public class IdleState implements VendingState {
    public void selectItem(VendingMachine m, String code) {
        Slot slot = m.getInventory().get(code);
        if (slot.getQuantity() == 0) { m.setState(new OutOfStockState()); return; }
        m.setSelectedSlot(slot);
        m.setState(new HasMoneySelectedState());
    }
    public void insertCoin(VendingMachine m, int cents) { throw new IllegalStateException("Select an item first"); }
    public void dispense(VendingMachine m) { throw new IllegalStateException("Nothing selected"); }
    public void refund(VendingMachine m) { /* no-op, nothing to refund */ }
}

public class HasMoneySelectedState implements VendingState {
    public void selectItem(VendingMachine m, String code) { throw new IllegalStateException("Already selecting"); }
    public void insertCoin(VendingMachine m, int cents) {
        m.addBalance(cents);
        if (m.getBalance() >= m.getSelectedSlot().getPrice()) m.setState(new DispensingState());
    }
    public void dispense(VendingMachine m) { throw new IllegalStateException("Insufficient funds"); }
    public void refund(VendingMachine m) {
        m.returnChange(m.getBalance());
        m.reset();
    }
}

public class DispensingState implements VendingState {
    public void selectItem(VendingMachine m, String code) { /* ignored mid-dispense */ }
    public void insertCoin(VendingMachine m, int cents) { m.addBalance(cents); /* extra money added to change */ }
    public void dispense(VendingMachine m) {
        Slot slot = m.getSelectedSlot();
        slot.decrementQuantity();
        int change = m.getBalance() - slot.getPrice();
        m.returnChange(change);
        m.reset();
    }
    public void refund(VendingMachine m) { dispense(m); /* money already committed, deliver + change */ }
}

public class OutOfStockState implements VendingState {
    public void selectItem(VendingMachine m, String code) { m.setState(new IdleState()); m.getState().selectItem(m, code); }
    public void insertCoin(VendingMachine m, int cents) { m.returnChange(cents); }
    public void dispense(VendingMachine m) { /* nothing to dispense */ }
    public void refund(VendingMachine m) { m.returnChange(m.getBalance()); m.reset(); }
}

public class VendingMachine {
    private VendingState state = new IdleState();
    private int balance = 0;
    private Slot selectedSlot;
    private final Inventory inventory = new Inventory();

    public void selectItem(String code) { state.selectItem(this, code); }
    public void insertCoin(int cents) { state.insertCoin(this, cents); }
    public void dispense() { state.dispense(this); }
    public void refund() { state.refund(this); }

    void setState(VendingState s) { this.state = s; }
    VendingState getState() { return state; }
    void addBalance(int c) { balance += c; }
    int getBalance() { return balance; }
    void setSelectedSlot(Slot s) { selectedSlot = s; }
    Slot getSelectedSlot() { return selectedSlot; }
    Inventory getInventory() { return inventory; }
    void returnChange(int cents) { System.out.println("Returning " + cents + " cents"); }
    void reset() { balance = 0; selectedSlot = null; state = new IdleState(); }
}
```

### Extension question
*"How would you add support for card payments alongside coins?"*

`insertCoin` is really "add tendered funds" — generalize it to a `PaymentMethod` interface
(`CoinPayment`, `CardPayment`) that each resolve to a credited amount, and have
`HasMoneySelectedState` call `m.addBalance(paymentMethod.charge(...))` instead of taking a raw
`int`. States don't change at all — they don't care *how* money arrived, only *how much* and *when*
the threshold is crossed — which is exactly the payoff of having isolated state transitions from
payment mechanics in the first design pass.

---

## 3. Elevator System

### Requirements
A building has N elevators serving M floors. Users request an elevator from a floor (up/down) and,
once inside, select a destination floor. A central controller must decide which elevator answers
each hall call, and each elevator must decide the order in which it services its own queued stops
(it should not reverse direction mid-run if avoidable — the classic SCAN/LOOK behavior).

### Key entities
- **ElevatorController** — receives hall calls, picks an elevator (dispatch policy).
- **Elevator** — has current floor, `Direction`, a request queue, and a `Door`.
- **ElevatorSelectionStrategy** — *which* elevator answers a given hall call (nearest-car, least-busy, zone-based).
- **SchedulingStrategy** (per elevator) — *in what order* it visits its queued floors (SCAN/LOOK vs FCFS).
- **Request** — a hall call (`floor`, `direction`) or a car call (`destinationFloor`).
- **Door**, **Display**, **Button** — supporting UI-facing objects.

### Design decisions
Two independent axes vary here, so two Strategies (Part A: Strategy Pattern), not one: (1)
**dispatch** — which elevator gets a given call, a building-ops decision that changes with traffic
patterns and floor zoning; (2) **intra-car scheduling** — the order an elevator services its own
stops, which is an algorithmic concern (SCAN vs FCFS) independent of dispatch. Keeping them as two
separate interfaces means you can A/B test a new dispatch algorithm without touching how any single
elevator sequences its stops. `ElevatorController` also plays **Observer** (Part A: Observer
Pattern) implicitly — elevators publish state changes (arrived at floor, door opened) that the
controller/display subscribes to, decoupling "an elevator did something" from "who needs to know."

### Class diagram
```
+---------------------+        1        +------------------+
|  ElevatorController |----------------->| DispatchStrategy |<<interface>>
|----------------------|                 +--------+---------+
| -elevators: List     |                          |
| -dispatchStrategy     |                 NearestCarStrategy
| +requestElevator(f,d)|
+----------+-----------+
           | 1..*
     +-----v------+          1        +--------------------+
     |  Elevator  |------------------->| SchedulingStrategy |<<interface>>
     |------------|                    +---------+----------+
     | -currentFloor       |                     |
     | -direction          |               LookSchedulingStrategy
     | -stopQueue          |
     | -door: Door         |
     | +addStop(floor)     |
     | +step()             |
     +---------------------+
```

### Code skeleton
```java
public enum Direction { UP, DOWN, IDLE }

public interface DispatchStrategy {
    Elevator selectElevator(List<Elevator> elevators, int floor, Direction requested);
}
public class NearestCarStrategy implements DispatchStrategy {
    public Elevator selectElevator(List<Elevator> elevators, int floor, Direction requested) {
        return elevators.stream()
            .filter(e -> e.canServe(floor, requested))
            .min(Comparator.comparingInt(e -> Math.abs(e.getCurrentFloor() - floor)))
            .orElse(elevators.get(0)); // fallback: least-loaded, kept simple here
    }
}

public interface SchedulingStrategy {
    Integer nextStop(TreeSet<Integer> upStops, TreeSet<Integer> downStops, int currentFloor, Direction dir);
}
// LOOK: keep moving in current direction until no more requests that way, then flip
public class LookSchedulingStrategy implements SchedulingStrategy {
    public Integer nextStop(TreeSet<Integer> upStops, TreeSet<Integer> downStops, int currentFloor, Direction dir) {
        if (dir == Direction.UP) {
            Integer next = upStops.ceiling(currentFloor);
            if (next != null) return next;
            return downStops.isEmpty() ? null : downStops.last();
        } else {
            Integer next = downStops.floor(currentFloor);
            if (next != null) return next;
            return upStops.isEmpty() ? null : upStops.first();
        }
    }
}

public class Elevator {
    private final int id;
    private int currentFloor = 0;
    private Direction direction = Direction.IDLE;
    private final TreeSet<Integer> upStops = new TreeSet<>();
    private final TreeSet<Integer> downStops = new TreeSet<>();
    private final SchedulingStrategy scheduler;

    public Elevator(int id, SchedulingStrategy scheduler) { this.id = id; this.scheduler = scheduler; }

    public boolean canServe(int floor, Direction requested) {
        return direction == Direction.IDLE || direction == requested;
    }
    public void addStop(int floor) {
        if (floor >= currentFloor) upStops.add(floor); else downStops.add(floor);
        if (direction == Direction.IDLE) direction = floor >= currentFloor ? Direction.UP : Direction.DOWN;
    }
    public void step() { // advance one floor toward next scheduled stop
        Integer target = scheduler.nextStop(upStops, downStops, currentFloor, direction);
        if (target == null) { direction = Direction.IDLE; return; }
        currentFloor += Integer.compare(target, currentFloor);
        if (currentFloor == target) { upStops.remove(target); downStops.remove(target); openDoor(); }
    }
    private void openDoor() { System.out.println("Elevator " + id + " door open at floor " + currentFloor); }
    public int getCurrentFloor() { return currentFloor; }
}

public class ElevatorController {
    private final List<Elevator> elevators;
    private final DispatchStrategy dispatchStrategy;
    public ElevatorController(List<Elevator> elevators, DispatchStrategy strategy) {
        this.elevators = elevators; this.dispatchStrategy = strategy;
    }
    public void requestElevator(int floor, Direction direction) {
        Elevator chosen = dispatchStrategy.selectElevator(elevators, floor, direction);
        chosen.addStop(floor);
    }
}
```

### Extension question
*"How would you add priority service for a VIP floor (e.g., an executive floor that should always be served within 30 seconds)?"*

Add a `PriorityDispatchStrategy` decorator around the existing `DispatchStrategy` (Part A: Decorator
Pattern) that checks if the requested floor is in a `Set\<Integer> priorityFloors` and, if so, force-
reroutes the nearest idle-or-same-direction car regardless of the base strategy's score; otherwise
it delegates to the wrapped strategy unchanged. No change to `Elevator` or `ElevatorController` —
the controller still just calls `dispatchStrategy.selectElevator(...)`, unaware it's now wrapped.

---

## 4. Library Management System

### Requirements
A library catalogs books (possibly multiple copies of the same title), lets members search and check
out/return copies, enforces a max-checkout limit and due dates, and charges overdue fines. Members
can also place holds on currently-unavailable titles.

### Key entities
- **Book** — the title-level metadata (ISBN, author, title).
- **BookCopy** — one physical/loanable copy of a `Book`, with its own status (`AVAILABLE`, `LOANED`, `RESERVED`, `LOST`).
- **Member** — has a checkout history and a hold list, subject to a `MembershipPolicy` (max books, loan period — these differ for student vs faculty vs regular members).
- **Loan** — a checkout record (copy, member, checkoutDate, dueDate).
- **Hold** — a reservation on a title, fulfilled FIFO when a copy frees up.
- **FineCalculationStrategy** — overdue fine computation.
- **Catalog** — search index over books.
- **LibrarySystem** — facade coordinating checkout/return/hold flows.

### Design decisions
The variation is **membership tier rules** (a student gets 5 books for 14 days, faculty gets 20
books for 60 days) and **fine calculation** (flat-per-day vs capped-per-title) — both are policy,
both change without touching checkout logic. That's **Strategy** on two independent interfaces
(`MembershipPolicy`, `FineCalculationStrategy`), same reasoning as the Parking Lot problem.
Separately, when a `BookCopy` is returned and a hold exists, the natural pending-holds queue is best
modeled with **Observer**: `BookCopy` notifies interested parties ("this title just became
available") rather than `LibrarySystem` polling copy status after every return — this keeps
`LibrarySystem` from needing to know about the holds subsystem's internals.

### Class diagram
```
+-----------+ 1     * +-----------+          +------------------+
|   Book    |-------->| BookCopy  |--------->| CopyStatus (enum)|
+-----------+         +-----+-----+          +------------------+
                              ^
                              | notifies on return
                    +---------+----------+
                    |   HoldQueue        | (Observer of BookCopy)
                    +--------------------+

+-----------+          +--------------------+          +-------------------------+
|  Member   |--------->| MembershipPolicy   |<<iface>> | StudentPolicy/FacultyPolicy|
+-----------+          +--------------------+          +-------------------------+

+-----------+          +---------------------------+
|   Loan    |--------->| FineCalculationStrategy   |<<interface>>
+-----------+          +---------------------------+
                                    |
                          FlatDailyFineStrategy

+----------------+
| LibrarySystem  |  (facade: checkout(), returnCopy(), placeHold())
+----------------+
```

### Code skeleton
```java
public enum CopyStatus { AVAILABLE, LOANED, RESERVED, LOST }

public class BookCopy {
    private final String copyId;
    private final Book book;
    private CopyStatus status = CopyStatus.AVAILABLE;
    private final List<HoldObserver> observers = new ArrayList<>();

    public BookCopy(String id, Book book) { this.copyId = id; this.book = book; }
    public void subscribe(HoldObserver o) { observers.add(o); }
    public void markReturned() {
        status = CopyStatus.AVAILABLE;
        observers.forEach(o -> o.onCopyAvailable(this)); // Observer: decouple return from hold fulfillment
    }
    public void markLoaned() { status = CopyStatus.LOANED; }
    public CopyStatus getStatus() { return status; }
    public Book getBook() { return book; }
    public String getCopyId() { return copyId; }
}
public interface HoldObserver { void onCopyAvailable(BookCopy copy); }

public interface MembershipPolicy {
    int maxCheckouts();
    int loanPeriodDays();
}
public class StudentPolicy implements MembershipPolicy {
    public int maxCheckouts() { return 5; }
    public int loanPeriodDays() { return 14; }
}
public class FacultyPolicy implements MembershipPolicy {
    public int maxCheckouts() { return 20; }
    public int loanPeriodDays() { return 60; }
}

public interface FineCalculationStrategy { double calculateFine(Loan loan); }
public class FlatDailyFineStrategy implements FineCalculationStrategy {
    private static final double RATE_PER_DAY = 0.50;
    public double calculateFine(Loan loan) {
        long overdueDays = Math.max(0, ChronoUnit.DAYS.between(loan.getDueDate(), LocalDate.now()));
        return overdueDays * RATE_PER_DAY;
    }
}

public class Member {
    private final String id;
    private final MembershipPolicy policy;
    private final List<Loan> activeLoans = new ArrayList<>();
    public Member(String id, MembershipPolicy policy) { this.id = id; this.policy = policy; }
    public boolean canCheckout() { return activeLoans.size() < policy.maxCheckouts(); }
    public void addLoan(Loan loan) { activeLoans.add(loan); }
    public LocalDate computeDueDate() { return LocalDate.now().plusDays(policy.loanPeriodDays()); }
}

public class Loan {
    private final BookCopy copy;
    private final Member member;
    private final LocalDate checkoutDate = LocalDate.now();
    private final LocalDate dueDate;
    public Loan(BookCopy copy, Member member, LocalDate dueDate) {
        this.copy = copy; this.member = member; this.dueDate = dueDate;
    }
    public LocalDate getDueDate() { return dueDate; }
}

public class LibrarySystem {
    private final FineCalculationStrategy fineStrategy;
    public LibrarySystem(FineCalculationStrategy fineStrategy) { this.fineStrategy = fineStrategy; }

    public Loan checkout(Member member, BookCopy copy) {
        if (!member.canCheckout()) throw new IllegalStateException("Checkout limit reached");
        if (copy.getStatus() != CopyStatus.AVAILABLE) throw new IllegalStateException("Copy not available");
        copy.markLoaned();
        Loan loan = new Loan(copy, member, member.computeDueDate());
        member.addLoan(loan);
        return loan;
    }

    public double returnCopy(Loan loan) {
        double fine = fineStrategy.calculateFine(loan);
        loan.getCopy() /* pseudo: real code stores copy ref in Loan */ ;
        return fine;
    }
}
```

### Extension question
*"How would you support e-books with concurrent digital lending limits (e.g., 3 simultaneous e-book loans per license)?"*

Model `EBookCopy` as a sibling of `BookCopy` implementing a shared `Loanable` interface
(`checkout()`, `returnItem()`, `getStatus()`), where an e-book "copy" is really a license slot
decremented/incremented instead of a single physical item. `LibrarySystem.checkout` already operates
against the abstraction it's given, so it takes a `Loanable` instead of a concrete `BookCopy` — one
interface extraction, no change to `Member`, `MembershipPolicy`, or `FineCalculationStrategy`
(e-books just get their own no-op or reduced fine strategy instance).

---

## 5. ATM

### Requirements
An ATM authenticates a card+PIN, then supports balance inquiry, cash withdrawal (dispensed in
available denominations, subject to per-transaction and daily limits), and deposit. The interaction
is a strict sequence — card inserted → PIN entered → menu → transaction → card ejected — where each
step only allows specific next actions.

### Key entities
- **ATM** — the context; holds current `ATMState`, cash inventory.
- **ATMState** (interface) → `IdleState`, `HasCardState`, `AuthenticatedState`, `TransactionState`, `OutOfServiceState`.
- **Account**, **Card** — bank-side data (balance, PIN hash, daily withdrawal used).
- **CashDispenser** — inventory of denominations; computes minimal-notes dispensing.
- **BankService** (interface) — remote authorization boundary (auth PIN, debit account) — the ATM never touches the ledger directly, only through this port.
- **Transaction** — record of the operation performed.

### Design decisions
Exactly like the Vending Machine, an ATM's behavior is gated by **where it is in a fixed sequence**
— you cannot withdraw cash before authenticating, cannot re-authenticate with a card still mid-
transaction. That's **State** (Part A: State Pattern) again, and it's worth explicitly telling the
interviewer *why* it's State and not a `switch` on an enum: each state needs to reject a different
subset of operations and transition differently, and a `switch` scatters that logic at every call
site instead of colocating it per state. `CashDispenser`'s minimal-notes-for-amount computation is a
pure algorithm with **no variation named in these requirements**, so it stays a plain method — no
Strategy is manufactured for it (adding one would be exactly the kind of speculative flexibility the
framing question up top is against). `BankService` is a boundary interface so the ATM's state
machine can be tested without a real bank — that's dependency inversion, not a "pattern" per se, but
the same isolation instinct.

### Class diagram
```
+---------+        +---------------+
|   ATM   |------->|   ATMState    |<<interface>>
|---------|        +-------+-------+
|-state   |                |
|-cash    |     +----------+-----------+----------------+
|-bank    |     |          |            |                |
+---------+  Idle    HasCard   Authenticated       Transaction

+----------------+        +----------------+
| CashDispenser  |        |  BankService   |<<interface>>
|----------------|        +----------------+
|+dispense(amt)  |               |
+----------------+          RealBankService (RPC to core banking)
```

### Code skeleton
```java
public interface BankService {
    boolean authenticate(String cardNumber, String pin);
    double getBalance(String cardNumber);
    void debit(String cardNumber, double amount);
    void credit(String cardNumber, double amount);
}

public interface ATMState {
    void insertCard(ATM atm, String cardNumber);
    void enterPin(ATM atm, String pin);
    void selectWithdraw(ATM atm, double amount);
    void ejectCard(ATM atm);
}

public class IdleState implements ATMState {
    public void insertCard(ATM atm, String cardNumber) {
        atm.setCurrentCard(cardNumber);
        atm.setState(new HasCardState());
    }
    public void enterPin(ATM atm, String pin) { throw new IllegalStateException("Insert card first"); }
    public void selectWithdraw(ATM atm, double amount) { throw new IllegalStateException("Insert card first"); }
    public void ejectCard(ATM atm) { /* no-op */ }
}

public class HasCardState implements ATMState {
    public void insertCard(ATM atm, String cardNumber) { throw new IllegalStateException("Card already inserted"); }
    public void enterPin(ATM atm, String pin) {
        if (atm.getBank().authenticate(atm.getCurrentCard(), pin)) atm.setState(new AuthenticatedState());
        else atm.ejectCard();
    }
    public void selectWithdraw(ATM atm, double amount) { throw new IllegalStateException("Enter PIN first"); }
    public void ejectCard(ATM atm) { atm.reset(); }
}

public class AuthenticatedState implements ATMState {
    public void insertCard(ATM atm, String cardNumber) { throw new IllegalStateException("Already authenticated"); }
    public void enterPin(ATM atm, String pin) { throw new IllegalStateException("Already authenticated"); }
    public void selectWithdraw(ATM atm, double amount) {
        double balance = atm.getBank().getBalance(atm.getCurrentCard());
        if (amount > balance) throw new IllegalArgumentException("Insufficient funds");
        if (!atm.getDispenser().canDispense(amount)) throw new IllegalStateException("ATM cannot dispense this amount");
        atm.getBank().debit(atm.getCurrentCard(), amount);
        atm.getDispenser().dispense(amount);
        atm.setState(new TransactionState());
    }
    public void ejectCard(ATM atm) { atm.reset(); }
}

public class TransactionState implements ATMState {
    public void insertCard(ATM atm, String cardNumber) { throw new IllegalStateException("Finish transaction first"); }
    public void enterPin(ATM atm, String pin) { throw new IllegalStateException("Finish transaction first"); }
    public void selectWithdraw(ATM atm, double amount) { throw new IllegalStateException("Complete or eject first"); }
    public void ejectCard(ATM atm) { atm.reset(); }
}

public class CashDispenser {
    private final Map<Integer, Integer> denominationCounts; // e.g. {100:5, 20:10, 10:20}
    public CashDispenser(Map<Integer, Integer> stock) { this.denominationCounts = stock; }
    public boolean canDispense(double amount) { return amount % 10 == 0; } // simplified check
    public void dispense(double amount) {
        int remaining = (int) amount;
        for (int denom : new int[]{100, 50, 20, 10}) {
            int available = denominationCounts.getOrDefault(denom, 0);
            int use = Math.min(available, remaining / denom);
            remaining -= use * denom;
            denominationCounts.put(denom, available - use);
        }
        if (remaining != 0) throw new IllegalStateException("Cannot make exact change with current inventory");
    }
}

public class ATM {
    private ATMState state = new IdleState();
    private String currentCard;
    private final CashDispenser dispenser;
    private final BankService bank;
    public ATM(CashDispenser d, BankService b) { this.dispenser = d; this.bank = b; }

    public void insertCard(String card) { state.insertCard(this, card); }
    public void enterPin(String pin) { state.enterPin(this, pin); }
    public void withdraw(double amt) { state.selectWithdraw(this, amt); }
    public void ejectCard() { state.ejectCard(this); }

    void setState(ATMState s) { state = s; }
    void setCurrentCard(String c) { currentCard = c; }
    String getCurrentCard() { return currentCard; }
    CashDispenser getDispenser() { return dispenser; }
    BankService getBank() { return bank; }
    void reset() { currentCard = null; state = new IdleState(); }
}
```

### Extension question
*"How would you add a daily withdrawal limit shared across all ATMs for a given card?"*

This is a state-*sharing* concern, not a state-*machine* concern, so it doesn't touch the `ATMState`
hierarchy at all — push it into `BankService`: `debit()` becomes responsible for checking and
updating a per-card daily-used counter server-side (the source of truth must be centralized since
multiple ATMs share the same account), and `AuthenticatedState.selectWithdraw` just propagates
whatever exception `bank.debit()` throws when the limit is exceeded. This is exactly why
`BankService` was made a boundary interface up front — the limit is core-banking business logic, not
ATM hardware logic, and the two must not be conflated.

---

## 6. Coffee Vending Machine

### Requirements
A machine brews multiple beverages (espresso, latte, cappuccino, black coffee), each requiring
different quantities of ingredients (water, milk, coffee beans, sugar) from shared, finite tanks.
Selecting a drink that lacks sufficient ingredients must fail clearly; a machine operator can refill
tanks; new beverage recipes should be addable without changing the brewing engine.

### Key entities
- **CoffeeMachine** — orchestrates tank state + recipe execution.
- **IngredientTank** (per ingredient) — current quantity, refill, capacity.
- **Recipe** — named beverage, map of ingredient → quantity required.
- **Beverage** (abstract, or just `Recipe` instances) — represents what recipes produce.
- **RecipeFactory** — turns a "make me a latte" request into the right `Recipe`, so new drinks are configuration, not new code paths.
- **DispenseUnit** — actually depletes tanks and outputs the drink.

### Design decisions
This problem is deceptively similar to Vending Machine #2, but the axis of variation here is **not**
sequencing — it's "what set of ingredients does a given drink consume," which is closed, data-driven
variation. The clean fit is **Factory Method / simple factory** (Part A: Factory Pattern) to produce
`Recipe` objects by name, so `CoffeeMachine` never has an `if (drink.equals("latte"))` ladder —
adding oat-milk latte is a new `Recipe` registered in the factory's table, not a new branch in the
brewing method. `Recipe` validation-then-consumption against `IngredientTank`s is a **Template
Method**-shaped flow (check availability → deduct → brew) that stays identical across all drinks —
one method in `CoffeeMachine`, parameterized by the `Recipe` data, rather than duplicated per drink
type. No State pattern is needed here because there's no multi-step external interaction sequence
like the ATM/Vending problems — it's a single request/response action, so resist the urge to force-
fit State just because it worked for #2 and #5.

### Class diagram
```
+------------------+        +------------------+
|  CoffeeMachine   |------->|  RecipeFactory   |
|------------------|        |------------------|
| -tanks: Map      |        | +getRecipe(name) |
| -recipeFactory   |        +---------+--------+
| +brew(name)      |                  |
+------------------+          produces v
        |                    +------------------+
        | 1..*               |     Recipe       |
        v                     |------------------|
+------------------+          | name             |
| IngredientTank   |<---------| ingredients: Map<Ingredient,Integer> |
|------------------|          +------------------+
| ingredient       |
| quantity         |
| capacity         |
| +refill(amt)     |
+------------------+
```

### Code skeleton
```java
public enum Ingredient { WATER, MILK, COFFEE_BEANS, SUGAR }

public class IngredientTank {
    private final Ingredient type;
    private int quantity;
    private final int capacity;
    public IngredientTank(Ingredient type, int capacity) { this.type = type; this.capacity = capacity; this.quantity = capacity; }
    public boolean has(int amount) { return quantity >= amount; }
    public void consume(int amount) { quantity -= amount; }
    public void refill(int amount) { quantity = Math.min(capacity, quantity + amount); }
    public Ingredient getType() { return type; }
}

public class Recipe {
    private final String name;
    private final Map<Ingredient, Integer> requirements;
    public Recipe(String name, Map<Ingredient, Integer> requirements) {
        this.name = name; this.requirements = requirements;
    }
    public String getName() { return name; }
    public Map<Ingredient, Integer> getRequirements() { return requirements; }
}

// Factory: adding a new drink = one new entry, zero new branching logic elsewhere
public class RecipeFactory {
    private final Map<String, Recipe> catalog = new HashMap<>();
    public RecipeFactory() {
        catalog.put("espresso", new Recipe("espresso", Map.of(Ingredient.WATER, 30, Ingredient.COFFEE_BEANS, 18)));
        catalog.put("latte", new Recipe("latte", Map.of(Ingredient.WATER, 30, Ingredient.MILK, 150, Ingredient.COFFEE_BEANS, 18)));
        catalog.put("cappuccino", new Recipe("cappuccino", Map.of(Ingredient.WATER, 30, Ingredient.MILK, 100, Ingredient.COFFEE_BEANS, 18)));
        catalog.put("black_coffee", new Recipe("black_coffee", Map.of(Ingredient.WATER, 200, Ingredient.COFFEE_BEANS, 12)));
    }
    public Recipe getRecipe(String name) {
        Recipe r = catalog.get(name);
        if (r == null) throw new NoSuchElementException("Unknown beverage: " + name);
        return r;
    }
    public void registerRecipe(Recipe r) { catalog.put(r.getName(), r); } // extension point
}

public class CoffeeMachine {
    private final Map<Ingredient, IngredientTank> tanks;
    private final RecipeFactory recipeFactory;

    public CoffeeMachine(Map<Ingredient, IngredientTank> tanks, RecipeFactory factory) {
        this.tanks = tanks; this.recipeFactory = factory;
    }

    // Template-shaped flow: check -> deduct -> brew, identical for every recipe
    public String brew(String beverageName) {
        Recipe recipe = recipeFactory.getRecipe(beverageName);
        for (var entry : recipe.getRequirements().entrySet()) {
            IngredientTank tank = tanks.get(entry.getKey());
            if (tank == null || !tank.has(entry.getValue())) {
                throw new IllegalStateException("Insufficient " + entry.getKey() + " for " + beverageName);
            }
        }
        recipe.getRequirements().forEach((ingredient, qty) -> tanks.get(ingredient).consume(qty));
        return "Dispensing " + beverageName;
    }

    public void refill(Ingredient ingredient, int amount) { tanks.get(ingredient).refill(amount); }
}
```

### Extension question
*"How would you support a 'custom drink' mode where a user picks their own sugar/milk levels at the kiosk?"*

Add a `RecipeBuilder` (Part A: Builder Pattern) that lets the UI layer accumulate ingredient choices
step by step (`.water(30).milk(120).sugar(2).build()`) and produces a `Recipe` object on the fly —
`CoffeeMachine.brew` doesn't care whether a `Recipe` came from the factory's static catalog or a
builder, since it only depends on the `Recipe` interface/shape. This is why `Recipe` was kept as
plain data rather than something baked into `RecipeFactory` — decoupling recipe *construction* from
recipe *consumption* is what makes the custom-drink feature additive.

---

## 7. Logger Framework (mini Log4j/SLF4J)

### Requirements
Application code logs messages at a severity level (`DEBUG`, `INFO`, `WARN`, `ERROR`); the framework
filters by a configured minimum level, formats each message, and writes it to one or more
destinations (console, file, network) — all configurable per-logger without recompiling application
code. Adding a new destination or format later must not require touching call sites like
`logger.info("...")`.

### Key entities
- **Logger** — the facade application code calls (`debug/info/warn/error`).
- **LogLevel** — ordered enum, drives filtering.
- **LogMessage** — level, timestamp, message, logger name, thread — the immutable unit passed downstream.
- **LogFormatter** (interface) — turns a `LogMessage` into a `String` (plain, JSON, pattern-based).
- **LogAppender** (interface) — writes a formatted message somewhere (`ConsoleAppender`, `FileAppender`, `NetworkAppender`) — can chain multiple.
- **LoggerConfig / LoggerFactory** — resolves a named logger to its level + appenders (often hierarchical, like real Log4j, but a flat map is enough for interview scope).

### Design decisions
Two independent things vary: **where output goes** (console vs file vs network) and **how it's
formatted** (plain text vs JSON vs pattern) — that's two orthogonal Strategy interfaces (Part A:
Strategy Pattern), `LogAppender` and `LogFormatter`, composed rather than combined into one, so a
`FileAppender` can use either formatter without a `FileJsonAppender`/`FilePlainAppender` class
explosion. A single log call fanning out to *multiple* appenders (console **and** file **and** a
remote sink, simultaneously) is naturally **Observer** (Part A: Observer Pattern) — `Logger` doesn't
call one destination, it notifies all registered appenders that a message occurred, and each decides
independently whether/how to persist it. `LoggerFactory` returning the same configured `Logger`
instance per name is a lightweight **Singleton**-per-key (registry pattern) so
`getLogger("com.paypal.Service")` from two call sites shares config.

### Class diagram
```
+---------------+         +------------------+
| LoggerFactory |-------->|     Logger        |
| (registry)    |  1..*   |------------------|
+---------------+         | -name             |
                          | -minLevel         |
                          | -appenders: List  |----------> LogAppender  <<interface>>
                          | +info(msg)        |               ^   ^   ^
                          | +log(level,msg)   |               |   |   |
                          +------------------+       Console  File  Network
                                                       Appender Appender Appender
                                                          |
                                                          | uses
                                                          v
                                                  +------------------+
                                                  |  LogFormatter    |<<interface>>
                                                  +------------------+
                                                     ^          ^
                                              PlainTextFormatter  JsonFormatter
```

### Code skeleton
```java
public enum LogLevel { DEBUG, INFO, WARN, ERROR }

public class LogMessage {
    final LogLevel level; final String loggerName; final String text; final Instant time = Instant.now();
    public LogMessage(LogLevel level, String loggerName, String text) {
        this.level = level; this.loggerName = loggerName; this.text = text;
    }
}

public interface LogFormatter { String format(LogMessage msg); }
public class PlainTextFormatter implements LogFormatter {
    public String format(LogMessage m) { return "[%s] %s %s - %s".formatted(m.time, m.level, m.loggerName, m.text); }
}
public class JsonFormatter implements LogFormatter {
    public String format(LogMessage m) {
        return "{\"time\":\"%s\",\"level\":\"%s\",\"logger\":\"%s\",\"msg\":\"%s\"}"
            .formatted(m.time, m.level, m.loggerName, m.text);
    }
}

public interface LogAppender { void append(LogMessage msg); }
public class ConsoleAppender implements LogAppender {
    private final LogFormatter formatter;
    public ConsoleAppender(LogFormatter f) { this.formatter = f; }
    public void append(LogMessage msg) { System.out.println(formatter.format(msg)); }
}
public class FileAppender implements LogAppender {
    private final LogFormatter formatter;
    private final String path;
    public FileAppender(String path, LogFormatter f) { this.path = path; this.formatter = f; }
    public void append(LogMessage msg) {
        try (var writer = new FileWriter(path, true)) {
            writer.write(formatter.format(msg) + System.lineSeparator());
        } catch (IOException e) { throw new UncheckedIOException(e); }
    }
}

// Logger = context that filters by level then fans out to every appender (Observer-style notify)
public class Logger {
    private final String name;
    private final LogLevel minLevel;
    private final List<LogAppender> appenders;

    Logger(String name, LogLevel minLevel, List<LogAppender> appenders) {
        this.name = name; this.minLevel = minLevel; this.appenders = appenders;
    }

    public void log(LogLevel level, String text) {
        if (level.ordinal() < minLevel.ordinal()) return; // filtered out, cheapest possible check first
        LogMessage msg = new LogMessage(level, name, text);
        for (LogAppender appender : appenders) appender.append(msg); // fan-out, Observer-shaped
    }
    public void debug(String t) { log(LogLevel.DEBUG, t); }
    public void info(String t)  { log(LogLevel.INFO, t); }
    public void warn(String t)  { log(LogLevel.WARN, t); }
    public void error(String t) { log(LogLevel.ERROR, t); }
}

public class LoggerFactory {
    private static final Map<String, Logger> registry = new ConcurrentHashMap<>();
    private static LogLevel defaultLevel = LogLevel.INFO;
    private static List<LogAppender> defaultAppenders = List.of(new ConsoleAppender(new PlainTextFormatter()));

    public static Logger getLogger(String name) {
        return registry.computeIfAbsent(name, n -> new Logger(n, defaultLevel, defaultAppenders));
    }
    public static void configure(LogLevel level, List<LogAppender> appenders) {
        defaultLevel = level; defaultAppenders = appenders; registry.clear();
    }
}
```

### Extension question
*"How would you add async logging so slow appenders (e.g., network) don't block the calling thread?"*

Wrap the existing appender list in a single `AsyncAppender implements LogAppender` that holds an
internal `BlockingQueue\<LogMessage>` plus a background thread draining it into the real appenders —
`Logger.log` still just calls `appender.append(msg)` on what it thinks is one appender, unaware it
now returns immediately. This is a **Decorator** applied to `LogAppender` (Part A: Decorator
Pattern), and it's only possible cleanly because appenders were already behind an interface rather
than hardcoded into `Logger`.

---

## 8. In-Memory Cache (with pluggable eviction)

### Requirements
A fixed-capacity key-value cache supports `get`/`put` in O(1) average time and, when full, evicts an
entry according to a configurable policy (LRU, LFU, FIFO) chosen at construction time — swapping the
policy must not require changing `Cache`'s public API or callers.

### Key entities
- **Cache\<K,V>** — public API (`get`, `put`, `size`), owns the backing store and delegates eviction decisions.
- **EvictionPolicy\<K>** (interface) — `recordAccess(key)`, `recordInsertion(key)`, `evictionCandidate()` — the *only* thing that varies.
- **LruEvictionPolicy**, **LfuEvictionPolicy**, **FifoEvictionPolicy** — concrete algorithms.
- (Optional) **CacheEntry\<V>** — value + metadata if a policy needs it (e.g., frequency count for LFU), though most policies can keep their own bookkeeping internally rather than polluting the entry.

### Design decisions
This is the canonical **Strategy pattern** (Part A: Strategy Pattern) problem — the prompt literally
names the variation for you: eviction policy. The discipline worth demonstrating to an interviewer
is keeping `Cache` **completely ignorant** of *how* a policy decides what to evict; `Cache` only
knows the `EvictionPolicy` contract (record an access, record an insertion, ask for a candidate to
evict). This means LRU can be backed by a `LinkedHashMap`-style doubly-linked list, LFU by a
frequency-bucketed structure, and FIFO by a plain queue — three totally different internal data
structures — without `Cache` or its callers ever noticing. Resist adding a `CacheBuilder` or
`EvictionPolicyFactory` here unless the interviewer specifically asks for dynamic policy selection
by string name — for a fixed, compile-time-known policy, constructor injection is sufficient and a
factory would be unrequested ceremony.

### Class diagram
```
+------------------+         1        +---------------------+
|    Cache<K,V>    |------------------>|  EvictionPolicy<K>  |<<interface>>
|------------------|                   |----------------------|
| -capacity        |                   | +recordAccess(k)     |
| -store: Map<K,V> |                   | +recordInsertion(k)  |
| -policy          |                   | +evictionCandidate() |
| +get(k): V       |                   | +remove(k)           |
| +put(k,v)        |                   +----------+-----------+
+------------------+                              |
                              +-------------------+-------------------+
                              |                   |                   |
                     LruEvictionPolicy  LfuEvictionPolicy    FifoEvictionPolicy
```

### Code skeleton
```java
public interface EvictionPolicy<K> {
    void recordInsertion(K key);
    void recordAccess(K key);
    void remove(K key);
    K evictionCandidate(); // returns key to remove, or null if empty
}

public class LruEvictionPolicy<K> implements EvictionPolicy<K> {
    // LinkedHashMap in access order gives O(1) LRU tracking for free
    private final LinkedHashMap<K, Boolean> order = new LinkedHashMap<>(16, 0.75f, true);
    public void recordInsertion(K key) { order.put(key, Boolean.TRUE); }
    public void recordAccess(K key) { order.get(key); } // access-order map reorders on get
    public void remove(K key) { order.remove(key); }
    public K evictionCandidate() {
        Iterator<K> it = order.keySet().iterator();
        return it.hasNext() ? it.next() : null; // eldest = least recently used
    }
}

public class FifoEvictionPolicy<K> implements EvictionPolicy<K> {
    private final Deque<K> insertionOrder = new ArrayDeque<>();
    public void recordInsertion(K key) { insertionOrder.addLast(key); }
    public void recordAccess(K key) { /* FIFO ignores access recency by definition */ }
    public void remove(K key) { insertionOrder.remove(key); }
    public K evictionCandidate() { return insertionOrder.peekFirst(); }
}

public class LfuEvictionPolicy<K> implements EvictionPolicy<K> {
    private final Map<K, Integer> frequency = new HashMap<>();
    public void recordInsertion(K key) { frequency.put(key, 1); }
    public void recordAccess(K key) { frequency.merge(key, 1, Integer::sum); }
    public void remove(K key) { frequency.remove(key); }
    public K evictionCandidate() {
        return frequency.entrySet().stream()
            .min(Map.Entry.comparingByValue())
            .map(Map.Entry::getKey).orElse(null);
    }
}

public class Cache<K, V> {
    private final int capacity;
    private final Map<K, V> store = new HashMap<>();
    private final EvictionPolicy<K> policy;

    public Cache(int capacity, EvictionPolicy<K> policy) {
        this.capacity = capacity; this.policy = policy;
    }

    public V get(K key) {
        V value = store.get(key);
        if (value != null) policy.recordAccess(key);
        return value; // null = miss, matches Map contract; a Optional<V> wrapper is a valid alternative
    }

    public void put(K key, V value) {
        if (!store.containsKey(key) && store.size() >= capacity) {
            K victim = policy.evictionCandidate();
            if (victim != null) { store.remove(victim); policy.remove(victim); }
        }
        store.put(key, value);
        policy.recordInsertion(key);
    }

    public int size() { return store.size(); }
}
```

### Extension question
*"How would you make the cache thread-safe for concurrent reads and writes?"*

Wrap `get`/`put` bodies in a single `ReentrantReadWriteLock` (read lock for `get`'s common path when
it doesn't need to mutate policy state significantly, write lock for `put` and any eviction) — or,
simpler and often the better lazy answer for an interview, note that `Cache` composes a `Map` and an
`EvictionPolicy` and a coarse `synchronized` on both methods is the correct starting point
(`ponytail`-style: don't reach for fine-grained locking until profiling shows contention). The
eviction policy interface doesn't change either way — thread-safety is a `Cache`-level concern
layered on top, not something that leaks into `EvictionPolicy` implementations.

---

## 9. Task Scheduler

### Requirements
Clients submit tasks (a unit of work plus optional priority, optional delay, optional recurrence) to
be executed by a pool of workers; the scheduler must support one-off, delayed, and recurring tasks,
respect priority ordering, retry on failure up to a limit, and allow cancellation before execution.

### Key entities
- **Task** — the work unit (`Runnable`-like `execute()`), id, priority, state (`PENDING`, `RUNNING`, `COMPLETED`, `FAILED`, `CANCELLED`).
- **ScheduledTask** — wraps a `Task` with `executeAt`, `RecurrencePolicy`, retry count.
- **RecurrencePolicy** (interface) — `null`/`OneOff`, `FixedRateRecurrence`, `CronRecurrence` — computes the *next* run time after a task completes.
- **TaskQueue** — priority queue ordered by (`executeAt`, `priority`).
- **WorkerPool** — fixed thread pool pulling ready tasks and executing them.
- **RetryPolicy** (interface) — how many times / with what backoff a failed task is retried, independent of what the task does.
- **TaskScheduler** — facade: `submit`, `cancel`, `schedule(delay)`, `scheduleRecurring(policy)`.

### Design decisions
Three independent axes vary, so three small Strategy interfaces rather than one bloated
`TaskConfig`: (1) **when it recurs** (`RecurrencePolicy`), (2) **how failures are retried**
(`RetryPolicy` — fixed attempts vs exponential backoff), (3) implicitly, **execution ordering**,
handled structurally by a `PriorityBlockingQueue` rather than a Strategy since "compare by time-
then-priority" is a single stable rule, not something ops will swap at runtime. This mirrors the
Elevator problem's lesson: don't collapse genuinely orthogonal variations into one interface just
because they both configure the same `Task` — a `CronRecurrence` should be swappable without
touching retry logic and vice versa. `Task` itself is a natural **Command** (Part A: Command
Pattern) — it encapsulates "a request to do something" as an object that can be queued, delayed,
retried, or cancelled independently of who created it or when it runs, which is exactly Command's
purpose (decoupling the invoker from the executor).

### Class diagram
```
+------------------+        +------------------+
|  TaskScheduler   |------->|   TaskQueue      | (PriorityBlockingQueue<ScheduledTask>)
|------------------|        +------------------+
| +submit(task)    |
| +schedule(t,delay)|              +------------------+
| +cancel(id)      |------------->|   WorkerPool      |
+------------------+              +------------------+
        |
        | wraps
        v
+------------------+   1     +--------------------+
|  ScheduledTask   |-------->| RecurrencePolicy   |<<interface>>
|------------------|         +--------------------+
| -task: Task      |               ^        ^
| -executeAt       |          OneOff    FixedRateRecurrence
| -retryCount      |
| -recurrence      |    1     +--------------------+
+------------------+---------->|   RetryPolicy     |<<interface>>
                                +--------------------+
                                    ^          ^
                            FixedRetryPolicy  ExponentialBackoffPolicy

+------------------+
|      Task        |<<interface: Command>>
|  +execute()       |
+------------------+
```

### Code skeleton
```java
public interface Task { String getId(); void execute() throws Exception; }

public interface RecurrencePolicy { Instant nextRun(Instant lastRun); } // null => one-off
public class FixedRateRecurrence implements RecurrencePolicy {
    private final Duration interval;
    public FixedRateRecurrence(Duration interval) { this.interval = interval; }
    public Instant nextRun(Instant lastRun) { return lastRun.plus(interval); }
}

public interface RetryPolicy { boolean shouldRetry(int attemptsSoFar); Duration backoffFor(int attemptsSoFar); }
public class ExponentialBackoffRetryPolicy implements RetryPolicy {
    private final int maxAttempts;
    public ExponentialBackoffRetryPolicy(int maxAttempts) { this.maxAttempts = maxAttempts; }
    public boolean shouldRetry(int attemptsSoFar) { return attemptsSoFar < maxAttempts; }
    public Duration backoffFor(int attemptsSoFar) { return Duration.ofSeconds((long) Math.pow(2, attemptsSoFar)); }
}

public class ScheduledTask implements Comparable<ScheduledTask> {
    final Task task;
    volatile Instant executeAt;
    final RecurrencePolicy recurrence; // null = one-off
    final RetryPolicy retryPolicy;
    int attempts = 0;
    volatile boolean cancelled = false;

    public ScheduledTask(Task task, Instant executeAt, RecurrencePolicy recurrence, RetryPolicy retryPolicy) {
        this.task = task; this.executeAt = executeAt; this.recurrence = recurrence; this.retryPolicy = retryPolicy;
    }
    public int compareTo(ScheduledTask other) { return this.executeAt.compareTo(other.executeAt); }
}

public class TaskScheduler {
    private final PriorityBlockingQueue<ScheduledTask> queue = new PriorityBlockingQueue<>();
    private final Map<String, ScheduledTask> byId = new ConcurrentHashMap<>();
    private final ExecutorService workers;
    private final ScheduledExecutorService clock = Executors.newSingleThreadScheduledExecutor();

    public TaskScheduler(int workerCount) {
        this.workers = Executors.newFixedThreadPool(workerCount);
        clock.scheduleAtFixedRate(this::dispatchReadyTasks, 0, 100, TimeUnit.MILLISECONDS);
    }

    public void submit(Task task) { schedule(task, Duration.ZERO, null, new ExponentialBackoffRetryPolicy(3)); }

    public void schedule(Task task, Duration delay, RecurrencePolicy recurrence, RetryPolicy retryPolicy) {
        ScheduledTask st = new ScheduledTask(task, Instant.now().plus(delay), recurrence, retryPolicy);
        byId.put(task.getId(), st);
        queue.offer(st);
    }

    public void cancel(String taskId) {
        ScheduledTask st = byId.get(taskId);
        if (st != null) st.cancelled = true;
    }

    private void dispatchReadyTasks() {
        while (!queue.isEmpty() && !queue.peek().executeAt.isAfter(Instant.now())) {
            ScheduledTask st = queue.poll();
            if (st.cancelled) continue;
            workers.submit(() -> runWithRetry(st));
        }
    }

    private void runWithRetry(ScheduledTask st) {
        try {
            st.task.execute();
            if (st.recurrence != null && !st.cancelled) {
                st.executeAt = st.recurrence.nextRun(Instant.now());
                queue.offer(st);
            }
        } catch (Exception e) {
            st.attempts++;
            if (st.retryPolicy.shouldRetry(st.attempts)) {
                st.executeAt = Instant.now().plus(st.retryPolicy.backoffFor(st.attempts));
                queue.offer(st);
            } // else: give up, mark FAILED (state tracking omitted for brevity)
        }
    }
}
```

### Extension question
*"How would you make this scheduler survive a process restart (durable scheduling)?"*

Swap the in-memory `PriorityBlockingQueue`/`ConcurrentHashMap` for a persisted store (a DB table
polled by `dispatchReadyTasks`, or a durable queue like SQS with delay-seconds) behind the same
`TaskScheduler` public API — `submit`/`schedule`/`cancel` signatures don't change, only what backs
`queue` and `byId`. Because `Task` was already a serializable Command object (id + execute logic)
rather than a raw closure, it's the natural unit to persist; the one real design change is that
`Task.execute()` implementations must become idempotent, since durable delivery implies at-least-
once execution — worth flagging to the interviewer as the actual hard part, not the storage swap
itself.

---

## 10. Splitwise (Expense Sharing) — Debt Simplification

### Requirements
Users belong to groups and record shared expenses (paid by one user, split among several — equally,
by exact amounts, or by percentage). At any point, a user should be able to see "who owes whom" —
and critically, the system should **simplify** the debt graph so that, e.g., if A owes B $10 and B
owes C $10, the system nets it to "A owes C $10" instead of two separate transfers. This is the deep
part of the problem — get the algorithm right, not just the class names.

### Key entities
- **User** — id, name.
- **Group** — set of users, list of expenses.
- **Expense** — amount, `paidBy`, list of `Split`s.
- **Split** (interface) — `EqualSplit`, `ExactSplit`, `PercentSplit` — *how* one expense's amount is divided among participants.
- **SplitStrategy** — validates/computes each `Split`'s share given the expense (this is where "percentages must sum to 100" or "exact amounts must sum to total" is enforced).
- **Balance / Ledger** — the running net-owes graph, keyed by user pair.
- **DebtSimplifier** — the algorithm that reduces the pairwise balance graph to a minimal set of settling transactions.

### Design decisions
The split-type variation (equal/exact/percent) is a clean **Strategy** (Part A: Strategy Pattern) —
`Expense.addSplits(SplitStrategy, participants)` delegates the "how much does each person owe"
computation, and adding "split by shares" (e.g., roommates splitting rent 2:1:1) later is a new
`SplitStrategy` implementation, zero changes to `Expense` or `Ledger`.

The **debt simplification** is the part worth going deep on, because it's a genuine graph/greedy
algorithm, not just a pattern-naming exercise:

**Problem restated:** given a set of net balances per user (positive = is owed money, negative = owes money), find the *minimum number of transactions* that settles all debts.

**Key insight:** you don't need to preserve who-originally-owed-whom. Only each person's **net balance** matters. If A is net +50 (owed $50 overall) and B is net -30, C is net -20, the minimal settlement is "B pays A $30, C pays A $20" — two transactions — regardless of how many original expenses produced those numbers.

**Algorithm (greedy, minimizes transaction count in practice — this is the same idea as the classic "optimal account balancing" / LeetCode 465 problem):**
1. Compute each user's net balance by summing all expenses (`paidBy` gets `+amount`, each split participant gets `-theirShare`).
2. Put non-zero balances into two heaps: a max-heap of creditors (positive balance) and a max-heap of debtors (positive magnitude of negative balance).
3. Repeatedly pop the largest creditor and largest debtor, settle `min(creditorAmt, debtorAmt)` between them, push back whichever side has leftover balance, until both heaps are empty.
4. This is greedy, not provably always the mathematically-minimal transaction count for all graphs (that sub-problem is NP-hard in general — the true minimum requires trying subsets), but it is the standard, interview-expected O(n log n) approximation that works well in practice and is what real Splitwise-like systems ship. **Say this out loud to the interviewer** — naming the greedy-vs-optimal tradeoff explicitly is a staff-level signal.

### Class diagram
```
+---------+ *      * +---------+          +------------------+
|  User   |----------|  Group  |--------->|    Expense        |
+---------+          +---------+          |------------------|
                                            | amount           |
                                            | paidBy: User     |
                                            | splits: List<Split> |
                                            +--------+---------+
                                                     |
                                       computed by   v
                                            +------------------+
                                            |  SplitStrategy   |<<interface>>
                                            +------------------+
                                              ^      ^       ^
                                     EqualSplit  ExactSplit  PercentSplit

+------------------+          +---------------------+
|      Ledger      |--------->|   DebtSimplifier     |
|------------------|          |----------------------|
| balances: Map<User,Double>| | +simplify(balances)  |
| +recordExpense(e)|         |    -> List<Transaction>|
+------------------+          +---------------------+
```

### Code skeleton
```java
public class User {
    final String id; final String name;
    public User(String id, String name) { this.id = id; this.name = name; }
    public String getId() { return id; }
    @Override public boolean equals(Object o) { return o instanceof User u && u.id.equals(id); }
    @Override public int hashCode() { return id.hashCode(); }
}

public class Split {
    final User user;
    final double amountOwed; // resolved share of the expense, always a dollar amount after strategy runs
    public Split(User user, double amountOwed) { this.user = user; this.amountOwed = amountOwed; }
}

public interface SplitStrategy {
    List<Split> compute(double totalAmount, List<User> participants, Map<User, Double> shares);
}
public class EqualSplitStrategy implements SplitStrategy {
    public List<Split> compute(double total, List<User> participants, Map<User, Double> shares) {
        double each = round2(total / participants.size());
        return participants.stream().map(u -> new Split(u, each)).toList();
    }
    private double round2(double v) { return Math.round(v * 100.0) / 100.0; }
}
public class PercentSplitStrategy implements SplitStrategy {
    public List<Split> compute(double total, List<User> participants, Map<User, Double> percentages) {
        double sum = percentages.values().stream().mapToDouble(Double::doubleValue).sum();
        if (Math.abs(sum - 100.0) > 0.01) throw new IllegalArgumentException("Percentages must sum to 100");
        return participants.stream()
            .map(u -> new Split(u, total * percentages.get(u) / 100.0))
            .toList();
    }
}
public class ExactSplitStrategy implements SplitStrategy {
    public List<Split> compute(double total, List<User> participants, Map<User, Double> exactAmounts) {
        double sum = exactAmounts.values().stream().mapToDouble(Double::doubleValue).sum();
        if (Math.abs(sum - total) > 0.01) throw new IllegalArgumentException("Exact amounts must sum to total");
        return participants.stream().map(u -> new Split(u, exactAmounts.get(u))).toList();
    }
}

public class Expense {
    final double amount; final User paidBy; final List<Split> splits;
    public Expense(double amount, User paidBy, SplitStrategy strategy, List<User> participants, Map<User, Double> input) {
        this.amount = amount; this.paidBy = paidBy;
        this.splits = strategy.compute(amount, participants, input);
    }
}

public class Ledger {
    private final Map<User, Double> netBalance = new HashMap<>(); // + means "is owed", - means "owes"

    public void recordExpense(Expense expense) {
        netBalance.merge(expense.paidBy, expense.amount, Double::sum);
        for (Split split : expense.splits) {
            netBalance.merge(split.user, -split.amountOwed, Double::sum);
        }
    }
    public Map<User, Double> getBalances() { return netBalance; }
}

public record Transaction(User from, User to, double amount) {}

// The deep part: minimize settlement transactions via greedy max-creditor/max-debtor matching.
public class DebtSimplifier {
    public List<Transaction> simplify(Map<User, Double> balances) {
        PriorityQueue<Map.Entry<User, Double>> creditors =
            new PriorityQueue<>((a, b) -> Double.compare(b.getValue(), a.getValue()));
        PriorityQueue<Map.Entry<User, Double>> debtors =
            new PriorityQueue<>((a, b) -> Double.compare(Math.abs(b.getValue()), Math.abs(a.getValue())));

        for (var e : balances.entrySet()) {
            if (e.getValue() > 0.01) creditors.add(new AbstractMap.SimpleEntry<>(e.getKey(), e.getValue()));
            else if (e.getValue() < -0.01) debtors.add(new AbstractMap.SimpleEntry<>(e.getKey(), e.getValue()));
        }

        List<Transaction> result = new ArrayList<>();
        while (!creditors.isEmpty() && !debtors.isEmpty()) {
            var creditor = creditors.poll();
            var debtor = debtors.poll();
            double settle = Math.min(creditor.getValue(), Math.abs(debtor.getValue()));
            result.add(new Transaction(debtor.getKey(), creditor.getKey(), round2(settle)));

            double creditorRemaining = creditor.getValue() - settle;
            double debtorRemaining = debtor.getValue() + settle;
            if (creditorRemaining > 0.01) creditors.add(new AbstractMap.SimpleEntry<>(creditor.getKey(), creditorRemaining));
            if (debtorRemaining < -0.01) debtors.add(new AbstractMap.SimpleEntry<>(debtor.getKey(), debtorRemaining));
        }
        return result;
    }
    private double round2(double v) { return Math.round(v * 100.0) / 100.0; }
}
```

### Extension question
*"How would you support settlement *within a group only* when a user is in multiple groups (no cross-group netting)?"*

Scope the `Ledger`'s `netBalance` map, and therefore the `DebtSimplifier.simplify` call, per `Group`
instead of globally — `Ledger` becomes `Map\<Group, Map\<User, Double>>`, and `recordExpense` routes
into the balance map for `expense.getGroup()`. The `DebtSimplifier` algorithm itself is unchanged;
it already operates on "whatever balance map you hand it," which is exactly why keeping it a pure
function of `Map\<User, Double> -> List\<Transaction>` (no hidden dependency on a global `Ledger`
state) pays off the moment scoping requirements shift.

---

## 11. Chess Game

### Requirements
Two players alternate moves on an 8x8 board; each piece type has distinct legal-move rules; the
engine must detect check, checkmate, and stalemate, reject illegal moves (including moves that leave
one's own king in check), and support special rules (castling, en passant, pawn promotion) without a
monolithic `if piece == "pawn"` move validator.

### Key entities
- **Board** — 8x8 grid of `Square`s, each optionally holding a `Piece`.
- **Piece** (abstract) → `Pawn`, `Rook`, `Knight`, `Bishop`, `Queen`, `King` — each knows its own legal-move generation.
- **Move** — from-square, to-square, piece, captured piece (if any), special flag (castle/en passant/promotion).
- **Player** — color, owns captured pieces.
- **Game** — orchestrates turn order, move validation, check/checkmate detection, move history.
- **MoveValidator** — cross-cutting rule: "does this move leave my own king in check" (applies after any piece's raw move generation).

### Design decisions
The obvious, load-bearing variation is **how each piece moves** — this is the single cleanest real-
world case for polymorphism over conditionals: each `Piece` subclass implements
`getLegalMoves(Board, Position)` on its own, and `Game` never asks "what type of piece is this" to
decide movement rules (Part A: this *is* the canonical Open/Closed Principle example, more
fundamental than any single GoF pattern, though it pairs naturally with **Template Method** if you
factor "generate candidate moves, then filter out ones exposing your king" into a shared base
method). Move history with the ability to undo naturally wants **Command** (Part A: Command Pattern)
— a `Move` object that knows how to `execute()` and `undo()` itself, which is exactly what's needed
for undo/redo, check-detection-by-simulation ("try the move, see if king is in check, undo if not
legal"), and PGN-style replay. Board state transitions (in-check, checkmate, normal play, stalemate)
are a good secondary candidate for **State** if the interviewer wants game-flow control (whose turn,
is game over) modeled explicitly rather than as booleans on `Game`.

### Class diagram
```
+----------+          +------------------+
|  Board   |--------->|     Square       |  (8x8 grid)
+----------+          +------------------+
                              |
                              | 0..1
                       +------v------+
                       |    Piece    |<<abstract>>
                       |-------------|
                       | color       |
                       | +getLegalMoves(board,pos): List<Move>
                       +------+------+
                              |
   +------+------+-----+-----+-----+------+------+
   |      |      |     |           |      |
 Pawn   Rook  Knight Bishop      Queen   King

+----------+         +------------------+
|   Move   |<<Command>>                 |
|----------|         | +execute(board)  |
| from,to  |         | +undo(board)     |
| piece    |         +------------------+
| captured |
| special  |
+----------+

+----------+          +------------------+
|   Game   |--------->|  MoveValidator   |
|----------|          +------------------+
| -board   |          | +isLegal(move,gameState)
| -turn    |          +------------------+
| -history: Deque<Move>|
+----------+
```

### Code skeleton
```java
public enum Color { WHITE, BLACK }
public record Position(int row, int col) {}

public abstract class Piece {
    protected final Color color;
    protected Piece(Color color) { this.color = color; }
    public Color getColor() { return color; }
    // Each piece owns its own movement rule -- no central switch statement.
    public abstract List<Position> getCandidateMoves(Board board, Position from);
}

public class Knight extends Piece {
    private static final int[][] OFFSETS = {{1,2},{2,1},{-1,2},{-2,1},{1,-2},{2,-1},{-1,-2},{-2,-1}};
    public Knight(Color color) { super(color); }
    public List<Position> getCandidateMoves(Board board, Position from) {
        List<Position> moves = new ArrayList<>();
        for (int[] off : OFFSETS) {
            int r = from.row() + off[0], c = from.col() + off[1];
            if (r < 0 || r > 7 || c < 0 || c > 7) continue;
            Position to = new Position(r, c);
            Piece occupant = board.pieceAt(to);
            if (occupant == null || occupant.getColor() != this.color) moves.add(to);
        }
        return moves;
    }
}
// Rook, Bishop, Queen, King, Pawn follow the same shape: own file, own logic, omitted for brevity.

public class Move {
    final Position from, to; final Piece movedPiece; Piece capturedPiece;
    public Move(Position from, Position to, Piece movedPiece) {
        this.from = from; this.to = to; this.movedPiece = movedPiece;
    }
    public void execute(Board board) {          // Command.execute
        capturedPiece = board.pieceAt(to);
        board.placePiece(to, movedPiece);
        board.removePiece(from);
    }
    public void undo(Board board) {              // Command.undo
        board.placePiece(from, movedPiece);
        board.placePiece(to, capturedPiece);      // null-safe: placePiece(pos, null) clears the square
    }
}

public class Board {
    private final Piece[][] grid = new Piece[8][8];
    public Piece pieceAt(Position p) { return grid[p.row()][p.col()]; }
    public void placePiece(Position p, Piece piece) { grid[p.row()][p.col()] = piece; }
    public void removePiece(Position p) { grid[p.row()][p.col()] = null; }
    public Position findKing(Color color) {
        for (int r = 0; r < 8; r++) for (int c = 0; c < 8; c++)
            if (grid[r][c] instanceof King k && k.getColor() == color) return new Position(r, c);
        throw new IllegalStateException("King missing for " + color);
    }
}

public class Game {
    private final Board board = new Board();
    private Color turn = Color.WHITE;
    private final Deque<Move> history = new ArrayDeque<>();

    public boolean makeMove(Position from, Position to) {
        Piece piece = board.pieceAt(from);
        if (piece == null || piece.getColor() != turn) return false;
        if (!piece.getCandidateMoves(board, from).contains(to)) return false;

        Move move = new Move(from, to, piece);
        move.execute(board);
        if (isKingInCheck(turn)) {          // simulate, then reject moves exposing own king
            move.undo(board);
            return false;
        }
        history.push(move);
        turn = (turn == Color.WHITE) ? Color.BLACK : Color.WHITE;
        return true;
    }

    private boolean isKingInCheck(Color color) {
        Position kingPos = board.findKing(color);
        for (int r = 0; r < 8; r++) for (int c = 0; c < 8; c++) {
            Piece p = board.pieceAt(new Position(r, c));
            if (p != null && p.getColor() != color && p.getCandidateMoves(board, new Position(r, c)).contains(kingPos)) {
                return true;
            }
        }
        return false;
    }

    public void undoLastMove() {
        if (!history.isEmpty()) { history.pop().undo(board); turn = (turn == Color.WHITE) ? Color.BLACK : Color.WHITE; }
    }
}
```

### Extension question
*"How would you add support for a chess *variant* (e.g., Chess960 with randomized back-rank starting positions, or a 'no castling' house rule)?"*

Extract board setup into a `BoardInitializationStrategy` (Part A: Strategy Pattern) —
`StandardSetup` vs `Chess960Setup` — so `Game`'s constructor takes a strategy instead of hardcoding
the back rank; extract castling/en passant legality into pluggable `SpecialMoveRule` checks
consulted alongside each piece's own `getCandidateMoves`, so a "house rules" config can simply omit
the castling rule from the active rule set. Because move generation was already decentralized
per-`Piece` rather than living in one giant `Game.isLegalMove` method, adding or removing a rule
module doesn't require touching `Pawn`, `Rook`, etc.

---

## 12. Cab Booking (LLD)

### Requirements
A rider requests a ride from a pickup to a drop location; the system matches an available nearby
driver, tracks ride lifecycle (`REQUESTED` → `ACCEPTED` → `IN_PROGRESS` → `COMPLETED`/`CANCELLED`),
computes fare based on distance/time/vehicle-tier, and processes payment at completion. **This is
deliberately the class-model view** — one process, one JVM's worth of objects modeling riders,
drivers, rides, and pricing. It is *not* the distributed, multi-service, geo-sharded matching
architecture covered in the Ride-Sharing HLD design elsewhere in this course — no service
boundaries, no message queues, no geospatial index sharding here; those concerns live at the HLD
layer, and conflating the two is the most common mistake candidates make when asked this question at
the LLD round.

### Key entities
- **Rider**, **Driver** — user-role entities; `Driver` additionally has `location`, `availability`, `vehicle`.
- **Vehicle** — tier (`MINI`, `SEDAN`, `SUV`), plate.
- **Ride** — the aggregate root: rider, driver, pickup, drop, `RideState`, fare.
- **RideState** (interface) → `Requested`, `Accepted`, `InProgress`, `Completed`, `Cancelled` — legal-transition enforcement.
- **DriverMatchingStrategy** — nearest-available-driver selection (swappable: nearest-by-distance vs highest-rated-nearby).
- **FareCalculationStrategy** — distance+time+tier+surge-multiplier pricing.
- **PaymentProcessor** (interface) — boundary to an external payment gateway, invoked at ride completion.

### Design decisions
This intentionally reuses the exact same two shapes already justified twice above: **State** for the
ride lifecycle (accepting a completed ride, or starting a ride that was never accepted, must be
structurally impossible — same reasoning as ATM/Vending) and **Strategy** for the two policies that
change independently of each other and of the ride's lifecycle (matching algorithm, fare formula).
The one new wrinkle versus the HLD version of this problem: at LLD scope,
`DriverMatchingStrategy.findNearestDriver` can legitimately just linear-scan an in-memory
`List\<Driver>` — that's the correct, lazy, in-scope answer; do **not** reach for a geospatial index
(quadtree/geohash) here, that complexity belongs to the HLD design where driver counts are millions
and the constraint is cross-machine lookup latency, not algorithmic elegance. Naming that boundary
explicitly to the interviewer ("at this scale a linear scan behind the interface is fine; the
interface is what lets us swap in a geo-index later without changing `Ride`") is exactly the
senior/staff signal this problem is testing for.

### Class diagram
```
+---------+        +---------+          +------------------+
|  Rider  |        | Driver  |--------->|     Vehicle       |
+---------+        +---------+          +------------------+
                         ^ location, availability

+------------------+        +--------------------------+
|      Ride        |------->|       RideState          |<<interface>>
|------------------|        +--------------------------+
| rider, driver    |          ^      ^        ^      ^
| pickup, drop     |     Requested Accepted InProgress Completed/Cancelled
| fare             |
| -state           |
+---------+--------+
          |
          | uses (at request time)          uses (at completion time)
          v                                          v
+--------------------------+           +---------------------------+
| DriverMatchingStrategy   |<<iface>>  |  FareCalculationStrategy  |<<iface>>
+--------------------------+           +---------------------------+
    ^                                       ^
NearestAvailableDriverStrategy       DistanceTimeFareStrategy

+------------------+
| PaymentProcessor |<<interface, external boundary>>
+------------------+
```

### Code skeleton
```java
public enum VehicleTier { MINI, SEDAN, SUV }
public record Location(double lat, double lng) {
    double distanceTo(Location other) { // haversine omitted, flat approximation for interview scope
        return Math.sqrt(Math.pow(lat - other.lat, 2) + Math.pow(lng - other.lng, 2)) * 111; // ~km
    }
}

public class Driver {
    final String id; Location location; boolean available = true; final VehicleTier tier;
    public Driver(String id, Location loc, VehicleTier tier) { this.id = id; this.location = loc; this.tier = tier; }
}

public interface DriverMatchingStrategy { Optional<Driver> match(List<Driver> drivers, Location pickup, VehicleTier tier); }
public class NearestAvailableDriverStrategy implements DriverMatchingStrategy {
    public Optional<Driver> match(List<Driver> drivers, Location pickup, VehicleTier tier) {
        return drivers.stream()
            .filter(d -> d.available && d.tier == tier)
            .min(Comparator.comparingDouble(d -> d.location.distanceTo(pickup)));
        // ponytail: linear scan, fine at LLD/single-process scale; swap for a geo-index behind
        // this same interface if/when driver count forces it -- that's the HLD version's job.
    }
}

public interface FareCalculationStrategy { double calculate(double distanceKm, Duration duration, VehicleTier tier); }
public class DistanceTimeFareStrategy implements FareCalculationStrategy {
    public double calculate(double distanceKm, Duration duration, VehicleTier tier) {
        double base = tier == VehicleTier.SUV ? 5 : tier == VehicleTier.SEDAN ? 3 : 2;
        return base + distanceKm * 1.5 + duration.toMinutes() * 0.25;
    }
}

public interface RideState {
    void accept(Ride ride, Driver driver);
    void start(Ride ride);
    void complete(Ride ride);
    void cancel(Ride ride);
}
public class RequestedState implements RideState {
    public void accept(Ride ride, Driver driver) { driver.available = false; ride.setDriver(driver); ride.setState(new AcceptedState()); }
    public void start(Ride ride) { throw new IllegalStateException("Not yet accepted"); }
    public void complete(Ride ride) { throw new IllegalStateException("Not yet accepted"); }
    public void cancel(Ride ride) { ride.setState(new CancelledState()); }
}
public class AcceptedState implements RideState {
    public void accept(Ride ride, Driver driver) { throw new IllegalStateException("Already accepted"); }
    public void start(Ride ride) { ride.setState(new InProgressState()); }
    public void complete(Ride ride) { throw new IllegalStateException("Ride not started"); }
    public void cancel(Ride ride) { ride.getDriver().available = true; ride.setState(new CancelledState()); }
}
public class InProgressState implements RideState {
    public void accept(Ride ride, Driver driver) { throw new IllegalStateException("Ride in progress"); }
    public void start(Ride ride) { throw new IllegalStateException("Already started"); }
    public void complete(Ride ride) {
        double fare = ride.getFareStrategy().calculate(
            ride.getPickup().distanceTo(ride.getDrop()), ride.elapsed(), ride.getDriver().tier);
        ride.setFare(fare);
        ride.getDriver().available = true;
        ride.setState(new CompletedState());
    }
    public void cancel(Ride ride) { throw new IllegalStateException("Cannot cancel mid-ride"); }
}
public class CompletedState implements RideState {
    public void accept(Ride ride, Driver driver) { throw new IllegalStateException("Ride over"); }
    public void start(Ride ride) { throw new IllegalStateException("Ride over"); }
    public void complete(Ride ride) { throw new IllegalStateException("Already completed"); }
    public void cancel(Ride ride) { throw new IllegalStateException("Ride over"); }
}
public class CancelledState implements RideState {
    public void accept(Ride ride, Driver driver) { throw new IllegalStateException("Ride cancelled"); }
    public void start(Ride ride) { throw new IllegalStateException("Ride cancelled"); }
    public void complete(Ride ride) { throw new IllegalStateException("Ride cancelled"); }
    public void cancel(Ride ride) { /* no-op, already cancelled */ }
}

public class Ride {
    private final Location pickup, drop;
    private Driver driver;
    private RideState state = new RequestedState();
    private final FareCalculationStrategy fareStrategy;
    private double fare;
    private final Instant requestedAt = Instant.now();

    public Ride(Location pickup, Location drop, FareCalculationStrategy fareStrategy) {
        this.pickup = pickup; this.drop = drop; this.fareStrategy = fareStrategy;
    }
    public void accept(Driver d) { state.accept(this, d); }
    public void start() { state.start(this); }
    public void complete() { state.complete(this); }
    public void cancel() { state.cancel(this); }

    void setState(RideState s) { state = s; }
    void setDriver(Driver d) { driver = d; }
    Driver getDriver() { return driver; }
    Location getPickup() { return pickup; }
    Location getDrop() { return drop; }
    FareCalculationStrategy getFareStrategy() { return fareStrategy; }
    Duration elapsed() { return Duration.between(requestedAt, Instant.now()); }
    void setFare(double f) { fare = f; }
}
```

### Extension question
*"How would you support ride-pooling (two riders sharing one ride with independent drop points)?"*

`Ride` currently assumes one `pickup`/`drop` pair; generalize to a `List\<Leg>` (each leg: rider,
pickup, drop, individual fare share) with the `RideState` machine driving the *pool* as a whole
(still one `IN_PROGRESS` ride object) while `FareCalculationStrategy` gains a pooled variant that
discounts each leg based on shared-distance overlap. The state machine itself doesn't grow new
states — pooling is a data-shape change to what a `Ride` contains, not a lifecycle change to how it
progresses — which is a good example of recognizing when a requirement change is *not* a pattern-
shape change at all, just a model change.

---

## 13. Notification Framework

### Requirements
The system needs to send notifications through multiple channels (email, SMS, push, in-app)
triggered by application events (order shipped, password reset, promotional blast); users have per-
channel preferences (opted out of SMS, say); a single logical notification may fan out to several
channels at once, and adding a new channel (e.g., WhatsApp) later must not touch existing event-
triggering code.

### Key entities
- **Notification** — payload: title, body, recipient, metadata (template variables).
- **NotificationChannel** (interface) → `EmailChannel`, `SmsChannel`, `PushChannel`, `InAppChannel` — *how* a notification is actually delivered.
- **NotificationFactory** — builds channel-specific formatted content from a generic `Notification` (an email needs subject+HTML body, an SMS needs a truncated plain string) — could alternatively live as a `format()` method per channel; a factory is justified if construction of the channel-specific payload is nontrivial enough to warrant separation from the `send()` call itself.
- **UserPreferences** — which channels a given user has opted into.
- **NotificationEvent** — a domain occurrence (`OrderShipped`, `PasswordReset`) that other parts of the app raise without knowing who's listening.
- **NotificationDispatcher** — the subject that event producers publish to; channels (wrapped in preference checks) subscribe as observers.

### Design decisions
This problem is explicitly built to combine three patterns cleanly, and naming *which piece each one
solves* is the interview-winning move: **Observer** (Part A: Observer Pattern) decouples *event
producers* ("an order shipped") from *notification logic* — `OrderService` publishes an event and
has zero knowledge that email/SMS/push even exist, exactly like the Elevator controller/display
relationship. **Strategy** (Part A: Strategy Pattern) is the shape of `NotificationChannel` itself —
sending is one interface, many interchangeable delivery mechanisms, chosen per-recipient based on
`UserPreferences` rather than hardcoded. **Factory Method** (Part A: Factory Pattern) produces the
channel-appropriate rendering of a generic `Notification`, so the templating logic for "how does a
push notification's payload differ from an email's" lives in one place per channel instead of
leaking into `NotificationDispatcher`. The reason all three coexist without being redundant: each
answers a *different* "what varies" question — who triggers it, how it's delivered, and how it's
formatted — and conflating any two into one interface is where this design would start to leak.

### Class diagram
```
+--------------------+        publishes         +------------------------+
| OrderService, etc. |-------------------------->|  NotificationDispatcher | (Observer subject)
| (event producers)  |   dispatch(event)          |------------------------|
+--------------------+                            | -subscribers: List<NotificationChannel>
                                                   | +subscribe(channel)   |
                                                   | +dispatch(event, user)|
                                                   +-----------+------------+
                                                               |
                                        for each subscribed channel, if user opted in:
                                                               v
                                                   +------------------------+
                                                   |   NotificationChannel  |<<interface>>
                                                   +------------------------+
                                                     ^        ^        ^        ^
                                              EmailChannel SmsChannel PushChannel InAppChannel
                                                     |
                                            uses      v
                                                   +------------------------+
                                                   |  NotificationFactory   |
                                                   |------------------------|
                                                   | +render(event, channel)|
                                                   +------------------------+

+------------------+
| UserPreferences  |  (Map<User, Set<ChannelType>>)
+------------------+
```

### Code skeleton
```java
public enum ChannelType { EMAIL, SMS, PUSH, IN_APP }

public class NotificationEvent {
    final String type; final User recipient; final Map<String, String> templateData;
    public NotificationEvent(String type, User recipient, Map<String, String> data) {
        this.type = type; this.recipient = recipient; this.templateData = data;
    }
}

public class RenderedNotification { final String title; final String body;
    public RenderedNotification(String t, String b) { title = t; body = b; } }

public interface NotificationChannel {
    ChannelType getType();
    void send(User recipient, RenderedNotification content);
}
public class EmailChannel implements NotificationChannel {
    public ChannelType getType() { return ChannelType.EMAIL; }
    public void send(User recipient, RenderedNotification content) {
        System.out.println("EMAIL to " + recipient.getId() + ": " + content.title);
    }
}
public class SmsChannel implements NotificationChannel {
    public ChannelType getType() { return ChannelType.SMS; }
    public void send(User recipient, RenderedNotification content) {
        String truncated = content.body.length() > 140 ? content.body.substring(0, 140) : content.body;
        System.out.println("SMS to " + recipient.getId() + ": " + truncated);
    }
}
// PushChannel, InAppChannel follow the same shape -- omitted for brevity.

// Factory Method: one place per channel decides how a generic event becomes that channel's payload.
public class NotificationFactory {
    public RenderedNotification render(NotificationEvent event, ChannelType channel) {
        return switch (channel) {
            case EMAIL -> new RenderedNotification(
                "Update: " + event.type,
                "Hi, here are the details: " + event.templateData);
            case SMS -> new RenderedNotification(null,
                event.type + ": " + event.templateData.getOrDefault("summary", ""));
            default -> new RenderedNotification(event.type, event.templateData.toString());
        };
    }
}

public class UserPreferences {
    private final Map<String, Set<ChannelType>> optedIn = new HashMap<>();
    public void optIn(User user, ChannelType channel) {
        optedIn.computeIfAbsent(user.getId(), k -> new HashSet<>()).add(channel);
    }
    public boolean isOptedIn(User user, ChannelType channel) {
        return optedIn.getOrDefault(user.getId(), Set.of()).contains(channel);
    }
}

// Observer subject: producers publish events without knowing which channels exist.
public class NotificationDispatcher {
    private final List<NotificationChannel> channels = new ArrayList<>();
    private final NotificationFactory factory = new NotificationFactory();
    private final UserPreferences preferences;

    public NotificationDispatcher(UserPreferences preferences) { this.preferences = preferences; }
    public void subscribe(NotificationChannel channel) { channels.add(channel); }

    public void dispatch(NotificationEvent event) {
        for (NotificationChannel channel : channels) {
            if (!preferences.isOptedIn(event.recipient, channel.getType())) continue; // respect opt-out
            RenderedNotification content = factory.render(event, channel.getType());
            channel.send(event.recipient, content);
        }
    }
}
```

### Extension question
*"How would you add retry-with-backoff for channels that fail (e.g., the email provider is temporarily down), without slowing down the other channels?"*

Wrap each `NotificationChannel` in a `RetryingChannelDecorator implements NotificationChannel` (Part
A: Decorator Pattern) that catches send failures and retries per a configured `RetryPolicy` (the
same interface introduced in the Task Scheduler problem — reuse, don't reinvent), and dispatch each
subscribed channel's `send()` on its own thread/task submitted to an executor so one slow/retrying
channel doesn't block delivery to the others. `NotificationDispatcher.dispatch` doesn't change at
all — it already treats every subscriber as an opaque `NotificationChannel`, which is the entire
payoff of having gone through Observer instead of a hardcoded list of `if (email) ... if (sms) ...`
calls.

---

## Closing the loop

Thirteen problems, and the same five-step process every time: pin the requirements, name the
entities, find the axis of change, let the pattern fall out, then diagram and code it. Notice how
few *distinct* patterns actually got used — Strategy and State did most of the work, Observer and
Command showed up where events or undo-able actions were the real shape, Factory and Decorator
appeared only where construction or optional wrapping genuinely varied. That's not a coincidence:
real systems reuse a small pattern vocabulary constantly, and a candidate who reaches for a *new*
pattern on every problem to look impressive is demonstrating the opposite of what these problems
test.

> **"Can I create software that remains clean when requirements change?"** — every "extension
question" above answered yes, and in every case the answer was "because the axis of change was
already isolated behind an interface before the question was asked." That's the whole skill.
