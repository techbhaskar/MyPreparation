# Stage 6 — LLD Foundations
Last updated: 2026-08-27
_Overview and notes._
Last updated: 2026-08-27

> **Framing question: How should responsibilities inside a component be organized?**

High-level design (HLD) answers "what talks to what" — services, databases, queues, load balancers.
Low-level design (LLD) answers a narrower, harder question: once you're inside one box on that
diagram, how do you carve it into classes, interfaces, and methods so that it can be built, tested,
changed, and understood by someone other than the person who wrote it? This is the level
senior/staff interviews probe hardest, because it's where engineering judgment actually lives —
anyone can draw boxes and arrows, but knowing *why* a `PaymentProcessor` shouldn't also validate
card numbers is the difference between a design that survives five years of feature requests and one
that gets rewritten in eighteen months.

All code examples in this document use **Java**.

---

## Table of Contents

1. [Phase 1 — Object Modeling](#phase-1--object-modeling)
   - [Requirements → Use Cases](#requirements--use-cases)
   - [Entities](#entities)
   - [Value Objects](#value-objects)
   - [Responsibilities](#responsibilities)
   - [Relationships](#relationships)
   - [Behavior](#behavior)
2. [Phase 2 — OOP](#phase-2--oop)
   - [Encapsulation](#encapsulation)
   - [Abstraction](#abstraction)
   - [Polymorphism](#polymorphism)
   - [Inheritance](#inheritance)
   - [Composition](#composition)
   - [Composition vs Inheritance](#composition-vs-inheritance)
3. [Phase 3 — SOLID](#phase-3--solid)
   - [SRP](#srp--single-responsibility-principle)
   - [OCP](#ocp--openclosed-principle)
   - [LSP](#lsp--liskov-substitution-principle)
   - [ISP](#isp--interface-segregation-principle)
   - [DIP](#dip--dependency-inversion-principle)
4. [Phase 4 — Interfaces & Extensibility](#phase-4--interfaces--extensibility)
   - [Interfaces](#interfaces)
   - [Abstract Classes](#abstract-classes)
   - [Dependency Inversion (Applied)](#dependency-inversion-applied)
   - [Dependency Injection](#dependency-injection)
   - [Pluggable Behavior](#pluggable-behavior)
   - [Change Isolation](#change-isolation)
5. [Phase 5 — State & Behavior](#phase-5--state--behavior)
   - [State Machines](#state-machines)
   - [Valid Transitions](#valid-transitions)
   - [Invariants](#invariants)
   - [Validation](#validation)
   - [Domain Behavior](#domain-behavior)
6. [Phase 6 — Concurrency](#phase-6--concurrency)
   - [Thread Safety](#thread-safety)
   - [Race Conditions](#race-conditions)
   - [Locks](#locks)
   - [Atomic Operations](#atomic-operations)
   - [Immutability](#immutability)
   - [Concurrent Collections](#concurrent-collections)
7. [Phase 7 — Code Quality](#phase-7--code-quality)
   - [Cohesion](#cohesion)
   - [Coupling](#coupling)
   - [Testability](#testability)
   - [Error Handling](#error-handling)
   - [Maintainability](#maintainability)
   - [YAGNI](#yagni)
   - [DRY](#dry)
   - [KISS](#kiss)

---

## Phase 1 — Object Modeling

### Requirements → Use Cases

The most common failure in an LLD interview isn't writing bad code — it's writing *the wrong
classes* because the candidate jumped to code before extracting the nouns and verbs from the problem
statement. There's a repeatable technique for this.

Take a word problem: *"Design a parking lot. It has multiple levels, each with spots of different
sizes (compact, large, motorcycle). Vehicles of different types enter, get assigned a spot, and pay
when leaving based on duration."*

**Step 1 — underline the nouns.** These are candidate classes: `ParkingLot`, `Level`, `Spot`, `Vehicle`, `Ticket`, `Payment`.

**Step 2 — underline the verbs / actions.** These become methods or, if a verb is complex enough to have its own state and rules, its own class: "assign a spot" → `SpotAssignmentStrategy` or a method on `ParkingLot`; "pay based on duration" → a `PricingStrategy`.

**Step 3 — write use cases as short scripts**, actor-first:

```
UC1: Vehicle enters
  - Attendant/gate scans vehicle type
  - System finds an available spot matching the vehicle size
  - System creates a Ticket with entry time and spot reference
  - Gate opens

UC2: Vehicle exits
  - Attendant scans ticket
  - System computes duration = now - ticket.entryTime
  - System computes fee via PricingStrategy
  - Payment is processed
  - Spot is freed
```

**Step 4 — assign each noun a single job** based on the verbs it participates in. `ParkingLot` owns levels and orchestrates entry/exit. `Level` owns its spots. `Spot` knows its own size and occupancy. `Ticket` is a record of one parking session. `PricingStrategy` is pulled out as its own concept because "compute fee" has enough independent variability (flat rate, hourly, per-vehicle-type) to deserve isolation — this is the seed of the Strategy pattern discussed in Phase 4.

The discipline here is: **don't invent classes the text doesn't justify**, and **don't cram two
nouns' responsibilities into one class** because it seemed convenient at the whiteboard. A `Ticket`
that also calculates its own price is a small decision now that becomes a painful refactor later
when pricing rules multiply.

### Entities

An **entity** is an object defined by a persistent identity, not by the values of its fields. Two
`Order` objects with identical line items are still *different orders* if they have different order
IDs — one might get cancelled while the other ships. Identity, not state, is what you compare.

```java
public class Order {
    private final String orderId; // identity
    private OrderStatus status;
    private List<LineItem> items;

    @Override
    public boolean equals(Object o) {
        if (!(o instanceof Order other)) return false;
        return this.orderId.equals(other.orderId); // identity-based equality
    }

    @Override
    public int hashCode() {
        return orderId.hashCode();
    }
}
```

Entities are mutable over their lifetime (an order's status changes), typically have a lifecycle
(created → paid → shipped → delivered), and usually map to a row in a database table with a primary
key. In interviews, whenever you see "track", "history", "status changes", or "must be uniquely
identifiable", you're looking at an entity.

### Value Objects

A **value object** has no identity of its own — it's defined entirely by its attributes, and two
value objects with the same attributes are interchangeable. `Money`, `Address`, `DateRange`,
`EmailAddress` are canonical examples.

```java
public final class Money {
    private final long amountInCents;
    private final Currency currency;

    public Money(long amountInCents, Currency currency) {
        this.amountInCents = amountInCents;
        this.currency = currency;
    }

    public Money add(Money other) {
        if (!this.currency.equals(other.currency)) {
            throw new IllegalArgumentException("Currency mismatch");
        }
        return new Money(this.amountInCents + other.amountInCents, this.currency);
    }

    @Override
    public boolean equals(Object o) {
        if (!(o instanceof Money other)) return false;
        return amountInCents == other.amountInCents && currency.equals(other.currency);
    }

    @Override
    public int hashCode() {
        return Objects.hash(amountInCents, currency);
    }
}
```

Notice three design implications of treating `Money` as a value object rather than two raw fields
(`long cents`, `String currency`) scattered across `Order`, `Invoice`, and `Payment`:

1. **Validation lives in one place.** Currency mismatches are caught inside `add()`, not re-checked in every call site.
2. **It's immutable** — `final` fields, no setters, operations return new instances. This eliminates an entire category of bugs where one part of the code mutates a shared `Money` instance that another part didn't expect to change.
3. **Equality is structural**, not reference-based, so `Money` objects behave the way business logic expects (`$10 == $10`, always).

The rule of thumb: if identity matters, it's an entity; if only the current values matter, it's a
value object.

### Responsibilities

Every class should be answerable to the question "what is your one job?" in a single sentence
without the word "and". This isn't the same as SRP (covered in depth in Phase 3) — at the modeling
stage, it's simpler: when you draw a class on the whiteboard, write next to it the one thing it
*owns*. If you can't, split it.

A `Spot` in the parking lot example owns "am I occupied, and by what size vehicle". It does **not**
own "how much does it cost to park here" (that's `PricingStrategy`'s job) or "how do I find a free
spot" (that's `Level`'s or `ParkingLot`'s job as an orchestrator). Ownership boundaries drawn at
modeling time are what SOLID enforces at the code level later — get this right early and SRP becomes
almost automatic.

### Relationships

Three relationships describe how objects relate, in increasing order of "how tightly are their
lifetimes bound together."

**Association** — a general "uses" or "knows about" relationship, no ownership. A `Driver` is associated with a `Car` they're currently driving, but the car exists independently of any one driver.

```
Driver ────────── Car
      (associates)
```

**Aggregation** — a "has-a" relationship with **shared/independent lifetime**. A `Department` has `Employee`s, but if the department is dissolved, the employees still exist (they transfer elsewhere). Aggregation is drawn with a hollow diamond at the owner side.

```
Department ◇──────< Employee
          (aggregates, employees outlive the department)
```

```java
class Department {
    private List<Employee> employees; // references to independently-existing objects
}
```

**Composition** — a "has-a" relationship with **bound lifetime**: the part cannot exist without the whole, and is destroyed when the whole is. A `House` is composed of `Room`s — a room does not exist independently of a specific house. Composition is drawn with a filled diamond.

```
House ♦──────< Room
     (composes, rooms die with the house)
```

```java
class House {
    private final List<Room> rooms = new ArrayList<>();

    House(List<RoomSpec> specs) {
        for (RoomSpec s : specs) {
            rooms.add(new Room(s)); // House creates and owns Rooms; they have no life outside it
        }
    }
}
```

The practical test in an interview: **"if I delete the container, should the contained object be
deleted too?"** Yes → composition. No, it just gets disconnected → aggregation. No formal ownership
at all, just collaboration → association. This distinction directly affects how you write
constructors (does the container build its parts, or receive already-existing ones?) and
destructors/cleanup logic in real systems.

### Behavior

Once nouns (classes) and relationships are fixed, behavior is assigned by asking **"who has the
information needed to do this?"** — the classic "Information Expert" pattern from GRASP. If
computing a late fee needs `dueDate` and `returnDate`, and both live on `Loan`, then
`Loan.calculateLateFee()` is the right home for that method — not a separate `FeeCalculator` that
has to be handed both dates from outside (unless the calculation itself is complex/pluggable enough
to warrant extraction, per Phase 4's Strategy discussion). Keeping behavior next to the data it
operates on is what separates a **rich domain model** from an **anemic** one — a distinction
expanded on in Phase 5.

---

## Phase 2 — OOP

### Encapsulation

Encapsulation means hiding internal state and only exposing behavior through a controlled interface
— not just "making fields private," but making it *impossible* for external code to put an object
into an invalid state.

**Before** (state exposed, invariant unenforced):

```java
public class BankAccount {
    public double balance; // public field — anyone can set it to anything
}

// Elsewhere in the codebase:
account.balance = -500; // negative balance, nothing stops this
```

**After** (state hidden, invariant enforced at the only entry point):

```java
public class BankAccount {
    private double balance;

    public void withdraw(double amount) {
        if (amount <= 0) throw new IllegalArgumentException("Amount must be positive");
        if (amount > balance) throw new IllegalStateException("Insufficient funds");
        balance -= amount;
    }

    public void deposit(double amount) {
        if (amount <= 0) throw new IllegalArgumentException("Amount must be positive");
        balance += amount;
    }

    public double getBalance() {
        return balance;
    }
}
```

The design implication: with the public field, *every* call site that touches `balance` is a place a
bug could corrupt the account, and there's no single place to add an audit log, a fraud check, or a
currency conversion later. With the encapsulated version, `withdraw`/`deposit` are the only doors
in, so adding a new rule ("no withdrawals over $10,000 without 2FA") is a one-method change instead
of an audit of the entire codebase.

### Abstraction

Abstraction means exposing *what* an object does while hiding *how*. It's closely tied to interfaces
(Phase 4) but is a modeling principle first: a `NotificationService.send(message)` caller shouldn't
need to know whether that's implemented via SMTP, a push notification SDK, or an SMS gateway.

```java
public interface NotificationService {
    void send(String recipient, String message);
}

public class EmailNotificationService implements NotificationService {
    public void send(String recipient, String message) {
        // SMTP details hidden here
    }
}
```

Client code calls `notificationService.send(...)` and is completely insulated from the mechanism.
The design implication is that the *cost* of the underlying mechanism changing (switching email
providers, adding retry logic, adding a circuit breaker) is paid inside one class instead of at
every call site.

### Polymorphism

Polymorphism lets you call the same method name on different object types and get type-appropriate
behavior, eliminating conditional branching on type.

**Before** (type-checking branch, grows with every new shape):

```java
public double area(Object shape) {
    if (shape instanceof Circle c) {
        return Math.PI * c.getRadius() * c.getRadius();
    } else if (shape instanceof Rectangle r) {
        return r.getWidth() * r.getHeight();
    }
    throw new IllegalArgumentException("Unknown shape");
}
```

**After** (each type knows its own behavior):

```java
public interface Shape {
    double area();
}

public class Circle implements Shape {
    private final double radius;
    public double area() { return Math.PI * radius * radius; }
}

public class Rectangle implements Shape {
    private final double width, height;
    public double area() { return width * height; }
}

// Caller:
double a = shape.area(); // works for any Shape, no branching
```

Design implication: adding a `Triangle` in the "before" version means finding and editing the
`area()` method (and every other method with a similar `instanceof` chain scattered through the
codebase). In the "after" version, adding `Triangle` means writing one new class — nothing existing
is touched. This is polymorphism enabling the Open/Closed Principle, covered formally in Phase 3.

### Inheritance

Inheritance models a strict **"is-a"** relationship and lets a subclass reuse a superclass's
implementation and be substitutable for it.

```java
public abstract class Employee {
    protected String name;
    protected double baseSalary;

    public double calculatePay() {
        return baseSalary;
    }
}

public class SalesEmployee extends Employee {
    private double commission;

    @Override
    public double calculatePay() {
        return baseSalary + commission;
    }
}
```

`SalesEmployee` **is an** `Employee` — every place that expects an `Employee` can safely receive a
`SalesEmployee`. Inheritance is the right tool when: the relationship is genuinely "is-a" (not just
"has similar code to"), the subclass doesn't need to change or disable inherited behavior, and the
hierarchy is expected to stay shallow and stable. When those conditions don't hold, composition
(next section) is usually the safer choice.

### Composition

Composition builds behavior by **holding references to other objects** and delegating to them,
rather than inheriting their implementation.

```java
public class Car {
    private final Engine engine; // Car "has-a" Engine, not "is-a" Engine

    public Car(Engine engine) {
        this.engine = engine;
    }

    public void start() {
        engine.ignite();
    }
}
```

`Car` doesn't extend `Engine` — that would be nonsensical ("a car is an engine" is false), and it
wouldn't let you swap engines at runtime. Composition lets `Car` be built with any `Engine`
implementation (`ElectricEngine`, `V8Engine`) and lets that choice change without touching `Car`'s
class hierarchy.

### Composition vs Inheritance

This is one of the most interview-relevant OOP judgment calls. The classic failure mode is building
a deep inheritance tree to reuse code, then hitting a combination the hierarchy can't express.

**Before** (inheritance explosion): model birds where some fly and some don't.

```java
public class Bird {
    public void fly() {
        System.out.println("Flying");
    }
}

public class Sparrow extends Bird { }

public class Penguin extends Bird {
    @Override
    public void fly() {
        throw new UnsupportedOperationException("Penguins can't fly!"); // LSP violation — see Phase 3
    }
}
```

This already breaks Liskov Substitution (Phase 3) — a `Penguin` is-a `Bird` but throws when asked to
do something every other `Bird` can do. As you add `Ostrich`, `Emu`, `Duck` (which flies *and*
swims), and `Kiwi`, you either keep overriding methods to throw exceptions or start inserting
intermediate abstract classes like `FlightlessBird` and `SwimmingBird` — and Java doesn't allow
multiple class inheritance, so a `Duck` that both flies and swims becomes awkward to place in a
single-parent tree.

**After** (composition via behavior interfaces):

```java
public interface FlyBehavior {
    void fly();
}

public interface SwimBehavior {
    void swim();
}

public class CanFly implements FlyBehavior {
    public void fly() { System.out.println("Flying"); }
}

public class CannotFly implements FlyBehavior {
    public void fly() { System.out.println("I stay on the ground"); }
}

public class Bird {
    private final FlyBehavior flyBehavior;
    private final SwimBehavior swimBehavior;

    public Bird(FlyBehavior flyBehavior, SwimBehavior swimBehavior) {
        this.flyBehavior = flyBehavior;
        this.swimBehavior = swimBehavior;
    }

    public void performFly() { flyBehavior.fly(); }
    public void performSwim() { swimBehavior.swim(); }
}

// Composing a Penguin: doesn't fly, does swim
Bird penguin = new Bird(new CannotFly(), new CanSwim());
// Composing a Duck: flies AND swims — no hierarchy conflict
Bird duck = new Bird(new CanFly(), new CanSwim());
```

Design implication: there is no exception-throwing override, no combinatorial explosion of
subclasses, and behaviors can even be swapped at runtime (`bird.setFlyBehavior(new CanFly())` after
training, for instance). The cost is one extra layer of indirection (you're now composing objects
instead of writing `class Duck extends Bird`), which is a fair trade whenever behavior varies
independently across more than one axis. **Rule of thumb**: reach for inheritance only for a
genuine, stable "is-a" with no behavioral exceptions; reach for composition the moment you catch
yourself overriding a method just to disable or contradict what the parent does.

---

## Phase 3 — SOLID

### SRP — Single Responsibility Principle

**Definition recap**: a class should have only one reason to change. But the useful interview-level framing is: **"reason to change" means "stakeholder who could request a change here."** If a `Report` class has both formatting logic (that the UI team cares about) and persistence logic (that the DB team cares about), it has two reasons to change, and those two stakeholders will step on each other.

**Before**:

```java
public class Invoice {
    private List<LineItem> items;

    public double calculateTotal() {
        return items.stream().mapToDouble(LineItem::getPrice).sum();
    }

    public void printInvoice() {
        System.out.println("Invoice Total: " + calculateTotal());
        // formatting/printing logic mixed in
    }

    public void saveToDatabase() {
        // JDBC / persistence logic mixed in
        System.out.println("Saving invoice to DB...");
    }
}
```

**What breaks in maintenance**: the persistence team wants to switch from JDBC to a repository pattern, so they edit `Invoice`. Meanwhile the reporting team wants to change print formatting to PDF, so they *also* edit `Invoice`. Two unrelated changes now collide in the same file, in the same PR review queue, and a bug in the printing logic requires touching a class that also holds financial calculation logic — raising the blast radius of every change.

**After**:

```java
public class Invoice {
    private List<LineItem> items;

    public double calculateTotal() {
        return items.stream().mapToDouble(LineItem::getPrice).sum();
    }

    public List<LineItem> getItems() {
        return items;
    }
}

public class InvoicePrinter {
    public void print(Invoice invoice) {
        System.out.println("Invoice Total: " + invoice.calculateTotal());
    }
}

public class InvoiceRepository {
    public void save(Invoice invoice) {
        System.out.println("Saving invoice to DB...");
    }
}
```

**Flexibility gained**: `InvoicePrinter` can be replaced with `InvoicePdfExporter` without touching `Invoice` or `InvoiceRepository`. Each class can be tested, reviewed, and owned independently. **Cost**: three classes and three files instead of one — more to navigate for a trivial case, which is why SRP is a judgment call, not a mandate to atomize everything. Apply it when responsibilities genuinely have independent change drivers, not preemptively.

### OCP — Open/Closed Principle

**Definition recap**: classes should be open for extension but closed for modification — you should be able to add new behavior without editing existing, tested code.

**Before**: a discount calculator that branches on customer type.

```java
public class DiscountCalculator {
    public double applyDiscount(double price, String customerType) {
        if (customerType.equals("REGULAR")) {
            return price;
        } else if (customerType.equals("SILVER")) {
            return price * 0.95;
        } else if (customerType.equals("GOLD")) {
            return price * 0.90;
        }
        return price;
    }
}
```

**What breaks in maintenance**: every new tier (`PLATINUM`, `SEASONAL_PROMO`) requires editing this method, re-testing every existing branch (regression risk), and — worse — this pattern tends to metastasize: the same `if/else` chain on `customerType` gets copy-pasted into `ShippingCalculator`, `LoyaltyPointsCalculator`, etc., each needing the same edit for every new tier.

**After**: extract the varying behavior behind an interface (Strategy pattern).

```java
public interface DiscountStrategy {
    double apply(double price);
}

public class RegularDiscount implements DiscountStrategy {
    public double apply(double price) { return price; }
}

public class SilverDiscount implements DiscountStrategy {
    public double apply(double price) { return price * 0.95; }
}

public class GoldDiscount implements DiscountStrategy {
    public double apply(double price) { return price * 0.90; }
}

public class DiscountCalculator {
    public double applyDiscount(double price, DiscountStrategy strategy) {
        return strategy.apply(price);
    }
}

// Adding PLATINUM later:
public class PlatinumDiscount implements DiscountStrategy {
    public double apply(double price) { return price * 0.80; }
}
// DiscountCalculator is never touched.
```

**Flexibility gained**: new discount tiers are new classes, not edits to tested code — zero regression risk on existing tiers. **Cost**: more files, and an extra layer of indirection that can be overkill if the set of variants is genuinely fixed forever (e.g., a boolean flag that will only ever have two states). OCP is worth paying for when the axis of variation is known to grow; it's over-engineering when applied to something that never changes.

### LSP — Liskov Substitution Principle

**Definition recap**: subtypes must be substitutable for their base types without altering the correctness of the program — i.e., code written against the base type shouldn't break when handed a subtype.

**Before**: the textbook Rectangle/Square violation.

```java
public class Rectangle {
    protected int width, height;

    public void setWidth(int width) { this.width = width; }
    public void setHeight(int height) { this.height = height; }
    public int getArea() { return width * height; }
}

public class Square extends Rectangle {
    @Override
    public void setWidth(int width) {
        this.width = width;
        this.height = width; // forces both to stay equal
    }

    @Override
    public void setHeight(int height) {
        this.width = height;
        this.height = height;
    }
}

// Client code written against Rectangle:
void resize(Rectangle r) {
    r.setWidth(5);
    r.setHeight(10);
    assert r.getArea() == 50; // FAILS for Square — area is 100
}
```

**What breaks in maintenance**: any code written and tested against `Rectangle`'s contract silently produces wrong results when a `Square` is substituted in, because `Square` secretly changes the meaning of `setWidth`/`setHeight`. This is worse than a compile error — it's a runtime correctness bug that only shows up when the "wrong" concrete type flows through generic code, often far from where `Square` was constructed.

**After**: stop modeling `Square` as a subtype of mutable `Rectangle`. Use a common, narrower abstraction that doesn't imply independently-settable dimensions.

```java
public interface Shape {
    int getArea();
}

public class Rectangle implements Shape {
    private final int width, height;
    public Rectangle(int width, int height) { this.width = width; this.height = height; }
    public int getArea() { return width * height; }
}

public class Square implements Shape {
    private final int side;
    public Square(int side) { this.side = side; }
    public int getArea() { return side * side; }
}
```

**Flexibility gained**: any code that consumes `Shape` and only calls `getArea()` works correctly for every shape, with no hidden behavioral surprises. **Cost**: `Square` no longer inherits `Rectangle`'s field-setting behavior, so if you genuinely need mutable, independently-resizable rectangles elsewhere, that's a separate, honestly-named type. The lesson generalizes: **if a subclass has to weaken a precondition, strengthen a postcondition, or throw on a method the parent supports, the inheritance relationship is wrong**, not the subclass's implementation.

### ISP — Interface Segregation Principle

**Definition recap**: clients shouldn't be forced to depend on methods they don't use — prefer several small, role-specific interfaces over one large, general-purpose one.

**Before**: one fat `Worker` interface.

```java
public interface Worker {
    void work();
    void eat();
}

public class HumanWorker implements Worker {
    public void work() { System.out.println("Working"); }
    public void eat() { System.out.println("Eating lunch"); }
}

public class RobotWorker implements Worker {
    public void work() { System.out.println("Working"); }
    public void eat() {
        throw new UnsupportedOperationException("Robots don't eat"); // forced, meaningless implementation
    }
}
```

**What breaks in maintenance**: `RobotWorker` is forced to implement `eat()` even though it's meaningless for it, so it either throws (a landmine for any caller that iterates over `List\<Worker>` and calls `eat()` on everything) or silently no-ops (a different kind of landmine — callers think something happened). Every new `Worker` capability added to the interface (`void takeVacation()`, `void receivePaycheck()`) forces every implementer, robotic or human, to deal with methods irrelevant to it.

**After**: split by capability.

```java
public interface Workable {
    void work();
}

public interface Eatable {
    void eat();
}

public class HumanWorker implements Workable, Eatable {
    public void work() { System.out.println("Working"); }
    public void eat() { System.out.println("Eating lunch"); }
}

public class RobotWorker implements Workable {
    public void work() { System.out.println("Working"); } // no eat() forced on it
}
```

**Flexibility gained**: code that only cares about work (`List\<Workable>`) never has to know or care whether an implementer can eat; there's no dead/throwing method anywhere. **Cost**: more interfaces to define and wire up — worthwhile once you have genuinely divergent implementers (humans vs. robots), unnecessary if every implementer really does need every method.

### DIP — Dependency Inversion Principle

**Definition recap**: high-level modules shouldn't depend on low-level modules; both should depend on abstractions. (Not to be confused with Dependency *Injection*, the mechanical technique covered in Phase 4 — DIP is the design principle; DI is one way to satisfy it.)

**Before**: a high-level `OrderService` directly instantiates and depends on a concrete low-level `MySqlOrderRepository`.

```java
public class MySqlOrderRepository {
    public void save(Order order) {
        System.out.println("Saving order to MySQL");
    }
}

public class OrderService {
    private final MySqlOrderRepository repository = new MySqlOrderRepository(); // hard-wired

    public void placeOrder(Order order) {
        repository.save(order);
    }
}
```

**What breaks in maintenance**: `OrderService` (business logic, the thing you want stable) is now coupled to a specific database technology (an implementation detail, the thing most likely to change). Switching to DynamoDB, or writing a unit test for `OrderService` without hitting a real MySQL instance, both require editing `OrderService` itself. The dependency arrow points from high-level policy to low-level detail — backwards from what you want.

**After**: introduce an abstraction that both sides depend on.

```java
public interface OrderRepository {
    void save(Order order);
}

public class MySqlOrderRepository implements OrderRepository {
    public void save(Order order) { System.out.println("Saving order to MySQL"); }
}

public class DynamoOrderRepository implements OrderRepository {
    public void save(Order order) { System.out.println("Saving order to DynamoDB"); }
}

public class OrderService {
    private final OrderRepository repository;

    public OrderService(OrderRepository repository) { // depends on the abstraction
        this.repository = repository;
    }

    public void placeOrder(Order order) {
        repository.save(order);
    }
}
```

**Flexibility gained**: `OrderService` never changes when the storage technology changes, and it can be unit-tested with an in-memory fake `OrderRepository` implementation with zero database involved. **Cost**: an interface plus at least one more class than the direct version — again, judged worthwhile whenever the low-level detail is genuinely likely to change or needs to be swapped out for testing, which in production systems is almost always true for I/O boundaries (databases, external APIs, file systems).

---

## Phase 4 — Interfaces & Extensibility

### Interfaces

An interface is a pure contract — a set of method signatures with no implementation (default methods
aside) and no state. It answers "what can you do," never "how do you do it, or what do you
remember." In Java:

```java
public interface PaymentGateway {
    PaymentResult charge(Money amount, CardDetails card);
    void refund(String transactionId, Money amount);
}
```

Any number of unrelated classes (`StripeGateway`, `PaypalGateway`, `MockGateway` for tests) can
implement this without any of them being related by inheritance — interfaces let you group by
*capability* rather than by *ancestry*, which is exactly what multiple-inheritance-of-behavior needs
and what Java's single-inheritance class model can't otherwise give you.

### Abstract Classes

An abstract class sits between interfaces and concrete classes: it can hold state, provide some
concrete method implementations, and still leave some methods unimplemented for subclasses to fill
in (the Template Method pattern).

```java
public abstract class ReportGenerator {
    public final void generate() { // template method — controls the algorithm shape
        fetchData();
        formatData();
        exportReport();
    }

    protected void fetchData() {
        System.out.println("Fetching data from default source");
    }

    protected abstract void formatData(); // subclasses must define this
    protected abstract void exportReport(); // and this
}

public class PdfReportGenerator extends ReportGenerator {
    protected void formatData() { System.out.println("Formatting as PDF layout"); }
    protected void exportReport() { System.out.println("Exporting .pdf file"); }
}
```

**Interface vs. abstract class — the decision.** Use an interface when unrelated classes need to share a capability with zero shared code or state (`Comparable`, `Serializable`, `PaymentGateway` above). Use an abstract class when subclasses share genuine common state and some common implementation, and the relationship really is "is-a specific kind of" (all `ReportGenerator`s share the same fetch→format→export skeleton). A practical rule: **can you imagine a class needing to inherit from two of these at once?** If yes, it must be an interface (Java forbids multiple class inheritance). If the shared logic is substantial and the hierarchy is genuinely singular, an abstract class saves duplicating that logic in every subclass.

### Dependency Inversion (Applied)

Building on Phase 3's DIP, the *applied* pattern is: define the abstraction from the high-level
module's point of view, not the low-level module's. `OrderService` should define what it needs
(`OrderRepository.save(Order)`), and low-level modules conform to that — not the other way around,
where a database class dictates a wide, leaky interface that business logic has to work around. This
"the interface belongs to the consumer" framing is what separates DIP done well from DIP done as
ceremony.

### Dependency Injection

Dependency Injection (DI) is the mechanical technique of supplying an object's dependencies from the
outside rather than having it construct them itself — the most common way to satisfy DIP in
practice.

**Before** (dependency self-constructed, hidden, unreplaceable):

```java
public class OrderService {
    private final EmailNotifier notifier = new EmailNotifier(); // hidden, hardcoded

    public void placeOrder(Order order) {
        // ... process order
        notifier.notify(order.getCustomerEmail(), "Order placed!");
    }
}
```

**After** (constructor injection):

```java
public class OrderService {
    private final Notifier notifier; // depends on an interface

    public OrderService(Notifier notifier) { // injected from outside
        this.notifier = notifier;
    }

    public void placeOrder(Order order) {
        // ... process order
        notifier.notify(order.getCustomerEmail(), "Order placed!");
    }
}

// Composition root (e.g., main(), or a DI framework like Spring):
OrderService service = new OrderService(new EmailNotifier());
// Test code:
OrderService testService = new OrderService(new FakeNotifier());
```

Constructor injection specifically (versus field or setter injection) is generally preferred because
it makes dependencies **visible in the type signature**, guarantees the object is never in a
partially-constructed state (no `null` notifier), and lets fields be `final`. This is elaborated on
in Phase 7's Testability section — DI is the single biggest lever for making business logic unit-
testable without a live database, network, or filesystem.

### Pluggable Behavior

"Pluggable behavior" is the practical payoff of interfaces + DI: behavior can be swapped by passing
a different implementation, with no change to the class that uses it. The `DiscountStrategy` example
from OCP (Phase 3) and the `FlyBehavior`/`SwimBehavior` example from Composition (Phase 2) are both
instances of this — a class holds a reference to an interface, and *what actually runs* is decided
by whichever concrete implementation was injected. This is how production systems support feature
flags, A/B-tested algorithms, and per-tenant customization without branching logic scattered through
the codebase: the branch happens once, at composition time (often in configuration or a factory),
not at every call site.

### Change Isolation

Change isolation is the cumulative effect of everything above: a well-drawn interface boundary means
a change on one side (swapping `MySqlOrderRepository` for `DynamoOrderRepository`, or
`EmailNotifier` for `SmsNotifier`) never requires touching, retesting, or redeploying code on the
other side. In an interview, when asked "how would you extend this system to support X," the strong
answer isn't "I'd add an `if` for X" — it's "I'd check whether X is a new implementation of an
existing interface; if the interface is drawn correctly, adding X touches zero existing files." That
property — new capability without editing tested code — is the entire practical point of OCP, DIP,
and DI working together.

---

## Phase 5 — State & Behavior

### State Machines

Many real entities — an `Order`, a `TCP connection`, a `document approval workflow` — are best
modeled explicitly as a **finite state machine**: a fixed set of states, and a fixed set of legal
transitions between them triggered by events.

Consider an `Order`:

```
        place()              pay()               ship()              deliver()
CREATED ────────► PENDING_PAYMENT ────► PAID ────────► SHIPPED ────────► DELIVERED
                        │                  │
                        │ cancel()         │ cancel()
                        ▼                  ▼
                    CANCELLED          CANCELLED
```

```java
public enum OrderStatus {
    CREATED, PENDING_PAYMENT, PAID, SHIPPED, DELIVERED, CANCELLED
}

public class Order {
    private OrderStatus status = OrderStatus.CREATED;

    private static final Map<OrderStatus, Set<OrderStatus>> ALLOWED_TRANSITIONS = Map.of(
        OrderStatus.CREATED,         Set.of(OrderStatus.PENDING_PAYMENT),
        OrderStatus.PENDING_PAYMENT, Set.of(OrderStatus.PAID, OrderStatus.CANCELLED),
        OrderStatus.PAID,            Set.of(OrderStatus.SHIPPED, OrderStatus.CANCELLED),
        OrderStatus.SHIPPED,         Set.of(OrderStatus.DELIVERED),
        OrderStatus.DELIVERED,       Set.of(),
        OrderStatus.CANCELLED,       Set.of()
    );

    public void transitionTo(OrderStatus newStatus) {
        Set<OrderStatus> allowed = ALLOWED_TRANSITIONS.get(this.status);
        if (!allowed.contains(newStatus)) {
            throw new IllegalStateException(
                "Cannot transition from " + status + " to " + newStatus);
        }
        this.status = newStatus;
    }
}
```

Modeling state explicitly like this — rather than a bare `String status` field mutated freely from
anywhere — means illegal transitions (shipping a cancelled order, delivering an order that was never
paid) are caught in one place, at the moment they're attempted, instead of manifesting later as a
data integrity bug discovered in production.

### Valid Transitions

The transition table above *is* the specification — notice `SHIPPED` cannot go directly to
`CANCELLED` (you can't cancel something already shipped in this model; that would need a `RETURN`
flow instead), and `DELIVERED`/`CANCELLED` are terminal states with no outgoing transitions.
Encoding this as data (a `Map`) rather than as scattered `if` statements means the *entire* set of
legal transitions is visible and auditable in one place — valuable both for code review and for
onboarding engineers who need to understand what an `Order` can and can't do.

### Invariants

An invariant is a condition that must hold true for an object at all times (or at least, at the end
of every public method call). For `BankAccount`, "balance never goes negative" is an invariant. For
`Order`, "cannot have items added after it reaches PAID" is an invariant. Invariants are enforced
the same way encapsulation enforces state validity (Phase 2) — by routing all mutation through
methods that check the condition before allowing the change:

```java
public class Order {
    private OrderStatus status;
    private List<LineItem> items = new ArrayList<>();

    public void addItem(LineItem item) {
        if (status != OrderStatus.CREATED) {
            throw new IllegalStateException("Cannot modify items after order is placed");
        }
        items.add(item);
    }
}
```

Invariants and state machines compose naturally: many invariants are really "this field can only be
touched while the object is in state X."

### Validation

Validation checks *input* against rules before it's allowed to affect state; invariants protect the
*object's* internal consistency after the fact. In practice both matter, and they belong at
different layers:

```java
public class RegisterUserRequest {
    private final String email;
    private final String password;

    public RegisterUserRequest(String email, String password) {
        if (email == null || !email.contains("@")) {
            throw new IllegalArgumentException("Invalid email");
        }
        if (password == null || password.length() < 8) {
            throw new IllegalArgumentException("Password too short");
        }
        this.email = email;
        this.password = password;
    }
}
```

Validating in the constructor of a value-object-like request means it is **impossible to construct
an invalid instance** — every downstream consumer of `RegisterUserRequest` can trust it without re-
validating. This is sometimes called "parse, don't validate": push validation to the boundary and
let the type system guarantee the rest of the code never sees bad data.

### Domain Behavior

This is the payoff of everything in this phase: the choice between a **rich domain model** (entities
own their behavior and enforce their own invariants — everything above) and an **anemic domain
model** (entities are bags of getters/setters, and all the logic lives in outside "service"
classes).

**Anemic** (a common anti-pattern in enterprise Java):

```java
public class Order {
    private OrderStatus status;
    private List<LineItem> items;
    // just getters and setters, no behavior, no protection
    public OrderStatus getStatus() { return status; }
    public void setStatus(OrderStatus status) { this.status = status; }
    public List<LineItem> getItems() { return items; }
    public void setItems(List<LineItem> items) { this.items = items; }
}

public class OrderService {
    public void ship(Order order) {
        // business rule lives outside the entity — anyone could bypass it
        if (order.getStatus() == OrderStatus.PAID) {
            order.setStatus(OrderStatus.SHIPPED);
        }
    }
}
```

The problem: nothing stops another piece of code from calling `order.setStatus(OrderStatus.SHIPPED)`
directly and skipping the check entirely — the rule only holds as long as every caller remembers to
go through `OrderService`. As the codebase grows, rules get duplicated or bypassed inconsistently
across services.

**Rich domain model** (the `Order` from the State Machines section above): the entity itself refuses illegal transitions no matter who calls it or from where, because the invariant lives inside the object, not beside it. Business rules become impossible to bypass by construction rather than "please remember to call the right service" — a materially stronger guarantee at scale, and the recommended default for any entity with real lifecycle rules.

---

## Phase 6 — Concurrency

### Thread Safety

A class is thread-safe if it behaves correctly when accessed by multiple threads concurrently, with
no external synchronization required by the caller. "Correctly" means: no data corruption, no lost
updates, no observation of a half-updated state — regardless of how the threads are scheduled or
interleaved. Thread safety is not a yes/no property of code that *looks* fine in isolation; it's a
property that only shows up under concurrent access, which is why it's so easy to ship a race
condition that passes every single-threaded test.

### Race Conditions

A race condition occurs when the correctness of a result depends on the relative timing of threads —
most commonly, a "check-then-act" or "read-modify-write" sequence that isn't atomic.

**Before** (classic lost-update race):

```java
public class Counter {
    private int count = 0;

    public void increment() {
        count = count + 1; // NOT atomic: read, add, write are three separate steps
    }

    public int getCount() {
        return count;
    }
}
```

If two threads call `increment()` concurrently, both can read `count` as `5`, both compute `6`, both
write `6` back — one increment is silently lost. Run 1,000 increments across 10 threads and the
final count is reliably *less* than 1,000, non-deterministically.

**After** (synchronized method — simplest fix):

```java
public class Counter {
    private int count = 0;

    public synchronized void increment() {
        count = count + 1; // only one thread can execute this block at a time
    }

    public synchronized int getCount() {
        return count;
    }
}
```

**After, alternative** (lock-free, generally preferred for a simple counter — see Atomic Operations below):

```java
public class Counter {
    private final AtomicInteger count = new AtomicInteger(0);

    public void increment() {
        count.incrementAndGet();
    }

    public int getCount() {
        return count.get();
    }
}
```

### Locks

A lock ensures only one thread executes a critical section at a time. Java's `synchronized` keyword
is the built-in intrinsic lock; `java.util.concurrent.locks.ReentrantLock` offers more control
(tryLock with timeout, interruptible waits, fairness policies):

```java
public class Account {
    private double balance;
    private final ReentrantLock lock = new ReentrantLock();

    public void transfer(Account to, double amount) {
        lock.lock();
        try {
            if (this.balance < amount) throw new IllegalStateException("Insufficient funds");
            this.balance -= amount;
            to.balance += amount; // NOTE: real code needs consistent lock ordering to avoid deadlock
        } finally {
            lock.unlock(); // always unlock in finally
        }
    }
}
```

The `try/finally` pattern is non-negotiable with explicit locks — an exception thrown mid-critical-
section without a `finally` unlock leaves the lock held forever, deadlocking every other thread that
needs it. Locks trade throughput (only one thread proceeds at a time through the critical section)
for correctness; the design skill is minimizing what's *inside* the lock so contention stays low.

### Atomic Operations

An atomic operation completes as a single, indivisible step from every other thread's point of view
— no other thread can observe it "half-done." Java's `java.util.concurrent.atomic` package
(`AtomicInteger`, `AtomicLong`, `AtomicReference`) provides lock-free atomic operations built on
CPU-level compare-and-swap (CAS) instructions:

```java
AtomicInteger balance = new AtomicInteger(100);

// Atomic compare-and-swap: only succeeds if current value matches expected
boolean success = balance.compareAndSet(100, 80); // withdraw 20, only if balance is still 100
```

Atomics are generally faster than locks under moderate contention because they avoid OS-level thread
blocking/context-switching — the CPU retries the CAS instruction instead of parking the thread. For
a single counter or flag, prefer an atomic type over `synchronized`; for multi-step invariants
spanning several fields (like the `transfer` example above), a lock is usually clearer and safer
than trying to compose multiple atomics correctly.

### Immutability

An immutable object's state cannot change after construction — and an object that never changes
**cannot have a race condition**, because there is nothing for concurrent threads to corrupt. This
is why `Money` (Phase 1) being immutable wasn't just a modeling nicety — it's a concurrency
guarantee for free.

```java
public final class Point {
    private final int x, y;

    public Point(int x, int y) { this.x = x; this.y = y; }

    public Point translate(int dx, int dy) {
        return new Point(this.x + dx, this.y + dy); // returns a new object, never mutates
    }

    public int getX() { return x; }
    public int getY() { return y; }
}
```

Any number of threads can hold and read the same `Point` instance simultaneously with zero
synchronization needed — there's no write to race against. This is why functional-style, immutable
data modeling is prized in highly concurrent systems: it eliminates a whole category of bugs at the
design level, rather than requiring careful lock discipline at every access site.

### Concurrent Collections

Standard collections (`ArrayList`, `HashMap`) are not thread-safe — concurrent modification from
multiple threads can corrupt internal structure (e.g., `HashMap`'s internal linked structure can end
up in an infinite loop during concurrent resizing) or throw `ConcurrentModificationException`.
`java.util.concurrent` provides purpose-built alternatives:

```java
Map<String, Integer> cache = new ConcurrentHashMap<>(); // safe concurrent reads/writes, fine-grained locking internally
List<String> log = new CopyOnWriteArrayList<>();        // safe for many readers, occasional writers (write copies the whole array)
Queue<Task> tasks = new ConcurrentLinkedQueue<>();       // lock-free queue for producer/consumer patterns
```

`ConcurrentHashMap` is the default choice for a shared cache or lookup table under concurrent access
— it allows concurrent reads and writes without locking the entire map (unlike
`Collections.synchronizedMap(new HashMap<>())`, which serializes *all* access behind one lock).
`CopyOnWriteArrayList` fits read-heavy, write-rare scenarios (e.g., a list of event listeners) since
every write pays the cost of copying the backing array. Picking the right concurrent collection is a
concrete, low-effort way to get thread safety without hand-writing lock logic.

---

## Phase 7 — Code Quality

### Cohesion

Cohesion measures how closely the responsibilities *within* a single class relate to each other.
High cohesion means every method and field in the class works together toward one purpose — which is
SRP's practical, everyday face at the code level (Phase 3). A class with high cohesion is easy to
name accurately, easy to describe in one sentence, and easy to unit test in isolation because its
behavior doesn't secretly depend on unrelated state living inside it.

### Coupling

Coupling measures how much one class depends on the internal details of another. Low coupling —
achieved through interfaces, DI, and clear boundaries (Phase 4) — means a change in one class is
unlikely to force a change in another. High cohesion and low coupling are usually presented together
because they trade off in the same direction: badly-drawn class boundaries (low cohesion) tend to
also produce classes that reach into each other's internals (high coupling), while well-drawn
boundaries produce both good cohesion and low coupling as a side effect.

### Testability

Testability is the most concrete, provable payoff of DI (Phase 4). A class with dependencies
injected as interfaces can be tested with fakes/mocks, with zero real database, network, or
filesystem involvement.

```java
public interface Notifier {
    void notify(String recipient, String message);
}

public class OrderService {
    private final Notifier notifier;
    public OrderService(Notifier notifier) { this.notifier = notifier; }

    public void placeOrder(Order order) {
        // ... business logic
        notifier.notify(order.getCustomerEmail(), "Order placed!");
    }
}

// Unit test — no real email is ever sent:
public class OrderServiceTest {
    @Test
    public void placeOrder_sendsNotification() {
        FakeNotifier fake = new FakeNotifier(); // records calls instead of sending
        OrderService service = new OrderService(fake);

        service.placeOrder(new Order(/* ... */));

        assertTrue(fake.wasCalledWith("customer@example.com", "Order placed!"));
    }
}

class FakeNotifier implements Notifier {
    private final List<String[]> calls = new ArrayList<>();
    public void notify(String recipient, String message) {
        calls.add(new String[]{recipient, message});
    }
    public boolean wasCalledWith(String recipient, String message) {
        return calls.stream().anyMatch(c -> c[0].equals(recipient) && c[1].equals(message));
    }
}
```

Compare this to the "before" version of `OrderService` from Phase 4, where `EmailNotifier` was
constructed internally with `new` — that version is untestable without either sending a real email
in every test run or resorting to fragile bytecode-manipulation mocking frameworks. Constructor
injection turns "hard to test" into "trivial to test" as a direct, mechanical consequence — this is
the single strongest practical argument for DI, stronger even than the architectural DIP argument in
Phase 3.

### Error Handling

Good error handling communicates failure through the type system and forces callers to acknowledge
it, rather than failing silently or crashing with an unhelpful stack trace three layers away from
the actual cause.

```java
public class InsufficientFundsException extends RuntimeException {
    public InsufficientFundsException(double requested, double available) {
        super(String.format("Requested %.2f but only %.2f available", requested, available));
    }
}

public class Account {
    private double balance;

    public void withdraw(double amount) {
        if (amount > balance) {
            throw new InsufficientFundsException(amount, balance); // specific, actionable
        }
        balance -= amount;
    }
}
```

A specific exception type (`InsufficientFundsException`) lets calling code catch and handle *that
exact failure mode* differently from, say, a network timeout — versus throwing a generic
`RuntimeException("error")` that forces every caller to either catch everything indiscriminately or
let it propagate uninformatively. The general rule: fail fast, fail with enough context to diagnose
without a debugger, and design exception types around what a *caller* needs to distinguish, not
around what's convenient to throw.

### Maintainability

Maintainability isn't a separate technique — it's the accumulated outcome of everything in this
document done well: high cohesion, low coupling, SOLID boundaries, explicit state machines, and good
test coverage combine to make future changes cheap and low-risk. The single best proxy question for
maintainability in an interview: **"if requirement X changed tomorrow, how many files would need to
change, and how confident would you be that nothing else broke?"** A well-factored design answers
"one or two files, and the test suite would tell me immediately if something broke."

### YAGNI

"You Aren't Gonna Need It" — don't build abstraction, configuration, or flexibility for a
requirement that doesn't exist yet. A `PaymentGateway` interface (Phase 4) is justified because the
problem statement already mentions multiple payment providers; a `PaymentGateway` interface built
"just in case we need Stripe and PayPal someday" when only one provider is in scope is speculative
complexity that costs real navigation and cognitive overhead for a flexibility nobody asked for. In
an interview, if asked to design for one concrete case, build for that case — but *do* mention out
loud where you'd introduce a seam (an interface boundary) if a second implementation were requested,
which demonstrates judgment without over-building.

### DRY

"Don't Repeat Yourself" — every piece of business knowledge should have one authoritative
representation. But DRY applies to *knowledge*, not to *text that merely looks similar*. Two
validation checks that happen to both be one line long but represent unrelated rules (`age >= 18`
for adult content vs. `age >= 18` for a legal drinking age in some jurisdiction) should **not** be
merged just because the code is textually identical — one rule changing shouldn't silently change
the other. Real DRY violations are things like the pricing calculation duplicated across
`OrderService` and `InvoiceService` — if the tax rate formula changes, both need to change in
lockstep, and it's only a matter of time before someone updates one and misses the other.

### KISS

"Keep It Simple, Stupid" — given two designs that satisfy the requirements, prefer the one with
fewer moving parts. This is the meta-principle behind everything above: SOLID, DI, and design
patterns are tools for managing *genuine* complexity (multiple implementations, changing
requirements, concurrent access) — they are not goals in themselves. A three-line `if/else` handling
two fixed, permanent cases does not need to become a Strategy pattern with an interface and two
classes; that's not flexibility, it's ceremony. The senior-level skill this whole document is really
testing is knowing **which** principle applies to the problem in front of you, and stopping the
moment simpler code satisfies the actual requirement.

---

> **Framing question, revisited: How should responsibilities inside a component be organized?**
>
> Around clear, single-purpose ownership (Phase 1 and SRP) — expressed through the right
relationship between objects (composition over inheritance where behavior varies), protected by
encapsulated invariants and explicit state machines (Phase 5), made extensible through interfaces
and dependency inversion rather than conditional branching (Phase 3 and 4), made safe under
concurrent access through immutability and the right synchronization primitive (Phase 6) — and, at
every step, no more elaborate than the actual, current requirements justify (Phase 7).
