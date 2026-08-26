# Stage 7 (Part A) — LLD Mastery: Design Patterns
Last updated: 2026-08-27
_Overview and notes._
Last updated: 2026-08-27

> **Framing question: Can I create software that remains clean when requirements change?**

Every section in this document follows one rule, and it is non-negotiable:

```
Problem → changing behavior → abstraction → pattern
```

**Never** the reverse. You do not open a design by picking a pattern and then
massaging a problem to fit it. That is how you end up with a `FactoryFactory`
and a codebase nobody wants to touch. A pattern is a *name for a shape your
code already needs to have* once you notice that something varies — an
algorithm, a family of objects, a construction sequence, a notification list,
a state machine. If nothing varies, you don't need the pattern; you need a
class, a function, or nothing at all.

Interviewers at the senior/staff level are not scoring you on "did you use
the Strategy pattern." They are scoring you on: *did you notice the axis of
change, and did you isolate it so the rest of the system doesn't have to
know about it.* Say the pattern's name only after you've named the change.

---

## Table of Contents

**Creational**
1. [Factory Method](#factory-method)
2. [Abstract Factory](#abstract-factory)
3. [Builder](#builder)
4. [Singleton](#singleton)
5. [Prototype](#prototype-concept-level)

**Structural**
6. [Adapter](#adapter)
7. [Decorator](#decorator)
8. [Facade](#facade)
9. [Composite](#composite)
10. [Proxy](#proxy)

**Behavioral**
11. [Strategy](#strategy)
12. [Observer](#observer)
13. [State](#state)
14. [Command](#command)
15. [Chain of Responsibility](#chain-of-responsibility)
16. [Template Method](#template-method)
17. [Iterator](#iterator-concept-level)

**Wrap-up**
- [Decision Table: Symptom → Pattern](#decision-table-symptom--pattern)
- [Closing: the framing question, answered](#closing-the-framing-question-answered)

---

# Creational Patterns
Last updated: 2026-08-27
_Overview and notes._
Last updated: 2026-08-27

Creational patterns exist because **object construction is itself a place
requirements change**: which concrete class to instantiate, how many steps
construction takes, whether one instance should exist, or how to clone an
expensive-to-build object. If construction is a single `new` with no
variation, you don't need any of these.

## Factory Method

### 1. The motivating problem

You're building a payment processing system (think PayPal). It started with
one payment type — credit card. Someone wrote this directly in the checkout
service:

```java
class CheckoutService {
    public PaymentProcessor getProcessor(String type) {
        if (type.equals("CREDIT_CARD")) {
            return new CreditCardProcessor();
        }
        throw new IllegalArgumentException("Unknown type");
    }
}
```

Then the business adds PayPal wallet, then ACH bank transfer, then Venmo,
then BNPL. Every new payment method means opening `CheckoutService` again and
adding another `else if`. This class now has two reasons to change: checkout
*orchestration logic* and *which processor to construct*. Every new payment
rail risks breaking existing ones because they all live in the same growing
conditional, and every team that owns a new rail has to send a PR into a file
they don't own.

```java
public PaymentProcessor getProcessor(String type) {
    if (type.equals("CREDIT_CARD")) return new CreditCardProcessor();
    else if (type.equals("PAYPAL_WALLET")) return new PayPalWalletProcessor();
    else if (type.equals("ACH")) return new ACHProcessor();
    else if (type.equals("VENMO")) return new VenmoProcessor();
    else if (type.equals("BNPL")) return new BNPLProcessor(); // and it keeps growing...
    else throw new IllegalArgumentException("Unknown type");
}
```

**The axis of change**: *which concrete `PaymentProcessor` subclass to
create*, driven by something decided at runtime (payment method selected by
the user). That variability needs a seam.

### 2. The pattern applied

Push the decision of "which concrete class" down into subclasses (or a
registry), and let callers depend only on the abstract product.

```java
interface PaymentProcessor {
    void process(BigDecimal amount);
}

abstract class PaymentProcessorCreator {
    // Factory Method — subclasses decide the concrete type
    protected abstract PaymentProcessor createProcessor();

    public final void checkout(BigDecimal amount) {
        PaymentProcessor processor = createProcessor();
        processor.process(amount);
    }
}

class CreditCardCheckout extends PaymentProcessorCreator {
    protected PaymentProcessor createProcessor() { return new CreditCardProcessor(); }
}

class PayPalWalletCheckout extends PaymentProcessorCreator {
    protected PaymentProcessor createProcessor() { return new PayPalWalletProcessor(); }
}
```

In practice, most production code uses the "simple factory + registry"
variant instead of a subclass per creator (fewer classes, same seam):

```java
class PaymentProcessorFactory {
    private static final Map<String, Supplier<PaymentProcessor>> REGISTRY = Map.of(
        "CREDIT_CARD",    CreditCardProcessor::new,
        "PAYPAL_WALLET",  PayPalWalletProcessor::new,
        "ACH",            ACHProcessor::new
    );

    public PaymentProcessor create(String type) {
        Supplier<PaymentProcessor> ctor = REGISTRY.get(type);
        if (ctor == null) throw new IllegalArgumentException("Unknown type: " + type);
        return ctor.get();
    }
}
```

New payment rail → register it in the map (or add a subclass), never touch
`CheckoutService`. Open for extension, closed for modification.

### 3. UML-style diagram

```
        PaymentProcessorCreator                 <<interface>>
        -----------------------                 PaymentProcessor
        + checkout(amount)                       ---------------
        # createProcessor(): Processor            + process(amount)
                 ^                                       ^
        _________|_________                    __________|__________
       |                   |                   |                     |
CreditCardCheckout   PayPalWalletCheckout  CreditCardProcessor  PayPalWalletProcessor
+createProcessor()   +createProcessor()    creates ^                creates ^
       |___________________|______________________|                        |
                            (each Creator produces its matching Product)
```

### 4. Real-world usage

- **`java.util.Calendar.getInstance()`** — returns a `GregorianCalendar` or a
  locale-specific subclass depending on locale/timezone, without the caller
  ever naming a concrete class.
- **`java.nio.file.Files.newBufferedReader`** / `Iterator` returned by
  `Collection.iterator()` — the concrete `Iterator` implementation varies per
  collection type, hidden behind a factory method on the interface.
- **Spring's `BeanFactory`** — the whole DI container is a giant factory
  method system: you ask for a type, Spring decides (via configuration) which
  concrete bean to hand back.

### 5. Trade-offs / when not to use

- **Pro**: new product types added without touching client code (Open/Closed
  Principle); decouples "what to build" from "how to use it."
- **Con**: if you only ever have *one* concrete product and no credible
  roadmap for a second, this is a class (or map entry) you didn't need —
  Factory Method for a single implementation is ceremony, not design.
- **Con**: subclass-per-creator variant can explode your class count; prefer
  the registry/map form unless each creator genuinely needs different
  orchestration logic, not just a different product.

### 6. How it shows up in an LLD interview

"Design a parking lot" / "design a ride-sharing dispatch" / "design a payment
gateway" almost always has a moment where the interviewer says "now add a new
[vehicle type / driver tier / payment method]." If your design requires
editing an `if/else` chain in a core service to satisfy that, that's your
signal to introduce Factory Method (or the registry variant) — and you should
say out loud *why*: "the type of processor to construct is the part that
varies, so I'm isolating that into a factory rather than growing this
conditional forever."

---

## Abstract Factory

### 1. The motivating problem

Your payment system now needs to support multiple **regions**, each with its
own *family* of compliant components: a region-specific fraud checker, a
region-specific tax calculator, and a region-specific receipt formatter (US
vs EU vs India — different regulatory bodies, different formats). Naively:

```java
class TransactionService {
    void process(String region) {
        FraudChecker fraud;
        TaxCalculator tax;
        ReceiptFormatter receipt;

        if (region.equals("US")) {
            fraud = new USFraudChecker();
            tax = new USTaxCalculator();
            receipt = new USReceiptFormatter();
        } else if (region.equals("EU")) {
            fraud = new EUFraudChecker();
            tax = new EUVatCalculator();
            receipt = new EUReceiptFormatter();
        }
        // ... every method that needs any of these three repeats this branching
    }
}
```

The pain isn't one factory method — it's that **three related objects must
always be chosen together, consistently**, and that consistency lives
nowhere. It's easy to accidentally mix a `USFraudChecker` with an
`EUTaxCalculator` because someone updated one branch and not the other. The
axis of change is "region," but it fans out across an entire *family* of
collaborating objects that must stay compatible.

### 2. The pattern applied

One factory interface produces the whole family; concrete factories
guarantee the family stays internally consistent.

```java
interface RegionComponentFactory {
    FraudChecker createFraudChecker();
    TaxCalculator createTaxCalculator();
    ReceiptFormatter createReceiptFormatter();
}

class USComponentFactory implements RegionComponentFactory {
    public FraudChecker createFraudChecker() { return new USFraudChecker(); }
    public TaxCalculator createTaxCalculator() { return new USTaxCalculator(); }
    public ReceiptFormatter createReceiptFormatter() { return new USReceiptFormatter(); }
}

class EUComponentFactory implements RegionComponentFactory {
    public FraudChecker createFraudChecker() { return new EUFraudChecker(); }
    public TaxCalculator createTaxCalculator() { return new EUVatCalculator(); }
    public ReceiptFormatter createReceiptFormatter() { return new EUReceiptFormatter(); }
}

class TransactionService {
    private final RegionComponentFactory factory; // injected once per region context

    TransactionService(RegionComponentFactory factory) { this.factory = factory; }

    void process(BigDecimal amount) {
        FraudChecker fraud = factory.createFraudChecker();
        TaxCalculator tax = factory.createTaxCalculator();
        ReceiptFormatter receipt = factory.createReceiptFormatter();
        // guaranteed to be a matched, compliant set — impossible to mix regions
    }
}
```

### 3. UML-style diagram

```
<<interface>> RegionComponentFactory
 + createFraudChecker(): FraudChecker
 + createTaxCalculator(): TaxCalculator
 + createReceiptFormatter(): ReceiptFormatter
            ^
    ________|________
   |                 |
USComponentFactory  EUComponentFactory
   |                 |
   produces          produces
   v                 v
USFraudChecker     EUFraudChecker      }
USTaxCalculator    EUVatCalculator     }  matched families
USReceiptFormatter EUReceiptFormatter  }
```

### 4. Real-world usage

- **Java AWT/Swing `UIManager`/`LookAndFeel`** — each look-and-feel (Metal,
  Windows, GTK) is an abstract factory producing a consistent family of
  `Button`, `ScrollBar`, `Checkbox` widgets that visually match.
- **`javax.xml.parsers.DocumentBuilderFactory`** — abstracts which underlying
  XML parser implementation family gets instantiated.
- **Database driver abstraction layers** (e.g., a JDBC-like abstraction that
  produces a matched `Connection`, `Statement`, `ResultSet` family per
  vendor) — you don't want a Postgres `Connection` paired with an Oracle
  `Statement`.

### 5. Trade-offs / when not to use

- **Pro**: guarantees family consistency; swapping the entire family (e.g.
  entire region, entire UI theme) is a single object swap at composition
  root.
- **Con**: adding a *new product* to the family (e.g. every region now also
  needs a `CurrencyConverter`) means touching the interface and **every**
  concrete factory — this is the classic Abstract Factory rigidity. If your
  product list changes more often than your family list, this pattern fights
  you.
- **Con**: overkill if you only ever have one family, or if the objects in
  the "family" don't actually need to be consistent with each other (then
  you just want independent Factory Methods, not one Abstract Factory).

### 6. How it shows up in an LLD interview

Look for "families that must travel together": multi-region compliance,
multi-tenant theming, cross-platform UI kits, multi-cloud provider
abstractions (AWS S3 client + AWS KMS client + AWS IAM client, vs the GCP
equivalents — you never want to accidentally mix providers). Say explicitly:
"these three components must always match, so I'll bind them behind one
factory instead of three independent ones, to make an inconsistent
combination structurally impossible."

---

## Builder

### 1. The motivating problem

You need to construct a `HttpApiRequest` (or a `LoanApplication`, or an
`Order`) object with a lot of optional fields: URL (required), method
(required), headers (optional, many), query params (optional, many), body
(optional), timeout (optional), retry policy (optional). Two bad options
emerge naturally:

**Telescoping constructor:**
```java
class HttpApiRequest {
    HttpApiRequest(String url, String method, Map<String,String> headers,
                   Map<String,String> params, String body, int timeoutMs,
                   int retries, boolean followRedirects) { /* ... */ }
}
// caller has to pass nulls/defaults for everything they don't care about:
new HttpApiRequest("https://api.paypal.com/v2/pay", "POST", null, null,
                    body, 5000, 0, true);
```
Add one more optional field and every call site with positional args needs
review, and it's impossible to tell at the call site which `null` means what.

**Giant mutable setter object:**
```java
HttpApiRequest req = new HttpApiRequest();
req.setUrl("...");
req.setMethod("POST");
// object is in an invalid, half-built state between these lines —
// nothing stops you from calling req.send() before setUrl() is called
```
No invariant enforcement, and the object is mutable/thread-unsafe after
"construction."

### 2. The pattern applied

Separate the *step-by-step assembly* from the *final immutable object*, and
validate only once, at the end.

```java
final class HttpApiRequest {
    private final String url;
    private final String method;
    private final Map<String, String> headers;
    private final String body;
    private final int timeoutMs;

    private HttpApiRequest(Builder b) {
        this.url = b.url;
        this.method = b.method;
        this.headers = Map.copyOf(b.headers);
        this.body = b.body;
        this.timeoutMs = b.timeoutMs;
    }

    static class Builder {
        private final String url;      // required — passed to constructor
        private final String method;   // required
        private Map<String, String> headers = new HashMap<>();
        private String body = null;
        private int timeoutMs = 3000;  // sensible default

        Builder(String url, String method) { this.url = url; this.method = method; }

        Builder header(String k, String v) { headers.put(k, v); return this; }
        Builder body(String body) { this.body = body; return this; }
        Builder timeoutMs(int ms) { this.timeoutMs = ms; return this; }

        HttpApiRequest build() {
            if (url == null || url.isBlank()) throw new IllegalStateException("url required");
            return new HttpApiRequest(this); // validated once, then immutable
        }
    }
}

// usage — reads like the requirements, no null-juggling:
HttpApiRequest req = new HttpApiRequest.Builder("https://api.paypal.com/v2/pay", "POST")
        .header("Authorization", "Bearer xyz")
        .body(jsonPayload)
        .timeoutMs(5000)
        .build();
```

### 3. UML-style diagram

```
HttpApiRequest (immutable)              HttpApiRequest.Builder
------------------------                ----------------------
- url, method, headers, body            - url, method (required, ctor args)
- private constructor(Builder)          - headers, body, timeoutMs (optional, defaulted)
                                         + header(k,v): Builder
                                         + body(b): Builder
                                         + timeoutMs(ms): Builder
                                         + build(): HttpApiRequest  --creates-->
```

### 4. Real-world usage

- **`java.lang.StringBuilder`** — classic fluent builder, though for a
  simpler string-concat use case.
- **`okhttp3.Request.Builder`** — exactly the HTTP request example above,
  used verbatim in production Java HTTP clients.
- **Lombok's `@Builder`** — code-generates this exact pattern so you don't
  hand-write the boilerplate.
- **Protocol Buffers generated code** — every proto message gets a generated
  `Builder` class for this reason.

### 5. Trade-offs / when not to use

- **Pro**: readable construction of complex objects, enforces invariants at
  one `build()` checkpoint, immutable result is thread-safe by default.
- **Con**: for an object with 2–3 fields, all required, this is pure
  ceremony — just use a constructor. Don't reach for Builder because it
  "looks professional"; reach for it because the constructor is already
  telescoping or the object has real optional/defaulted fields.
- **Con**: a mutable, reusable builder shared across threads needs its own
  synchronization story — usually you build a fresh builder per object
  instead.

### 6. How it shows up in an LLD interview

Any "design an Order/Request/Config/Query object with many optional
parameters" prompt (design a SQL query builder, design an HTTP client,
design a notification message with optional channels/attachments). If the
interviewer piles on optional fields one at a time as the interview
progresses, that's a live cue to introduce Builder rather than keep adding
constructor overloads.

---

## Singleton

### 1. The motivating problem

You have a `ConfigurationManager` that reads application config from a file
once, or a `ConnectionPool` that must not be instantiated twice (two pools
would double your DB connection budget and defeat the pooling). Without
enforcement, nothing stops this:

```java
class ConfigurationManager {
    private Map<String, String> config;
    public ConfigurationManager() {
        config = loadFromDisk(); // expensive I/O, and now every `new` re-reads the file
    }
}
```
Every `new ConfigurationManager()` anywhere in the codebase re-reads config
from disk, and two instances could disagree if the file changes between
reads. The axis of change here isn't "which class" — it's "how many
instances may exist," and the answer must be enforced, not just documented.

### 2. The pattern applied — and why it's dangerous

```java
// Naive (broken under concurrency) — shown to make the pitfall explicit:
class ConfigurationManager {
    private static ConfigurationManager instance;
    private ConfigurationManager() { /* load config */ }

    public static ConfigurationManager getInstance() {
        if (instance == null) {              // <-- race: two threads can both
            instance = new ConfigurationManager(); //  pass this check before either assigns
        }
        return instance;
    }
}
```
Two threads calling `getInstance()` at the same time can both see
`instance == null` and both construct — you silently get two instances,
defeating the entire point, and it's a heisenbug that only shows up under
load.

**Correct, lazy, thread-safe (double-checked locking with `volatile`):**
```java
class ConfigurationManager {
    private static volatile ConfigurationManager instance; // volatile is NOT optional here —
                                                             // it prevents reordering that can
                                                             // publish a half-constructed object
    private final Map<String, String> config;

    private ConfigurationManager() { config = loadFromDisk(); }

    public static ConfigurationManager getInstance() {
        ConfigurationManager result = instance;
        if (result == null) {
            synchronized (ConfigurationManager.class) {
                result = instance;
                if (result == null) {
                    instance = result = new ConfigurationManager();
                }
            }
        }
        return result;
    }
}
```

**Simplest correct option in Java** — let the classloader do the
synchronization for you (initialization-on-demand holder idiom):
```java
class ConfigurationManager {
    private ConfigurationManager() { }
    private static class Holder {
        static final ConfigurationManager INSTANCE = new ConfigurationManager();
    }
    public static ConfigurationManager getInstance() {
        return Holder.INSTANCE; // JVM guarantees thread-safe, lazy init, no locks needed
    }
}
```
Or simpler still, an `enum` singleton (also serialization-safe against
reflection attacks, which the class-based forms are not without extra work):
```java
enum ConfigurationManager {
    INSTANCE;
    private final Map<String, String> config = loadFromDisk();
}
```

### 3. UML-style diagram

```
ConfigurationManager
---------------------
- static instance: ConfigurationManager   (or Holder.INSTANCE)
- ConfigurationManager()                  <- private constructor, no external `new`
+ static getInstance(): ConfigurationManager
                |
                | returns same reference every call
                v
        (single shared object, process-wide)
```

### 4. Real-world usage

- **`java.lang.Runtime.getRuntime()`** — one JVM runtime object per process.
- **`java.awt.Desktop.getDesktop()`** — similar single-instance-per-process
  access point.
- **Logging frameworks** (Log4j2 `LoggerContext`, per-name) — commonly
  singleton-per-key.
- Modern practice increasingly **avoids hand-rolled singletons** in favor of
  a DI container that scopes a bean as `singleton` — see below.

### 5. Trade-offs / when NOT to use — and the modern alternative

- **Con: global mutable state.** A singleton is a global variable with a
  fancy name. It makes unit testing hard (can't inject a fake/mock easily,
  state leaks between tests unless you reset it), and it hides a class's
  true dependencies — any method can silently reach out to
  `ConfigurationManager.getInstance()` instead of declaring the dependency
  in its constructor.
- **Con: hides true lifecycle.** "Exactly one, for the life of the process"
  is often not actually true — in tests you want a fresh one; in a
  multi-tenant service you might want one *per tenant*, not one globally.
  Hardcoding the constraint into the class makes that discovery painful
  later.
- **Why DI containers are the modern answer**: instead of the class
  enforcing its own single-instance-ness via a static field, you register it
  as a `singleton`-scoped bean in a container (Spring `@Component` default
  scope, Guice `@Singleton`). The container owns the lifecycle; the class
  itself stays a plain, testable class with a public constructor that takes
  its dependencies as arguments. You get "one instance in production" *and*
  "as many independent instances as you want in a test," because the
  constraint lives in configuration, not in the class's own code:

```java
@Component
@Scope("singleton") // default in Spring, shown explicitly here
class ConfigurationManager {
    private final ConfigSource source;
    ConfigurationManager(ConfigSource source) { this.source = source; } // testable, injectable
}
```

- **When it's still fine to hand-roll**: small scripts/CLIs, or genuinely
  process-global immutable facts (e.g., a read-only `enum`-based feature
  flag set) where you'll never want a second instance, ever, including in
  tests.

### 6. How it shows up in an LLD interview

"Design a connection pool / cache manager / ID generator / logger" — the
interviewer wants to see you (a) recognize *why* it must be single-instance
(shared, expensive, or must-be-consistent state), (b) know the
double-checked-locking pitfall and can explain `volatile`'s role instead of
just reciting the code, and (c) proactively mention that in a real system
you'd prefer DI-managed scope over a static `getInstance()`, because it's
more testable. Staff-level signal is knowing *when to avoid it*, not just
how to implement it.

---

## Prototype (concept level)

### 1. The motivating problem

You have a `DocumentTemplate` object (say, a receipt template, or a game
entity, or a complex `TransactionRiskProfile` graph) that is expensive to
build from scratch — it required a database load, several nested objects,
computed defaults — and you need many *slightly varied copies* of it at
runtime. Rebuilding from scratch every time repeats all that expensive setup
just to change one or two fields per copy:

```java
// Expensive: hits DB, recomputes defaults, builds nested objects — every single time
RiskProfile p1 = RiskProfileFactory.buildFromScratch("US");
p1.setUserId("u1");
RiskProfile p2 = RiskProfileFactory.buildFromScratch("US"); // redoes all the same expensive work
p2.setUserId("u2");
```
The axis of change is "I need N objects that are 95% identical to an
existing one," and construction cost is the pain.

### 2. The pattern applied (concept)

Instead of rebuilding, **clone** an existing, fully-configured instance and
tweak only what differs:

```java
interface Prototype<T> {
    T clone(); // deep-copy semantics must be defined deliberately, field by field
}

class RiskProfile implements Prototype<RiskProfile> {
    private String userId;
    private final List<RiskRule> rules; // must be deep-copied, not shared by reference

    public RiskProfile clone() {
        RiskProfile copy = new RiskProfile();
        copy.userId = this.userId;
        copy.rules = new ArrayList<>(this.rules); // deep copy — shallow copy would let both
        return copy;                              // instances mutate the same rule list
    }
}

RiskProfile template = RiskProfileFactory.buildFromScratch("US"); // paid once
RiskProfile p1 = template.clone(); p1.setUserId("u1"); // cheap
RiskProfile p2 = template.clone(); p2.setUserId("u2"); // cheap
```

### 3. UML-style diagram

```
<<interface>> Prototype<T>
 + clone(): T
        ^
        |
   RiskProfile
   -----------
   - userId, rules
   + clone(): RiskProfile   --returns a new, independent, deep copy--> RiskProfile
```

### 4. Real-world usage

- **`java.lang.Object.clone()` / `Cloneable`** — Java's built-in (if
  famously awkward — shallow by default, easy to get wrong) prototype
  mechanism.
- **JavaScript's prototype chain** — `Object.create(proto)` is prototype-based
  inheritance baked into the language itself.
- **Game engines** — "spawn 50 enemies of this pre-configured template" is a
  textbook Prototype use, avoiding re-running expensive setup per entity.

### 5. Trade-offs / when not to use

- **Con**: deep vs. shallow copy is a constant correctness trap — Java's
  default `Object.clone()` is shallow, silently sharing mutable nested
  state unless you override it carefully field-by-field.
- **Con**: if construction is cheap, this buys you nothing but complexity —
  just construct normally.
- Treated at **concept level** in most interviews: knowing *when* cloning
  beats rebuilding, and that deep-copy correctness is the hard part, is
  usually sufficient; full implementations are rare in LLD rounds.

### 6. How it shows up in an LLD interview

Rarely the star of a whole interview, but it's a good one-line callout when
a design has expensive "template" objects spawning many variants (game
entities, document templates, pre-validated config bundles). Mentioning it
briefly ("I'd prototype-clone this rather than rebuild it each time, being
careful about deep copy") signals awareness without over-investing in it.

---

# Structural Patterns
Last updated: 2026-08-27
_Overview and notes._
Last updated: 2026-08-27

Structural patterns exist because **the interfaces you're handed don't match
the interface you need**, or because you need to add capability/control
around an object **without changing its class**. The axis of change here is
usually external: a third-party API's shape, a need for optional add-on
behavior, or a need to control access transparently.

## Adapter

### 1. The motivating problem

Your checkout flow is built against your own `PaymentGateway` interface. You
now need to integrate a third-party processor, `LegacyBankSDK`, whose API you
don't control and can't modify — different method names, different
parameter shapes, different units (cents vs. dollars):

```java
// Third-party, un-modifiable
class LegacyBankSDK {
    public int submitPaymentInCents(String acctNumber, long amountCents) { /* returns status code */ }
}

// Your codebase expects this shape everywhere:
interface PaymentGateway {
    PaymentResult pay(String accountId, BigDecimal amountDollars);
}
```

Without an adapter, every call site that wants to use `LegacyBankSDK` has to
know its quirky API directly, scattering conversion logic (`dollars * 100`,
status-code-to-`PaymentResult` mapping) throughout the codebase, and your
`CheckoutService` can no longer depend on one clean `PaymentGateway`
abstraction — it has to special-case this one vendor everywhere it's used.

### 2. The pattern applied

Wrap the incompatible class behind your expected interface; translate once,
in one place.

```java
class LegacyBankAdapter implements PaymentGateway {
    private final LegacyBankSDK legacySdk;

    LegacyBankAdapter(LegacyBankSDK legacySdk) { this.legacySdk = legacySdk; }

    @Override
    public PaymentResult pay(String accountId, BigDecimal amountDollars) {
        long cents = amountDollars.movePointRight(2).longValueExact();
        int statusCode = legacySdk.submitPaymentInCents(accountId, cents);
        return statusCode == 0 ? PaymentResult.success() : PaymentResult.failure(statusCode);
    }
}

// CheckoutService still only ever knows PaymentGateway:
PaymentGateway gateway = new LegacyBankAdapter(new LegacyBankSDK());
checkoutService.pay(gateway, "acct-123", new BigDecimal("49.99"));
```

### 3. UML-style diagram

```
<<interface>> PaymentGateway          LegacyBankSDK (third-party, unmodifiable)
 + pay(accountId, amount)              + submitPaymentInCents(acct, cents): int
        ^                                        ^
        |                                        | wraps / delegates to
        |  implements                            |
   LegacyBankAdapter  ------------------------->--
   -----------------
   - legacySdk: LegacyBankSDK
   + pay(accountId, amount)   // translates units + return shape, calls legacySdk internally
```

### 4. Real-world usage

- **`java.util.Arrays.asList()`** — adapts an array to the `List` interface.
- **`java.io.InputStreamReader`** — adapts a byte-oriented `InputStream` to
  the character-oriented `Reader` interface.
- **Spring's various `*Adapter` classes** (e.g. `HandlerAdapter` in Spring
  MVC) — adapts different controller styles to one dispatch interface.
- Every **cloud SDK wrapper** you write in-house to normalize AWS/GCP/Azure
  APIs behind one internal interface is an Adapter.

### 5. Trade-offs / when not to use

- **Pro**: isolates third-party API churn to one class; the rest of the
  codebase never touches vendor-specific shapes.
- **Con**: if you control both interfaces (e.g., it's your own two internal
  services), just make them match — don't build an adapter to paper over an
  inconsistency you're free to fix at the source.
- **Con**: adapting a *very* different paradigm (e.g., sync SDK adapted to
  look async) can leak the underlying model's limitations (blocking calls
  hidden behind an async-looking interface) — the adapter can't manufacture
  capabilities the wrapped object doesn't have.

### 6. How it shows up in an LLD interview

Any prompt involving "integrate with a third-party [payment processor / SMS
provider / auth provider]" is a direct cue. Also appears when the
interviewer says "we're migrating from vendor A's SDK to vendor B's" —
Adapter (plus depending on the abstraction, not the vendor SDK, from day
one) is exactly the answer they want to hear.

---

## Decorator

### 1. The motivating problem

You have a `Notifier` that sends a message. Requirements grow: sometimes you
also want to log it, sometimes encrypt it, sometimes both, sometimes add a
retry wrapper, sometimes all four, in different combinations per caller.
Naive approach: subclass explosion.

```java
class Notifier { void send(String msg) { /* base send */ } }
class LoggingNotifier extends Notifier { /* override send: log then super.send() */ }
class EncryptingNotifier extends Notifier { /* override send: encrypt then super.send() */ }
class LoggingEncryptingNotifier extends Notifier { /* ... */ }
class RetryingLoggingEncryptingNotifier extends Notifier { /* ... */ }
// every new combination of behaviors doubles your class count
```

With 4 optional behaviors you'd need up to 2⁴ subclasses to cover every
combination via inheritance. The axis of change is "which combination of
add-on behaviors wraps the base behavior," decided at runtime/construction
time per call site — inheritance can't express "pick any subset" without
combinatorial blowup.

### 2. The pattern applied

Wrap the base object in layers, each layer adding one behavior and
delegating to the wrapped object — same interface at every layer, so layers
compose freely.

```java
interface Notifier { void send(String msg); }

class BasicNotifier implements Notifier {
    public void send(String msg) { System.out.println("Sending: " + msg); }
}

abstract class NotifierDecorator implements Notifier {
    protected final Notifier wrapped;
    NotifierDecorator(Notifier wrapped) { this.wrapped = wrapped; }
}

class LoggingDecorator extends NotifierDecorator {
    LoggingDecorator(Notifier wrapped) { super(wrapped); }
    public void send(String msg) {
        System.out.println("LOG: about to send");
        wrapped.send(msg);
    }
}

class EncryptingDecorator extends NotifierDecorator {
    EncryptingDecorator(Notifier wrapped) { super(wrapped); }
    public void send(String msg) { wrapped.send(encrypt(msg)); }
    private String encrypt(String msg) { return "***" + msg + "***"; }
}

// compose exactly what's needed, per call site, at runtime:
Notifier notifier = new LoggingDecorator(new EncryptingDecorator(new BasicNotifier()));
notifier.send("Payment confirmed"); // logs, then encrypts, then sends — any combination, any order
```

### 3. UML-style diagram

```
<<interface>> Notifier
 + send(msg)
     ^        ^
     |        |
BasicNotifier  NotifierDecorator (abstract)
+send(msg)        - wrapped: Notifier
                   ^
           ________|_________
          |                  |
  LoggingDecorator     EncryptingDecorator
  +send(msg)            +send(msg)
  (logs, then           (encrypts, then
   calls wrapped.send)   calls wrapped.send)
```

### 4. Real-world usage

- **`java.io` stream classes** — the canonical textbook example:
  `new BufferedReader(new InputStreamReader(new FileInputStream(file)))`
  layers buffering and character decoding around a raw byte stream.
- **Java `Collections.synchronizedList(list)` / `unmodifiableList(list)`** —
  wrap a `List` to add thread-safety or immutability without changing its
  class.
- **Servlet filters / Express.js middleware / Spring `HandlerInterceptor`
  chains** — each middleware layer wraps the request-handling behavior with
  one more concern (auth, logging, compression).

### 5. Trade-offs / when not to use

- **Pro**: behaviors compose at runtime, in any combination, without a
  combinatorial class explosion; each decorator is small and
  single-responsibility.
- **Con**: debugging a deep decorator stack means stepping through many
  thin layers — stack traces get noisy, and it can be hard to see "what is
  this object, really" at a glance.
- **Con**: if you only ever need *one* fixed combination of behaviors (never
  vary at runtime), just write one class that does all of it — decorators
  for a combination that never varies is needless indirection.

### 6. How it shows up in an LLD interview

"Design a coffee ordering system" (the textbook example, often literally
asked), "design a text/notification pipeline with optional
encryption/compression/logging," "design middleware for a web framework."
The tell is optional, stackable, runtime-selectable behaviors around one
core operation — say explicitly you're avoiding a subclass explosion.

---

## Facade

### 1. The motivating problem

Placing an order requires coordinating `InventoryService`,
`PaymentService`, `ShippingService`, `NotificationService`, and
`FraudCheckService` — each with its own multi-step API. Every caller
(web controller, mobile API, batch reorder job) that wants to place an order
has to know and correctly sequence all five:

```java
// Repeated, error-prone, in every place that needs to place an order:
if (fraudCheckService.isFraudulent(order)) throw new FraudException();
inventoryService.reserve(order.getItems());
PaymentResult result = paymentService.charge(order.getPaymentInfo());
if (!result.isSuccess()) { inventoryService.release(order.getItems()); throw new PaymentException(); }
shippingService.scheduleShipment(order);
notificationService.sendOrderConfirmation(order);
```
Every caller must know the correct order of operations and every failure/
compensation path. Duplicate this in three call sites and a bug fix (say,
"we forgot to release inventory on payment failure") needs to be applied in
three places.

### 2. The pattern applied

Provide one simplified entry point that encapsulates the orchestration; the
subsystems still exist and can still be used directly by code that needs
fine-grained control, but most callers don't need to.

```java
class OrderFacade {
    private final InventoryService inventory;
    private final PaymentService payment;
    private final ShippingService shipping;
    private final NotificationService notification;
    private final FraudCheckService fraudCheck;
    // constructor wires all five (omitted for brevity)

    public OrderResult placeOrder(Order order) {
        if (fraudCheck.isFraudulent(order)) return OrderResult.rejected("fraud");
        inventory.reserve(order.getItems());
        PaymentResult result = payment.charge(order.getPaymentInfo());
        if (!result.isSuccess()) {
            inventory.release(order.getItems());
            return OrderResult.failed("payment");
        }
        shipping.scheduleShipment(order);
        notification.sendOrderConfirmation(order);
        return OrderResult.success();
    }
}

// every caller now does exactly one thing:
OrderResult result = orderFacade.placeOrder(order);
```

### 3. UML-style diagram

```
                     OrderFacade
                     -----------
                     + placeOrder(order): OrderResult
                            |
     ____________________________________________________
    |          |            |             |               |
FraudCheck  Inventory    Payment       Shipping       Notification
 Service     Service     Service        Service          Service
(each subsystem keeps its own full API — Facade just sequences them)
```

### 4. Real-world usage

- **`javax.faces.context.FacesContext`** in JSF — one object fronting many
  underlying subsystems.
- **jQuery's `$(...)`** — a facade over the notoriously inconsistent raw DOM
  API of the era, hiding cross-browser quirks behind one simple call
  surface.
- Any **SDK "client" class** (e.g. `S3Client`, `StripeClient`) — a facade in
  front of dozens of underlying HTTP endpoints and request-signing logic.

### 5. Trade-offs / when not to use

- **Pro**: reduces coupling between calling code and subsystem internals;
  one place to fix cross-cutting orchestration bugs; easier onboarding
  (new engineers call `placeOrder()`, not five services in the right
  order).
- **Con**: if made the *only* way to access the subsystems, it can become a
  bottleneck / God object as more use cases need slightly different
  orchestration — keep the underlying services accessible for callers who
  genuinely need custom sequencing.
- **Con**: a facade over things that don't actually need coordinating is
  just an unnecessary layer — don't build one to wrap a single service call.

### 6. How it shows up in an LLD interview

Anything with a multi-step checkout/booking/provisioning flow spanning
several subsystems ("design an e-commerce checkout," "design a hotel
booking system," "design a ride-booking flow" — dispatch + pricing +
payment + notification). Mention Facade when you're asked to show "the
single entry point a client would call," and be ready to say the subsystems
underneath remain independently usable/testable.

---

## Composite

### 1. The motivating problem

You're modeling a file system, or an org chart, or a UI layout, or (a
frequent interview favorite) a **discount/pricing rule engine** where a
rule can be a single condition *or* a group of sub-rules (AND/OR nested
arbitrarily deep). Client code that wants to evaluate "the total price"
or "does this apply" has to know whether it's holding a leaf or a
container, and branches accordingly, at every level:

```java
class PricingRule {
    boolean isGroup;
    List<PricingRule> children; // used only if isGroup
    double discount;            // used only if leaf

    double evaluate(Order order) {
        if (isGroup) {
            double total = 0;
            for (PricingRule child : children) total += child.evaluate(order); // recursion
            return total;
        } else {
            return matches(order) ? discount : 0;
        }
    }
}
```
The `isGroup` flag and the if/else at every call site is the smell — every
new operation on `PricingRule` needs the same branch duplicated, and it's
easy to forget a check.

### 2. The pattern applied

Give leaf and container the **same interface**; the container simply
delegates to its children polymorphically, with no type-checking required
anywhere.

```java
interface PricingComponent {
    double evaluate(Order order);
}

class LeafDiscountRule implements PricingComponent {
    private final double discount;
    private final Predicate<Order> condition;
    LeafDiscountRule(double discount, Predicate<Order> condition) {
        this.discount = discount; this.condition = condition;
    }
    public double evaluate(Order order) { return condition.test(order) ? discount : 0; }
}

class CompositeDiscountRule implements PricingComponent {
    private final List<PricingComponent> children = new ArrayList<>();
    void add(PricingComponent child) { children.add(child); }

    public double evaluate(Order order) {
        double total = 0;
        for (PricingComponent child : children) total += child.evaluate(order); // no type check —
        return total;                                                            // leaf or composite,
    }                                                                            // identical call
}

// build an arbitrarily nested tree; client code just calls evaluate() at the root:
CompositeDiscountRule holidayBundle = new CompositeDiscountRule();
holidayBundle.add(new LeafDiscountRule(5.0, order -> order.getTotal() > 100));
holidayBundle.add(new LeafDiscountRule(2.0, order -> order.hasCoupon("HOLIDAY")));
double totalDiscount = holidayBundle.evaluate(order);
```

### 3. UML-style diagram

```
<<interface>> PricingComponent
 + evaluate(order): double
        ^
   _____|______________________
  |                            |
LeafDiscountRule       CompositeDiscountRule
+evaluate(order)       - children: List<PricingComponent>
(computes directly)    + add(child)
                       + evaluate(order)  --loops over children, calls their evaluate()--
                                (a child here can itself be another Composite: tree structure)
```

### 4. Real-world usage

- **`java.awt.Container`/`Component`** in Swing/AWT — a `Container` (panel,
  window) holds `Component`s, some of which are themselves `Container`s;
  `paint()` is called uniformly down the whole tree.
- **DOM tree** — every node (element or text) implements the same `Node`
  interface; a `<div>` containing other elements is handled with the same
  API as a leaf text node.
- **File system abstractions** — `File` and `Directory` both implementing a
  common interface so `getSize()` recurses transparently.

### 5. Trade-offs / when not to use

- **Pro**: uniform treatment of individual objects and groups eliminates
  type-checking branches; recursive structures (trees) become natural to
  traverse and operate on.
- **Con**: can make it hard to restrict which operations are valid only on
  leaves or only on composites (e.g., "add child" doesn't make sense on a
  leaf) — you either throw at runtime for the invalid case or split the
  interface, both of which add friction.
- **Con**: unnecessary if your data is genuinely always flat (no
  part-whole/tree recursion) — don't force a tree shape onto a flat list.

### 6. How it shows up in an LLD interview

Rule engines, file system design, org hierarchies, UI component trees,
"nested categories" in an e-commerce catalog, menu structures. The tell is
recursive part-whole structure where operations need to work the same way
regardless of nesting depth.

---

## Proxy

### 1. The motivating problem

You have an `ImageLoader` that loads a high-resolution image from disk/
network — expensive. It's referenced in a document that might display
hundreds of images, but most are scrolled past and never actually viewed.
Loading eagerly wastes memory and bandwidth:

```java
class HighResImage {
    HighResImage(String path) { loadFromDisk(path); /* expensive, happens immediately */ }
    void display() { /* render */ }
}
// creating 200 of these on page load = 200 expensive loads, even for images never scrolled to
```
Separately: you also want to add **access control** (only premium users can
view watermark-free images) and **logging** (audit every access) — all
*without* changing `HighResImage` or the calling code that just wants to
call `display()`.

### 2. The pattern applied

Insert a stand-in object with the *same interface* that controls access to
the real object — lazily creating it, checking permissions, or logging,
before/instead of delegating.

```java
interface Image { void display(); }

class HighResImage implements Image {
    private final String path;
    HighResImage(String path) { this.path = path; loadFromDisk(path); } // expensive
    public void display() { System.out.println("Displaying " + path); }
}

class LazyImageProxy implements Image {
    private final String path;
    private HighResImage real; // not created until actually needed

    LazyImageProxy(String path) { this.path = path; }

    public void display() {
        if (real == null) {
            real = new HighResImage(path); // paid only on first actual display
        }
        real.display();
    }
}

// caller code is identical whether it holds a real image or a proxy:
List<Image> gallery = paths.stream().map(LazyImageProxy::new).collect(toList());
gallery.get(0).display(); // only this one actually loads
```

### 3. UML-style diagram

```
<<interface>> Image
 + display()
     ^          ^
     |          |
HighResImage   LazyImageProxy
+display()      - real: HighResImage (lazily created)
(expensive to   + display()  --creates+delegates to real HighResImage on first use--
 construct)
```

### 4. Real-world usage

- **Java Dynamic Proxy (`java.lang.reflect.Proxy`)** and **Spring AOP
  proxies** — every `@Transactional`, `@Cacheable`, or `@Async` Spring bean
  is wrapped in a runtime-generated proxy that adds behavior around the real
  method call, transparently.
- **Hibernate/JPA lazy-loaded entities** — accessing `order.getItems()`
  returns a proxy that only hits the database when a method on it is
  actually invoked.
- **RMI / gRPC stub objects** — a local proxy object with the same interface
  as the remote service, marshaling calls over the network invisibly to the
  caller.

### 5. Trade-offs / when not to use

- **Pro**: adds lazy-loading, access control, caching, or remote-call
  transparency without touching the real subject's code or the client's
  code — genuinely invisible to both ends.
- **Con**: another layer of indirection to reason about; if overused (proxy
  wrapping proxy wrapping proxy) it becomes as hard to trace as an
  over-decorated object.
- **Con**: conceptually close to Decorator — the distinction is intent:
  Decorator *adds* behavior/responsibility, Proxy *controls access* to the
  same behavior. If you're not controlling access (permissions, lifecycle,
  location), you probably want Decorator instead.

### 6. How it shows up in an LLD interview

"Design a caching layer in front of a slow service," "design lazy-loading
for a large object graph," "design an access-controlled resource" (e.g.
document permissions). Also a good answer when asked "how would you add
cross-cutting concerns like logging/auth without modifying the target
class" — name Proxy and distinguish it from Decorator by intent (access
control vs. added responsibility) if asked to compare.

---

# Behavioral Patterns
Last updated: 2026-08-27
_Overview and notes._
Last updated: 2026-08-27

Behavioral patterns exist because **how objects communicate, or how an
object's *behavior* varies over time or by algorithm**, is the thing under
pressure to change. This is the largest category because "behavior that
varies" is the most common axis of change in real systems.

## Strategy

### 1. The motivating problem

You compute shipping cost, and it depends on carrier: `FEDEX`, `UPS`,
`GROUND`. It started as one method, and every new carrier (or every new
promotional pricing rule) adds another branch — and worse, if this
conditional is duplicated in `checkout()`, `refund()`, and `getEstimate()`,
you have to update it in three places:

```java
class ShippingCalculator {
    double calculate(String carrier, Order order) {
        if (carrier.equals("FEDEX")) {
            return order.getWeight() * 1.5 + 5.0;
        } else if (carrier.equals("UPS")) {
            return order.getWeight() * 1.3 + 6.0;
        } else if (carrier.equals("GROUND")) {
            return order.getWeight() * 0.8;
        }
        throw new IllegalArgumentException();
    }
}
```
The axis of change: *the algorithm itself* varies by carrier, and needs to
be selectable — and swappable — at runtime, per order.

### 2. The pattern applied

Extract each algorithm into its own class behind a common interface; the
context holds a reference to whichever strategy is currently selected and
delegates to it.

```java
interface ShippingStrategy {
    double calculate(Order order);
}

class FedExStrategy implements ShippingStrategy {
    public double calculate(Order order) { return order.getWeight() * 1.5 + 5.0; }
}
class UpsStrategy implements ShippingStrategy {
    public double calculate(Order order) { return order.getWeight() * 1.3 + 6.0; }
}
class GroundStrategy implements ShippingStrategy {
    public double calculate(Order order) { return order.getWeight() * 0.8; }
}

class ShippingCalculator {
    private ShippingStrategy strategy; // swappable at runtime
    ShippingCalculator(ShippingStrategy strategy) { this.strategy = strategy; }
    void setStrategy(ShippingStrategy strategy) { this.strategy = strategy; }

    double calculate(Order order) { return strategy.calculate(order); } // no branching at all
}

// new carrier added → new class, zero edits to ShippingCalculator:
ShippingCalculator calc = new ShippingCalculator(new FedExStrategy());
calc.setStrategy(new UpsStrategy()); // swap algorithm at runtime
```

### 3. UML-style diagram

```
ShippingCalculator                <<interface>> ShippingStrategy
-------------------                -----------------------------
- strategy: ShippingStrategy  ---->  + calculate(order): double
+ setStrategy(s)                              ^
+ calculate(order)                            |
                              ______________________________
                             |            |                 |
                       FedExStrategy  UpsStrategy      GroundStrategy
                       +calculate()   +calculate()     +calculate()
```

### 4. Real-world usage

- **`java.util.Comparator`** passed to `Collections.sort(list, comparator)`
  — the sort *algorithm's ordering rule* is a swappable strategy.
- **`java.util.concurrent.RejectedExecutionHandler`** in
  `ThreadPoolExecutor` — pluggable strategy for what happens when a task is
  rejected (abort, discard, caller-runs, etc.).
- **Spring Security's `AuthenticationProvider`** — different auth strategies
  (LDAP, DB, OAuth) plugged behind one interface.

### 5. Trade-offs / when not to use

- **Pro**: eliminates conditional branching for algorithm selection;
  strategies are independently testable and addable without touching the
  context class.
- **Con**: if there are only ever going to be one or two algorithms and they
  never change, a simple `if/else` is more readable than the ceremony of an
  interface plus N classes.
- **Con**: client code must know which concrete strategy to construct/pass
  in — often paired with Factory Method to hide that choice too.

### 6. How it shows up in an LLD interview

Extremely common: "design a payment routing system," "design a pricing
engine with multiple pricing models," "design a sorting/matching service
with pluggable algorithms," "design a ride-matching algorithm you can swap
between nearest-driver vs. surge-aware." Any time the interviewer says "and
what if we want to support a different algorithm for X later," that's
Strategy, verbatim.

---

## Observer

### 1. The motivating problem

When an `Order` changes status (placed → paid → shipped → delivered),
multiple unrelated things need to happen: send an email, update inventory
analytics, notify the delivery-tracking service, update a fraud model.
Cramming all of it into `Order.setStatus()` couples the order entity to
every downstream concern, and adding a new concern (say, SMS notifications)
means editing the core `Order` class again:

```java
class Order {
    void setStatus(Status status) {
        this.status = status;
        emailService.sendStatusEmail(this);       // Order now depends on
        analyticsService.recordStatusChange(this); // EVERY consumer of its
        deliveryTracker.updateTracking(this);      // status changes — tight
        // add SMS? edit this class again.          coupling, one-directional
    }                                               // knowledge that shouldn't exist here
}
```

### 2. The pattern applied

`Order` (the subject) exposes a subscribe/notify mechanism; interested
parties (observers) register themselves and get called back — `Order` never
needs to know who's listening or how many.

```java
interface OrderObserver {
    void onStatusChanged(Order order, Status newStatus);
}

class Order {
    private final List<OrderObserver> observers = new ArrayList<>();
    private Status status;

    void addObserver(OrderObserver observer) { observers.add(observer); }

    void setStatus(Status status) {
        this.status = status;
        for (OrderObserver observer : observers) {
            observer.onStatusChanged(this, status); // Order has zero knowledge of what these do
        }
    }
}

class EmailNotifier implements OrderObserver {
    public void onStatusChanged(Order order, Status status) { /* send email */ }
}
class AnalyticsRecorder implements OrderObserver {
    public void onStatusChanged(Order order, Status status) { /* record metric */ }
}

// wiring happens outside Order, at composition time:
order.addObserver(new EmailNotifier());
order.addObserver(new AnalyticsRecorder());
order.addObserver(new SmsNotifier()); // new concern added with zero edits to Order
```

### 3. UML-style diagram

```
Order (Subject)                    <<interface>> OrderObserver
----------------                    -----------------------------
- observers: List<OrderObserver>     + onStatusChanged(order, status)
+ addObserver(o)                              ^
+ setStatus(s)  --notifies all-->             |
                              ______________________________
                             |               |               |
                      EmailNotifier   AnalyticsRecorder   SmsNotifier
                      +onStatusChanged +onStatusChanged   +onStatusChanged
```

### 4. Real-world usage

- **Java's `PropertyChangeListener`** (`java.beans`) — classic JDK-level
  Observer for bean property changes.
- **DOM `addEventListener`** — every click/keypress handler registration in
  every web page ever written.
- **Message queues / pub-sub systems** (Kafka consumers, RabbitMQ, Spring's
  `ApplicationEventPublisher`) — Observer at a distributed-systems scale,
  same core idea: subject publishes, observers subscribe and don't know
  about each other.
- **RxJava / Reactive Streams `Observable`/`Subscriber`** — the pattern's
  name, literally, generalized into a whole reactive programming model.

### 5. Trade-offs / when not to use

- **Pro**: decouples the subject entirely from what happens on change;
  observers can be added/removed at runtime without touching the subject.
- **Con**: notification order is often unspecified/unreliable unless you
  design for it — don't rely on "observer A always runs before observer B"
  unless the API guarantees it.
- **Con**: silent failures — if an observer throws, does it break the
  subject's own state update, or should it be isolated? This must be
  designed deliberately (e.g., catch-and-log per observer), or one bad
  observer takes down the whole notification chain.
- **Con**: memory leaks from forgotten `removeObserver` calls (classic
  Swing/AWT listener leak) — long-lived subjects holding references to
  observers that should have been garbage collected.
- **Con**: for a single, fixed, always-present listener, just call the
  method directly — Observer is for *multiple, decoupled, possibly dynamic*
  listeners.

### 6. How it shows up in an LLD interview

"Design a stock ticker / price alert system," "design a notification
system," "design a pub-sub system," "design an event-driven order
pipeline." Extremely frequent — the tell is "when X happens, multiple
independent things need to react," especially when the list of "things
that react" is expected to grow.

---

## State

### 1. The motivating problem

An `Order` moves through states: `PLACED → PAID → SHIPPED → DELIVERED`, or
`PLACED → CANCELLED`. Valid transitions and valid operations depend on the
*current* state, and this is usually implemented as a field plus a wall of
conditionals repeated in every method:

```java
class Order {
    String status = "PLACED";

    void pay() {
        if (status.equals("PLACED")) { status = "PAID"; }
        else throw new IllegalStateException("Cannot pay from " + status);
    }
    void ship() {
        if (status.equals("PAID")) { status = "SHIPPED"; }
        else throw new IllegalStateException("Cannot ship from " + status);
    }
    void cancel() {
        if (status.equals("PLACED") || status.equals("PAID")) { status = "CANCELLED"; }
        else throw new IllegalStateException("Cannot cancel from " + status);
    }
    // every method repeats "if current state allows this transition" —
    // and this logic is duplicated and drifts as states/transitions grow
}
```

### 2. The pattern applied

Represent each state as an object implementing a common interface; the
`Order` delegates behavior to its *current state object*, and transitions
are just swapping which state object is "current."

```java
interface OrderState {
    OrderState pay(Order order);
    OrderState ship(Order order);
    OrderState cancel(Order order);
}

class PlacedState implements OrderState {
    public OrderState pay(Order order) { return new PaidState(); }
    public OrderState ship(Order order) { throw new IllegalStateException("Must pay first"); }
    public OrderState cancel(Order order) { return new CancelledState(); }
}

class PaidState implements OrderState {
    public OrderState pay(Order order) { throw new IllegalStateException("Already paid"); }
    public OrderState ship(Order order) { return new ShippedState(); }
    public OrderState cancel(Order order) { return new CancelledState(); }
}

class ShippedState implements OrderState {
    public OrderState pay(Order order) { throw new IllegalStateException("Already shipped"); }
    public OrderState ship(Order order) { throw new IllegalStateException("Already shipped"); }
    public OrderState cancel(Order order) { throw new IllegalStateException("Cannot cancel, shipped"); }
}

class Order {
    private OrderState state = new PlacedState();
    void pay() { state = state.pay(this); }     // Order itself has NO if/else at all
    void ship() { state = state.ship(this); }   // each state object knows its own
    void cancel() { state = state.cancel(this); } // valid transitions
}
```

### 3. UML-style diagram

```
Order                          <<interface>> OrderState
------                          -------------------------
- state: OrderState              + pay(order): OrderState
+ pay()/ship()/cancel()          + ship(order): OrderState
  --delegates to state-->        + cancel(order): OrderState
                                          ^
                     _____________________|______________________
                    |               |                |            |
              PlacedState      PaidState       ShippedState  CancelledState
              (allows pay,     (allows ship,    (terminal-    (terminal)
               cancel)          cancel)          ish)
      each transition returns the NEXT state object — Order swaps its reference to it
```

### 4. Real-world usage

- **`java.util.concurrent.Future`** — internally tracks state
  (NEW/COMPLETING/NORMAL/CANCELLED/...) with state-dependent behavior for
  `get()`, `cancel()`, `isDone()`.
- **TCP connection state machines** — `LISTEN`, `SYN_SENT`,
  `ESTABLISHED`, `CLOSE_WAIT`, etc. — real network stacks implement exactly
  this pattern (each state defines which transitions/packets are valid).
  Widely used in interview answers for "design a TCP-like protocol" or
  "design an elevator/traffic light" (light literal state machines).
- **Workflow/BPM engines**, and any **order/ticket/approval status
  pipeline** in enterprise systems (very common at PayPal/Oracle-style
  companies — dispute lifecycle, KYC verification lifecycle, etc.).

### 5. Trade-offs / when not to use

- **Pro**: eliminates scattered conditionals on a status field; adding a new
  state or transition touches one new/existing state class instead of every
  method on the context; invalid transitions become a compile-time-visible
  concern (missing method implementation) rather than a missed `if` branch.
- **Con**: for 2-3 states with simple, rarely-changing rules, a status enum
  plus a small validation map is simpler than a class per state — don't
  reach for State for a boolean-ish toggle.
- **Con**: state objects are often stateless themselves (can be singletons/
  enum instances) — watch for accidentally making them stateful and shared,
  which reintroduces race conditions across concurrent `Order` instances.

### 6. How it shows up in an LLD interview

Extremely common: "design a vending machine," "design an elevator system,"
"design a traffic light controller," "design an order/ticket lifecycle,"
"design a media player (play/pause/stop)." The tell is explicit,
enumerable states with transition rules that differ per state — if you find
yourself drawing a state diagram before writing code, that's your cue.

---

## Command

### 1. The motivating problem

You're building a text editor, or a job scheduling system, or a smart-home
remote control. You need to: queue actions, log them, support undo/redo,
or let the invoker (a UI button, a scheduler, a macro) trigger an action
*without knowing what that action actually does*. Naive approach couples
the invoker directly to the receiver's method:

```java
class RemoteControlButton {
    Light light;
    void press() {
        light.turnOn(); // hardcoded — this button can ONLY ever turn on a light.
    }                   // Want undo? Want this button to instead lock a door tomorrow?
}                       // Rewrite the button class.
```
No way to queue the action for later, log what was done, or undo it — the
"what to do" and "when to trigger it" are welded together.

### 2. The pattern applied

Encapsulate a request as an object with a uniform `execute()` (and
optionally `undo()`) — the invoker holds a `Command` reference and knows
nothing about what it actually does.

```java
interface Command {
    void execute();
    void undo();
}

class Light {
    void turnOn() { System.out.println("Light ON"); }
    void turnOff() { System.out.println("Light OFF"); }
}

class TurnOnLightCommand implements Command {
    private final Light light;
    TurnOnLightCommand(Light light) { this.light = light; }
    public void execute() { light.turnOn(); }
    public void undo() { light.turnOff(); }
}

class RemoteControlButton {
    private Command command; // decoupled — any Command works
    void setCommand(Command command) { this.command = command; }
    void press() { command.execute(); }
}

// undo/redo stack becomes trivial because every action is a uniform object:
Deque<Command> history = new ArrayDeque<>();
Command cmd = new TurnOnLightCommand(new Light());
cmd.execute();
history.push(cmd);
history.pop().undo(); // undo the last action, generically, with no knowledge of what it was
```

### 3. UML-style diagram

```
RemoteControlButton         <<interface>> Command             Light
--------------------         --------------------             -----
- command: Command   ----->   + execute()                     + turnOn()
+ setCommand(c)                + undo()                        + turnOff()
+ press()  --calls              ^
   command.execute()--          |
                          TurnOnLightCommand
                          - light: Light
                          + execute()  --calls light.turnOn()
                          + undo()     --calls light.turnOff()
```

### 4. Real-world usage

- **`java.lang.Runnable`** — the simplest possible Command: an `execute()`
  (called `run()`) with no arguments, submitted to a `Thread` or
  `ExecutorService` that has no idea what work it actually does.
- **`javax.swing.Action`** — Swing's menu items/buttons hold an `Action`
  object (a Command) so the same action can be bound to a menu, a toolbar
  button, and a keyboard shortcut simultaneously.
- **Database transaction logs / event sourcing** — each mutation recorded
  as a discrete, replayable command object is this pattern at the
  persistence layer.
- **Job queues** (Sidekiq, Celery, Spring's `@Async` task submission) — a
  queued job is a serialized Command executed later, possibly on a
  different worker.

### 5. Trade-offs / when not to use

- **Pro**: decouples invoker from receiver; trivially enables undo/redo,
  queuing, logging, and macro-recording (a list of Commands) because every
  action has the same shape.
- **Con**: for a single, fixed, immediate action with no need for
  undo/queuing/logging, this is unnecessary indirection — call the method
  directly.
- **Con**: implementing `undo()` correctly can be genuinely hard for
  commands with side effects that aren't cleanly reversible (e.g., "send an
  email" has no real undo) — don't force an `undo()` method that can't be
  honestly implemented; document it as a no-op or unsupported instead of
  faking it.

### 6. How it shows up in an LLD interview

"Design a text editor with undo/redo," "design a task scheduler / job
queue," "design a smart home remote," "design a macro recorder." The tell
is explicitly "undo," "redo," "queue for later," or "log every action
taken" in the requirements — Command is close to the only reasonable
answer.

---

## Chain of Responsibility

### 1. The motivating problem

An incoming payment request must pass through several independent checks:
authentication, fraud scoring, balance/limit check, compliance/sanctions
screening. Naively, one method runs all of them in sequence with early
returns, and adding/reordering/disabling a check means editing this one
method every time — and different payment types might need different
subsets of checks, multiplying the branches:

```java
class PaymentValidator {
    ValidationResult validate(PaymentRequest req) {
        if (!authCheck(req))      return ValidationResult.fail("auth");
        if (!fraudCheck(req))     return ValidationResult.fail("fraud");
        if (!limitCheck(req))     return ValidationResult.fail("limit");
        if (!complianceCheck(req)) return ValidationResult.fail("compliance");
        return ValidationResult.ok();
        // want to add a new check? reorder checks per payment type? disable
        // one check for internal test transactions? edit this method every time.
    }
}
```

### 2. The pattern applied

Each check becomes its own handler with a reference to the *next* handler;
each one decides independently whether to handle, pass along, or short
circuit. The chain's composition (order, which checks are included) is
assembled once, outside any individual handler.

```java
abstract class ValidationHandler {
    protected ValidationHandler next;
    ValidationHandler setNext(ValidationHandler next) { this.next = next; return next; }

    ValidationResult handle(PaymentRequest req) {
        ValidationResult result = check(req);
        if (!result.isOk()) return result;             // short-circuit on failure
        return next != null ? next.handle(req) : ValidationResult.ok(); // else pass along
    }
    protected abstract ValidationResult check(PaymentRequest req);
}

class AuthHandler extends ValidationHandler {
    protected ValidationResult check(PaymentRequest req) { return authCheck(req) ? ValidationResult.ok() : ValidationResult.fail("auth"); }
}
class FraudHandler extends ValidationHandler {
    protected ValidationResult check(PaymentRequest req) { return fraudCheck(req) ? ValidationResult.ok() : ValidationResult.fail("fraud"); }
}
class LimitHandler extends ValidationHandler {
    protected ValidationResult check(PaymentRequest req) { return limitCheck(req) ? ValidationResult.ok() : ValidationResult.fail("limit"); }
}

// composed once, order and membership fully configurable, e.g. per payment type:
ValidationHandler chain = new AuthHandler();
chain.setNext(new FraudHandler()).setNext(new LimitHandler());
ValidationResult result = chain.handle(paymentRequest); // PaymentValidator no longer exists as a fat method
```

### 3. UML-style diagram

```
ValidationHandler (abstract)
-----------------------------
- next: ValidationHandler
+ handle(req): ValidationResult  --calls check(req), then next.handle(req) if ok--
# check(req): ValidationResult   (abstract)
        ^
   _____|__________________________
  |              |                 |
AuthHandler   FraudHandler    LimitHandler
+check(req)   +check(req)     +check(req)

  AuthHandler -> FraudHandler -> LimitHandler -> (end of chain, ok)
   (each link decides: fail here, or pass to next)
```

### 4. Real-world usage

- **Servlet Filters (`javax.servlet.Filter`) / OkHttp `Interceptor`s /
  Express.js middleware `next()`** — the single most common production
  usage: each filter/interceptor decides to handle, modify-and-pass, or
  short-circuit the request.
- **`java.util.logging.Logger`** — log handlers are chained; a log record
  can propagate up through parent loggers' handlers.
- **Exception handling bubbling** — conceptually similar: an exception
  propagates up a call chain until something handles it, similar in spirit
  though not a literal implementation of this pattern.

### 5. Trade-offs / when not to use

- **Pro**: each check/handler is independent, testable in isolation, and
  the *chain's composition* (order, inclusion) is decoupled from the
  handlers themselves — reordering or A/B-testing a different pipeline is a
  one-line change at the composition site.
- **Con**: if no handler ends up handling a request, you can get silent
  "nothing happened" behavior unless you explicitly design a default/
  terminal handler — an easy bug to introduce.
- **Con**: debugging requires walking the chain to find where something was
  handled/dropped — chain depth trades off against traceability, similar to
  Decorator's stack-depth cost.
- **Con**: unnecessary if the sequence of checks is fixed, small, and never
  reordered/extended — a plain sequence of `if` statements is fine and more
  readable at that size.

### 6. How it shows up in an LLD interview

"Design a request validation/middleware pipeline," "design an approval
workflow" (manager → director → VP, escalating until someone approves),
"design a logging framework," "design a fraud detection pipeline with
multiple independent checks." The tell is a *sequence of independent,
reorderable/optional handlers* each capable of short-circuiting.

---

## Template Method

### 1. The motivating problem

You generate different report formats — CSV export, PDF export, JSON export
— but the *overall algorithm* is identical for all three: fetch data,
transform it, write header, write rows, write footer, close resource. Only a
couple of steps actually differ per format. Without a shared skeleton, every
new format re-implements (and can subtly get wrong) the shared sequencing:

```java
class CsvReportGenerator {
    void generate() {
        List<Row> data = fetchData();
        writeCsvHeader();
        for (Row r : data) writeCsvRow(r);
        writeCsvFooter();
        close();
    }
}
class PdfReportGenerator {
    void generate() {
        List<Row> data = fetchData();     // duplicated
        writePdfHeader();                  // only this line differs
        for (Row r : data) writePdfRow(r); // and this
        writePdfFooter();                  // and this
        close();                           // duplicated
    }
}
// the shared skeleton (fetch, header, loop, footer, close) is copy-pasted;
// a bug in the shared sequencing (e.g. forgetting close()) must be fixed in every copy
```

### 2. The pattern applied

Put the invariant algorithm skeleton in a base class as a `final` method;
subclasses override only the steps that actually vary.

```java
abstract class ReportGenerator {
    // Template Method — the algorithm's shape is fixed and cannot be reordered by subclasses
    public final void generate() {
        List<Row> data = fetchData();
        writeHeader();
        for (Row row : data) writeRow(row);
        writeFooter();
        close();
    }

    protected List<Row> fetchData() { return reportRepository.fetchAll(); } // shared default
    protected abstract void writeHeader();
    protected abstract void writeRow(Row row);
    protected abstract void writeFooter();
    protected void close() { /* shared cleanup, subclasses may override if needed */ }
}

class CsvReportGenerator extends ReportGenerator {
    protected void writeHeader() { /* csv header */ }
    protected void writeRow(Row row) { /* csv row */ }
    protected void writeFooter() { /* csv footer */ }
}

class PdfReportGenerator extends ReportGenerator {
    protected void writeHeader() { /* pdf header */ }
    protected void writeRow(Row row) { /* pdf row */ }
    protected void writeFooter() { /* pdf footer */ }
}

// caller never sees the skeleton — it's guaranteed identical for every format:
new CsvReportGenerator().generate();
new PdfReportGenerator().generate();
```

### 3. UML-style diagram

```
ReportGenerator (abstract)
---------------------------
+ generate()  final          <- the fixed skeleton, cannot be overridden
# fetchData()                <- shared default, overridable
# writeHeader()   abstract   <- "hook" — subclass MUST supply
# writeRow(row)   abstract   <- "hook"
# writeFooter()   abstract   <- "hook"
# close()                    <- shared default
        ^
   _____|__________________
  |                         |
CsvReportGenerator     PdfReportGenerator
+writeHeader/Row/Footer +writeHeader/Row/Footer
(only fills in the hooks — cannot change the overall sequence)
```

### 4. Real-world usage

- **`java.io.InputStream.read()`** (the family of `read()` overloads) —
  `AbstractList`, `AbstractMap` etc. in the Java Collections Framework
  provide template methods (`equals()`, `hashCode()` skeletons) built on
  abstract primitives like `get(index)` that subclasses supply.
- **JUnit's `TestCase` lifecycle** — `setUp() → runTest() → tearDown()` is a
  template method; you only fill in `runTest()` (or annotate `@Test`
  methods), the framework calls the fixed sequence around it.
- **Servlet's `HttpServlet.service()`** — dispatches to `doGet`/`doPost`
  hooks in a fixed lifecycle you don't control.

### 5. Trade-offs / when not to use

- **Pro**: guarantees the invariant parts of an algorithm cannot drift or be
  forgotten across subclasses; makes the *variable* parts explicit and
  minimal (just the abstract hooks).
- **Con**: relies on inheritance, which is a stronger coupling than
  composition — subclasses are locked into the base class's exact skeleton
  shape; if two formats need a genuinely different *sequence* (not just
  different steps), Template Method fights you (favor Strategy/composition
  in that case).
- **Con**: "hook explosion" — if the skeleton has 8 overridable steps and
  most subclasses only care about 2, consider giving no-op defaults so
  subclasses aren't forced to implement irrelevant hooks.

### 6. How it shows up in an LLD interview

"Design a data export pipeline with multiple formats," "design a game
framework where each game type has the same turn structure but different
rules," "design a build/CI pipeline with fixed stages but customizable
steps." The tell is "same overall steps, different implementation of a few
of them, and we must not let the steps get out of order."

---

## Iterator (concept level)

### 1. The motivating problem

You have several different collection types internally — a `LinkedPlaylist`
(linked list of songs), an `ArrayBackedQueue`, a `BinaryTreeIndex` — and
client code wants to traverse each of them uniformly without knowing (or
being allowed to depend on) each one's internal structure:

```java
class LinkedPlaylist {
    Node head; // client must walk node.next manually, exposing internal representation
}
// caller code, coupled to the internal linked-list structure:
Node current = playlist.head;
while (current != null) {
    play(current.song);
    current = current.next; // this ONLY works for LinkedPlaylist — a different
}                            // collection needs completely different traversal code,
                             // and exposing `head`/`Node` breaks encapsulation
```
Every consumer of every collection type needs bespoke traversal code, and
internal structure (`Node`, array index, tree pointers) leaks to callers who
shouldn't need to know it.

### 2. The pattern applied (concept)

Each collection exposes a uniform `Iterator` that knows how to walk *that*
structure internally, while every caller uses the same two methods
(`hasNext()`/`next()`) regardless of what's underneath.

```java
interface Iterator<T> {
    boolean hasNext();
    T next();
}

class LinkedPlaylist implements Iterable<Song> {
    private Node head;
    public Iterator<Song> iterator() {
        return new Iterator<>() {
            private Node current = head;
            public boolean hasNext() { return current != null; }
            public Song next() { Song s = current.song; current = current.next; return s; }
        };
    }
}

// caller code is now identical for ANY Iterable, regardless of internal structure:
for (Song song : linkedPlaylist) { play(song); }   // for-each works uniformly
for (Song song : arrayBackedPlaylist) { play(song); } // same loop, totally different internals
```

### 3. UML-style diagram

```
<<interface>> Iterable<T>          <<interface>> Iterator<T>
 + iterator(): Iterator<T>          + hasNext(): boolean
        ^                            + next(): T
        |                                   ^
  LinkedPlaylist                            |
  --------------              LinkedPlaylist's private
  - head: Node                 anonymous Iterator impl
  + iterator()  -------------> (walks Node.next internally,
                                 hides it completely from caller)
```

### 4. Real-world usage

- **`java.util.Iterator` / `Iterable`** — this is *the* built-in
  implementation; every `for (T t : collection)` loop in Java compiles down
  to exactly this pattern.
- **Database cursors** (JDBC `ResultSet`, MongoDB cursor) — uniform
  `next()`/`hasNext()`-style traversal over rows regardless of how the
  underlying storage engine actually stores/streams them.
- **Python generators / `__iter__`/`__next__`** — the same concept as a
  first-class language feature.

### 5. Trade-offs / when not to use

- **Con**: in most modern languages (Java, Python, C#, JS) this pattern is
  built into the language/standard library — you almost never hand-roll it
  from scratch in application code; you *use* the built-in `Iterable`/
  `Iterator` (or `for...of`, generators) rather than reinvent it.
- Treated at **concept level**: the interview value is recognizing "the
  client shouldn't know this collection's internal structure to traverse
  it" and naming the standard mechanism, not writing a custom iterator by
  hand unless the interviewer specifically asks for a custom traversal
  order (e.g., "iterate a tree in a specific custom order").

### 6. How it shows up in an LLD interview

Comes up as a supporting detail rather than the star: "design a custom data
structure" (e.g., a browser history stack, an LRU cache, a custom tree) and
the interviewer asks "how would a caller traverse this?" — the correct
answer is "expose an `Iterator`/implement `Iterable`, so it works with
standard for-each and doesn't leak internal structure," not "expose the
internal node/array directly."

---

## Decision Table: Symptom → Pattern

| Symptom in requirements | Pattern to reach for |
|---|---|
| "New [type] gets added often; a conditional keeps growing" (which class to construct varies) | **Factory Method** |
| "Several related objects must always be chosen/used together consistently" (e.g., per-region, per-theme, per-vendor families) | **Abstract Factory** |
| "This object has many optional/defaulted fields, and the constructor is telescoping" | **Builder** |
| "Exactly one of this must exist, and construction is expensive or state must be shared" | **Singleton** (prefer DI-scoped over hand-rolled) |
| "I need many near-identical copies of an expensive-to-build object" | **Prototype** |
| "This third-party/legacy API doesn't match the interface my code expects" | **Adapter** |
| "I need to stack optional behaviors (logging, caching, retry, encryption) in any combination at runtime" | **Decorator** |
| "Callers have to orchestrate many subsystems correctly, in the right order, every time" | **Facade** |
| "This is a part-whole tree (groups containing groups or leaves) and I keep branching on 'is this a group or a leaf'" | **Composite** |
| "I need to control/delay/guard access to an expensive or sensitive object without changing its class or the caller" | **Proxy** |
| "Need to swap an algorithm at runtime, or add new algorithms without touching the caller" | **Strategy** |
| "When X happens, an open-ended/growing set of independent listeners need to react" | **Observer** |
| "Behavior and valid operations depend heavily on 'what state am I currently in,' with a wall of status conditionals" | **State** |
| "Need undo/redo, need to queue actions for later, or need to log/replay every action taken" | **Command** |
| "A request must pass through an ordered, reorderable, optionally-skippable series of independent checks/handlers" | **Chain of Responsibility** |
| "Several variants share the same overall step sequence, but a few individual steps differ" | **Template Method** |
| "Callers need to traverse different internal data structures the same way, without knowing their internals" | **Iterator** (usually: just use the language's built-in) |

---

## Closing: the framing question, answered

> **Can I create software that remains clean when requirements change?**

None of the seventeen patterns above are things to memorize and slot in.
Each one is the *name of a seam* that appears once you've correctly located
where a system is about to change: which class to build, how a family of
objects stays consistent, how many instances may exist, what shape wraps
what, or which behavior runs when. The discipline that actually answers the
framing question is not "I know 17 patterns" — it's the habit, repeated on
every design: **find the axis of change first, name it out loud, and only
then reach for the pattern whose shape matches it.** If you can't name the
change, you don't have a pattern to apply yet — you have a class to write,
plainly, and that is very often the correct, senior answer.
