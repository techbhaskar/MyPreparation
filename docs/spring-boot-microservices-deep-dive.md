# Spring Boot Microservices Deep Dive
Last updated: 2026-08-27
_Overview and notes._
Last updated: 2026-08-27

*Companion to [kafka-deep-dive.md](kafka-deep-dive.md) in this study set. Where a topic overlaps with Kafka mechanics already covered there (retry topics, exactly-once, the Outbox pattern, DLQs), this document cross-references those lessons by name rather than repeating them — its job is the Spring-specific plumbing and the broader Spring Boot / Spring Cloud microservices picture: dependency injection, REST APIs, Spring Data JPA, service discovery, API gateways, resilience patterns, observability, security, and deployment.*

This document is organized as 17 topics across three arcs:

- **Foundations (1-5):** Spring Boot fundamentals, dependency injection, REST APIs, Spring Data JPA & transactions, testing.
- **Microservices with Spring Cloud (6-11):** service discovery, API gateway, centralized config, inter-service communication, resilience patterns (Resilience4j), decomposition patterns in practice.
- **Production, Security & Kafka (12-17):** Actuator & production readiness, observability, Spring Security, Spring Kafka integration, Docker/Kubernetes deployment, and a closing synthesis of the interview traps that recur across all of the above.

---

## Reading Format

Each topic is now structured for two-pass revision:

1. Read the visible quick sections first: 30-second answer, interviewer intent, key points, traps, and senior-level answer.
2. Open **Deep dive notes** only when you need full explanation, examples, or implementation detail.
3. Use **Interview Questions** for active recall after reading.

## Table of Contents

- [Topic 1 — Spring Boot Fundamentals](#topic-1)
- [Topic 2 — Dependency Injection & the IoC Container](#topic-2)
- [Topic 3 — Building REST APIs with Spring Boot](#topic-3)
- [Topic 4 — Spring Data JPA & Transactions](#topic-4)
- [Topic 5 — Testing Spring Boot Applications](#topic-5)
- [Topic 6 — Service Discovery (Eureka / Consul)](#topic-6)
- [Topic 7 — API Gateway with Spring Cloud Gateway](#topic-7)
- [Topic 8 — Centralized Configuration with Spring Cloud Config](#topic-8)
- [Topic 9 — Inter-Service Communication: RestTemplate/WebClient vs OpenFeign](#topic-9)
- [Topic 10 — Resilience Patterns with Resilience4j](#topic-10)
- [Topic 11 — Microservices Decomposition Patterns in Practice](#topic-11)
- [Topic 12 — Spring Boot Actuator & Production Readiness](#topic-12)
- [Topic 13 — Observability: Metrics, Tracing, and Structured Logging](#topic-13)
- [Topic 14 — Spring Security: Authentication & Authorization](#topic-14)
- [Topic 15 — Spring Kafka Integration](#topic-15)
- [Topic 16 — Dockerizing and Deploying Spring Boot to Kubernetes](#topic-16)
- [Topic 17 — Common Spring Boot Interview Traps (Synthesis)](#topic-17)

---

\<a id="topic-1">\</a>

## Topic 1 — Spring Boot Fundamentals

### 30-second answer

Spring Boot packages Spring with auto-configuration, starters, embedded servers, and production defaults so services can run as standalone apps.

### Why interviewers ask this

Interviewers check whether you understand what Boot actually does beyond `@SpringBootApplication`.

### Key points

- Auto-configuration is conditional and can be overridden.
- Starters bring curated dependency sets.
- Embedded Tomcat/Jetty/Undertow changed Java deployment style.
- Externalized config separates artifact from environment.
- Actuator adds production visibility.

### Common traps

- Saying Boot replaces Spring.
- Not knowing why a bean was or was not created.
- Hardcoding environment config into the artifact.
- Ignoring startup and dependency version behavior.

### Senior-level answer

Explain Boot as operational simplification plus convention. For architecture roles, connect it to deployability, configuration, observability, and how auto-configuration behaves when teams customize it.


\<details>
\<summary>\<strong>Deep dive notes\</strong>\</summary>

Spring Boot is not a new framework sitting beside Spring — it is an opinionated packaging of the
Spring Framework that eliminates the two things that made pre-2014 Spring projects painful: manual
bean wiring via XML (or verbose `@Configuration` classes) and the requirement to build a WAR file,
hand it to an operations team, and deploy it into an externally managed Tomcat or WebLogic instance.
If you worked on a payments platform a decade ago, the deployment story looked like this: a
`web.xml`, a `DispatcherServlet` entry, a hand-assembled `applicationContext.xml` wiring together
your `DataSource`, your `TransactionManager`, your `PaymentGatewayClient`, and a WAR that got copied
into `$CATALINA_HOME/webapps` on a shared app server that also hosted three other teams' services. A
misconfigured library version on that shared Tomcat could take down unrelated services. Spring
Boot's core insight is that the JVM ecosystem had matured to the point where embedding the servlet
container inside the application — rather than deploying the application into the container — was
both simpler and more aligned with how you actually want to run microservices: one process, one
port, one deployable artifact, `java -jar payment-service.jar` and it's up. This is what "fat jar"
or "über jar" packaging via `spring-boot-maven-plugin` or the Gradle equivalent gives you: your
compiled classes, all your transitive dependencies, and an embedded Tomcat (default), Jetty, or
Undertow, all bundled into a single executable JAR with its own `main()` method that calls
`SpringApplication.run()`.

The second pillar, alongside embedded servers, is auto-configuration, and this is the part
candidates can describe at a surface level but rarely explain mechanically — which is exactly what a
staff-level interviewer will probe. When you add `spring-boot-starter-data-jpa` to your `pom.xml`,
you get Hibernate, a `DataSource` bean, a `JpaTransactionManager`, and an `EntityManagerFactory`,
all configured and wired for you, without you writing a single `@Bean` method. The mechanism is
`@EnableAutoConfiguration`, which is itself pulled in transitively by the `@SpringBootApplication`
meta-annotation (which is really `@SpringBootConfiguration` + `@EnableAutoConfiguration` +
`@ComponentScan` bundled together). Historically, `@EnableAutoConfiguration` worked by reading
`META-INF/spring.factories` from every JAR on the classpath, looking for the key
`org.springframework.boot.autoconfigure.EnableAutoConfiguration`, and loading every class listed
there as a candidate configuration class. As of Spring Boot 2.7+ (and mandatory from 3.0), this
moved to a dedicated file, `META-
INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports`, which is functionally
the same idea — a plain list of fully qualified `@Configuration` class names — but scoped to auto-
configuration specifically instead of sharing the `spring.factories` file with other extension
points (listeners, failure analyzers, etc.), which made classpath scanning faster and the mechanism
easier to reason about.

Here is the part that actually matters for the "why did my bean not get created" debugging session:
every one of those auto-configuration classes is guarded by conditional annotations, most commonly
`@ConditionalOnClass`, `@ConditionalOnMissingBean`, `@ConditionalOnProperty`, and
`@ConditionalOnBean`. `DataSourceAutoConfiguration` is annotated `@ConditionalOnClass(\{
DataSource.class, EmbeddedDatabaseType.class \})` — it only activates if a JDBC `DataSource` class is
actually present on the classpath, which is why adding `spring-boot-starter-data-jpa` (which
transitively pulls in `spring-boot-starter-jdbc` and a JDBC driver) is what triggers datasource
auto-configuration, not some hardcoded special case for JPA. Critically, almost every auto-
configured bean is also annotated `@ConditionalOnMissingBean`, meaning: "only create this bean if
the application hasn't already defined one of this type." This is the entire mechanism by which you
can override Spring Boot's defaults — define your own `DataSource` `@Bean` in a `@Configuration`
class, and Spring Boot's auto-configured one backs off silently. There's no override syntax, no
priority annotation you need to remember; it's just ordinary bean definition plus a conditional that
checks "does one already exist." This is also why bean definition order and
`@AutoConfigureOrder`/`@AutoConfigureAfter` matter in edge cases — if your custom `DataSource` bean
is defined in a configuration class that hasn't been processed yet when the conditional check runs,
you can end up with two datasources or a startup failure, which is a real bug class in large, multi-
module Spring Boot codebases with dozens of custom auto-configurations.

Configuration itself is externalized through `application.yml` or `application.properties`, and
Spring Boot resolves properties through a well-defined precedence chain — this is the single most
useful piece of knowledge for debugging "why isn't my config taking effect," and every senior
engineer should be able to recite it without hesitation:

1. Command-line arguments (`--server.port=8443`)
2. `SPRING_APPLICATION_JSON` (inline JSON embedded in an env var or system property)
3. `ServletConfig` / `ServletContext` init parameters
4. JNDI attributes from `java:comp/env`
5. Java System properties (`-Dserver.port=8443`)
6. OS environment variables (`SERVER_PORT=8443`)
7. Profile-specific `application-{profile}.yml` **outside** the packaged jar
8. Profile-specific `application-{profile}.yml` **inside** the packaged jar
9. Base `application.yml` **outside** the packaged jar
10. Base `application.yml` **inside** the packaged jar
11. `@PropertySource`-annotated sources
12. Default properties set via `SpringApplication.setDefaultProperties`

The practical rule of thumb that survives the detail: command-line args beat environment variables
beat profile-specific config beat base config beat hardcoded defaults, and anything external to the
jar beats anything packaged inside it. This is exactly what makes "same jar, different environment"
work for microservices: you build `payment-service-1.4.2.jar` exactly once in your CI pipeline, and
every environment — dev, staging, prod — runs that identical artifact with different environment
variables or a different mounted `application-prod.yml`, activated via
`SPRING_PROFILES_ACTIVE=prod`. You never rebuild for an environment, which is a hard requirement in
regulated fintech environments where the artifact that passed security scanning and QA sign-off in
staging must be bit-for-bit the same artifact promoted to production — rebuilding per environment
breaks that chain of custody.

Spring Profiles are the mechanism for varying that configuration and even bean composition per
environment. `@Profile("prod")` on a `@Bean` method or `@Component` class means that bean is only
registered when `prod` is among the active profiles (`spring.profiles.active=prod`, settable via any
of the property sources above). A common pattern is a `LocalStackS3Config` bean annotated
`@Profile("!prod")` for local development against a fake S3, and a `AwsS3Config` bean annotated
`@Profile("prod")` wiring the real SDK client against real credentials — Spring resolves exactly one
of them per environment, and your application code that depends on `S3Client` never knows or cares
which implementation it got.

```yaml
# application.yml (base — shared defaults across all environments)
spring:
  application:
    name: payment-service
  profiles:
    active: ${SPRING_PROFILES_ACTIVE:dev}
server:
  port: 8080
management:
  endpoints:
    web:
      exposure:
        include: health, info, metrics

---
# application-dev.yml
spring:
  datasource:
    url: jdbc:h2:mem:paymentdb
    driver-class-name: org.h2.Driver
    username: sa
    password:
  jpa:
    hibernate:
      ddl-auto: update
    show-sql: true
logging:
  level:
    com.paypal.payments: DEBUG

---
# application-prod.yml
spring:
  datasource:
    url: ${DB_URL}
    username: ${DB_USERNAME}
    password: ${DB_PASSWORD}
    hikari:
      maximum-pool-size: 20
      connection-timeout: 3000
  jpa:
    hibernate:
      ddl-auto: validate
    show-sql: false
logging:
  level:
    com.paypal.payments: INFO
```

```java
@SpringBootApplication
public class PaymentServiceApplication {

    public static void main(String[] args) {
        SpringApplication.run(PaymentServiceApplication.class, args);
    }
}
```

```properties
# Overriding via command-line at deploy time — no rebuild required
# java -jar payment-service.jar --spring.profiles.active=prod --server.port=8443
```

Note that `ddl-auto: update` shows up in the dev profile only — it is convenient for local iteration
but is a production incident waiting to happen, a point covered in depth in Topic 4. The profile
split above is precisely how you keep that convenience without ever letting it near a real database.

The microservices angle is worth stating explicitly because it's the "so what" an interviewer wants
to hear: in a monolith, configuration change historically meant a redeploy of the one application.
In a microservices fleet of forty independently owned services, each service needs to be
independently configurable — different connection pool sizes, different feature flags, different
downstream endpoint URLs — without any service depending on another's deployment cycle. Spring
Boot's externalized, layered configuration model, combined with Spring Cloud Config or a platform-
native secrets/config store (Kubernetes ConfigMaps and Secrets mounted as environment variables or
files, AWS Parameter Store, Vault), is what makes "one artifact, N environments, independently
tunable" actually achievable at organizational scale rather than just architecturally desirable.

\</details>

### Interview Questions

**What is the actual difference between Spring and Spring Boot — isn't Spring Boot "just Spring"?** Spring Boot is built on top of the Spring Framework, not a replacement for it — dependency injection, AOP, transaction management, and Spring MVC are all still plain Spring underneath. What Spring Boot adds is opinionated defaults and automation: auto-configuration that wires common beans based on classpath contents, starter dependencies that bundle compatible library versions so you're not resolving Hibernate/Jackson/Tomcat version conflicts by hand, an embedded servlet container so the application is self-contained and executable, and production-readiness features like the Actuator for health checks and metrics out of the box. The honest framing for an interviewer is that Spring Boot trades some configuration flexibility for a massive reduction in boilerplate and setup time, and lets you override any default explicitly when the opinion doesn't fit your case — it's additive convention, not a constraint.

**How does Spring Boot decide which auto-configurations to actually apply, and how would you debug one that isn't activating?** Every candidate auto-configuration class listed in `AutoConfiguration.imports` is evaluated against its conditional annotations — `@ConditionalOnClass` checks classpath presence, `@ConditionalOnMissingBean` checks whether you've already defined a competing bean, `@ConditionalOnProperty` checks a specific property value. To debug, the single most useful tool is running with `--debug` (or setting `debug: true` in application.yml), which prints the auto-configuration report on startup: a "Positive matches" list of what activated and why, and a "Negative matches" list of what was considered and rejected, along with the specific condition that failed. If `DataSourceAutoConfiguration` shows up under negative matches because `@ConditionalOnClass` didn't find a `DataSource` class, that immediately tells you the JDBC driver or starter dependency is missing from the classpath rather than something being misconfigured in your YAML.

**Walk through the full property resolution order and explain a real scenario where getting this wrong causes a production incident.** The order runs, roughly highest to lowest priority: command-line args, `SPRING_APPLICATION_JSON`, servlet/JNDI parameters, JVM system properties, OS environment variables, profile-specific config outside the jar, profile-specific config inside the jar, base config outside the jar, base config inside the jar, then `@PropertySource` and programmatic defaults. A realistic incident: an engineer bakes `spring.datasource.url` pointing at a staging database directly into `application.yml` inside the jar "temporarily" for a local test, forgets to revert it, and it ships. In production, the deployment sets `DB_URL` as an environment variable expecting it to override — and it does, because env vars outrank the packaged `application.yml` — so the incident doesn't actually happen in that direction. The dangerous version is the reverse: someone sets `spring.datasource.url` in a profile-specific `application-prod.yml` packaged inside the jar, assuming it's the final word, not realizing an environment variable or command-line flag set by the deployment pipeline silently overrides it — the service connects to the wrong database and nobody understands why until they trace the actual precedence chain rather than just reading the YAML file everyone assumes is authoritative.

**Why does Spring Boot favor embedded servers over deploying a WAR to an external Tomcat, and are there cases where you'd still choose WAR deployment?** Embedded servers make the application a self-contained, independently deployable unit — exactly the property microservices need. It removes an entire class of "works on my machine" and "which Tomcat version is this environment running" problems, since the server version is pinned in your dependency tree and versioned alongside your code. It also enables container-native deployment: a Docker image built `FROM eclipse-temurin:21-jre` that just runs `java -jar app.jar` is trivial compared to building an image with a Tomcat installation, deploying a WAR into its webapps directory, and managing Tomcat's own configuration surface separately from the application's. The remaining legitimate case for WAR deployment is a genuinely shared-hosting environment — some enterprises still mandate deployment onto a centrally managed, security-hardened app server fleet for compliance or operational-standardization reasons — and Spring Boot supports this too via `spring-boot-starter-tomcat` marked `provided` and extending `SpringBootServletInitializer`, but for a microservices architecture with independent deployability as a goal, that's working against the model rather than with it.

**Staff Engineer scenario:** You inherit a payment-service fleet where every service reads `application.yml` bundled inside the jar, and a recent postmortem showed a service silently using a stale downstream URL for three weeks after infra rotated it, because the change was pushed to a Kubernetes ConfigMap but the service had a leftover hardcoded value in `application-prod.yml` that nobody realized was overriding the intended external config. How do you fix this class of problem structurally, not just for this one service? The root issue is that property precedence was inverted from what the team assumed — everyone believed the ConfigMap-injected environment variable was authoritative, but a profile-specific file packaged inside the jar was actually competing with it, and depending on exact property key naming and Spring's relaxed binding rules, the in-jar file won or created ambiguity. The structural fix is threefold: first, enforce via code review and a CI lint step that packaged `application-{env}.yml` files never contain environment-specific values like URLs, credentials, or hostnames — only structural defaults (log levels, actuator exposure, thread pool sizing) that are safe regardless of environment; second, make all genuinely environment-specific values flow exclusively through environment variables or a mounted external config file outside the jar, so there's exactly one source of truth per key and no ambiguity about precedence; third, add a startup-time assertion or a `/actuator/env` check in the deployment pipeline's smoke test that verifies the resolved value of critical properties (downstream URLs, datasource host) matches what the deployment pipeline intended to inject, catching this class of drift automatically rather than three weeks into an incident.

\<a id="topic-2">\</a>

## Topic 2 — Dependency Injection & the IoC Container

### 30-second answer

Spring creates and wires objects through the IoC container, allowing application code to depend on abstractions instead of manual construction.

### Why interviewers ask this

They want design maturity: testability, lifecycle awareness, and avoiding framework misuse.

### Key points

- Prefer constructor injection for mandatory dependencies.
- Bean lifecycle matters for initialization and cleanup.
- Scopes control object lifetime.
- Profiles and conditions shape runtime wiring.
- Circular dependencies usually signal poor design.

### Common traps

- Field injection in serious code.
- Doing heavy work in constructors.
- Confusing bean scope with thread safety.
- Using Spring injection to hide bad boundaries.

### Senior-level answer

Use DI to make dependencies explicit and testable. Keep domain logic independent where possible, and treat container lifecycle as production behavior, not magic.


\<details>
\<summary>\<strong>Deep dive notes\</strong>\</summary>

The Inversion of Control container is Spring's runtime object graph — it owns the responsibility of
instantiating your `@Service`, `@Repository`, `@Component`, and `@Configuration`-declared beans,
resolving what each one depends on, and wiring them together, so that your `PaymentService` class
never calls `new StripeGateway()` itself. It just declares "I need a `PaymentGateway`," and the
container decides which concrete implementation to hand it and when to construct it. The word
"inversion" is literal: in plain Java, the calling code controls when and how a dependency is
created; with IoC, that control moves out of your code and into the framework, which is what makes
your business logic testable in isolation (swap in a mock) and swappable at the implementation level
(swap `StripeGateway` for `RazorpayGateway`) without touching the consuming class at all.

There are three mechanical ways to get a dependency into a bean — constructor injection, field
injection, and setter injection — and while all three work, they are not equivalent, and a staff-
level engineer should be able to justify constructor injection as the default without hesitation.
Field injection (`@Autowired` directly on a field) is the most common pattern in tutorials and
legacy codebases because it's the least code to type, but it has real costs: the field can't be
`final`, so the class is mutable in a way it doesn't need to be; the dependency is invisible from
the class's public surface, so anyone constructing this object manually (most obviously, in a unit
test without a Spring context) gets an object in a broken, half-initialized state with silent
`NullPointerException`s waiting to happen at first use rather than a compile-time signal; and it
relies on reflection to set the field after construction, which sidesteps Java's own initialization
guarantees. Setter injection is a middle ground, historically used for optional dependencies, but it
has the same problem of leaving the object in a partially constructed state between instantiation
and the setter call, and it's rare in modern Spring Boot code outside of specific reconfiguration
scenarios. Constructor injection is the recommended default for a concrete set of reasons:
dependencies become `final` fields, so the class is genuinely immutable after construction and
thread-safety reasoning is simpler; every required dependency is visible in one place — the
constructor signature — making the class's actual contract obvious without reading annotations
scattered across fields; a class becomes constructible and testable with plain `new
PaymentService(mockGateway, mockLedger)` in a unit test with zero Spring context and zero reflection
tricks; and, critically, it's the only injection style where Spring can detect a circular dependency
at application startup, failing fast with a clear `BeanCurrentlyInCreationException` rather than
letting a half-wired object escape into production.

```java
@Service
public class PaymentService {

    private final PaymentGateway paymentGateway;
    private final LedgerClient ledgerClient;
    private final PaymentRepository paymentRepository;

    // As of Spring 4.3+, @Autowired is optional on a single constructor —
    // Spring infers it automatically. Still fine to write explicitly for clarity.
    public PaymentService(PaymentGateway paymentGateway,
                           LedgerClient ledgerClient,
                           PaymentRepository paymentRepository) {
        this.paymentGateway = paymentGateway;
        this.ledgerClient = ledgerClient;
        this.paymentRepository = paymentRepository;
    }

    public PaymentResult charge(PaymentRequest request) {
        GatewayResponse response = paymentGateway.charge(request);
        ledgerClient.recordEntry(request.getAccountId(), response.getAmount());
        return paymentRepository.save(PaymentResult.from(response));
    }
}
```

Bean scope determines how many instances of a bean the container actually creates and hands out.
`singleton` — one shared instance per Spring container, reused for every injection point — is the
default and covers the overwhelming majority of Spring Boot beans: your `PaymentService`, your
`JdbcTemplate`, your `RestTemplate`. This works because well-designed services are stateless — all
the request-specific data flows through method parameters, not instance fields — so sharing one
instance across every concurrent request is both safe and far cheaper than constructing a new object
graph per request. `prototype` scope creates a brand-new instance every time the bean is requested
from the container, which is appropriate for genuinely stateful, short-lived objects — think a
builder-style object accumulating state across several calls that shouldn't be shared across
threads. Web-specific scopes exist for a reason tied directly to the servlet model: `request` scope
creates one bean instance per HTTP request and is useful for something like a `PaymentContext`
object that accumulates trace IDs and request-specific metadata for logging correlation across the
request's lifetime; `session` scope creates one instance per HTTP session, historically used for
shopping-cart-style state in stateful web apps, though it's rare in stateless REST APIs and
essentially absent in a properly designed microservice, where session affinity working against
horizontal scalability is exactly the problem stateless services are designed to avoid.

When more than one bean satisfies the same type — the textbook payments example being two
implementations of a `PaymentGateway` interface, `StripeGateway` and `RazorpayGateway` — Spring
can't autowire by type alone anymore, and you need either `@Qualifier` to pick a specific bean by
name or `@Primary` to declare a default among candidates.

```java
public interface PaymentGateway {
    GatewayResponse charge(PaymentRequest request);
}

@Component("stripeGateway")
public class StripeGateway implements PaymentGateway {
    @Override
    public GatewayResponse charge(PaymentRequest request) {
        // Stripe SDK call
        return new GatewayResponse(/* ... */);
    }
}

@Component("razorpayGateway")
@Primary
public class RazorpayGateway implements PaymentGateway {
    @Override
    public GatewayResponse charge(PaymentRequest request) {
        // Razorpay SDK call
        return new GatewayResponse(/* ... */);
    }
}

@Service
public class CheckoutService {

    private final PaymentGateway defaultGateway;   // resolves to RazorpayGateway via @Primary
    private final PaymentGateway stripeGateway;     // needs @Qualifier — @Primary only breaks ties, doesn't disambiguate an explicit request

    public CheckoutService(PaymentGateway defaultGateway,
                            @Qualifier("stripeGateway") PaymentGateway stripeGateway) {
        this.defaultGateway = defaultGateway;
        this.stripeGateway = stripeGateway;
    }
}
```

A more production-realistic version routes by a runtime signal rather than hardcoding a qualifier
per call site — a `Map\<String, PaymentGateway>` injected by Spring (keyed by bean name
automatically) lets you select the gateway based on merchant configuration or currency without an
`if/else` chain of qualifiers scattered through the codebase:

```java
@Service
public class GatewayRouter {

    private final Map<String, PaymentGateway> gatewaysByName;

    public GatewayRouter(Map<String, PaymentGateway> gatewaysByName) {
        this.gatewaysByName = gatewaysByName;
    }

    public PaymentGateway resolve(String merchantPreferredGateway) {
        PaymentGateway gateway = gatewaysByName.get(merchantPreferredGateway);
        if (gateway == null) {
            throw new IllegalArgumentException("Unknown gateway: " + merchantPreferredGateway);
        }
        return gateway;
    }
}
```

Bean lifecycle callbacks give you hooks into construction and teardown beyond the constructor
itself. `@PostConstruct` (from `jakarta.annotation`) runs once, after all dependencies have been
injected, which is where you put initialization logic that depends on those dependencies being
present — validating that a configured API key is non-blank, warming a cache, opening a connection
pool that couldn't be built purely in the constructor. `@PreDestroy` runs during graceful shutdown,
before the bean is removed from the container, and is where you release resources — closing a thread
pool, flushing a buffered metrics client. The older `InitializingBean`/`DisposableBean` interfaces
(`afterPropertiesSet()`/`destroy()`) achieve the same thing but couple your class directly to a
Spring interface, which `@PostConstruct`/`@PreDestroy` avoid since they're standard Jakarta
annotations, not Spring-specific — this is why annotation-based lifecycle hooks are generally
preferred for your own classes. For beans defined via `@Bean` factory methods in a `@Configuration`
class — typically third-party classes you don't own and can't annotate — `@Bean(initMethod =
"start", destroyMethod = "close")` lets you wire the same lifecycle behavior externally, which is
the standard pattern for things like a Kafka producer client or a connection pool from a library
that exposes its own `start()`/`close()` methods rather than implementing Spring's interfaces.

The circular dependency problem is one of the most concrete, checkable pieces of Spring knowledge an
interviewer can probe, because the "correct" answer changed materially with Spring Boot 2.6. Picture
two services: `OrderService` needs `PaymentService` to charge the customer, and `PaymentService`
needs `OrderService` to look up order details for fraud checks — each declares the other as a
constructor dependency. With field injection this used to "work" via Spring's early bean reference
mechanism (constructing one bean partially, injecting the still-incomplete reference into the other,
then finishing construction), but with constructor injection it's fundamentally unsolvable: to
construct `OrderService` you need a fully-built `PaymentService`, and to construct that you need a
fully-built `OrderService` — there is no valid order of operations. As of Spring Boot 2.6, circular
references are disallowed by default even for the cases that previously "worked" via early
references (`spring.main.allow-circular-references` defaults to `false`), and the container fails
fast at startup with a clear error rather than allowing it. This is correct behavior, not an
inconvenience to route around: a circular dependency between two services is almost always a sign
that they share responsibility that belongs in a third place, or that one direction of the
dependency is unnecessary and should be inverted. The common junior fix — slap `@Lazy` on one side
so Spring injects a proxy that defers real construction until first use — makes the code compile and
run, but it papers over the design smell instead of fixing it; the two services are still tightly
coupled, the proxy adds indirection and a subtle behavior difference (the first method call now does
extra work resolving the real bean), and the next engineer who touches this code inherits a
landmine. The actual fix is almost always to extract the shared logic — in this example, order
lookup logic used for fraud checking — into a third bean, say `OrderLookupService`, that both
`OrderService` and `PaymentService` depend on one-directionally, breaking the cycle by restructuring
the dependency graph rather than hiding it behind lazy initialization.

| Injection Style | Immutability | Testability without Spring context | Circular dependency detection | Recommended default |
|---|---|---|---|---|
| Constructor | Yes (`final` fields) | Yes — plain `new` | Fails fast at startup | Yes |
| Field (`@Autowired` on field) | No | No — needs reflection or a Spring context | Silently "resolved" via early reference (pre-2.6) or now fails | No |
| Setter | No | Partially — object valid only after setter runs | Allowed, order-dependent | Only for genuinely optional dependencies |

\</details>

### Interview Questions

**Why is constructor injection considered best practice over field injection, beyond "it's what Spring docs recommend"?** It comes down to what the class can guarantee about its own state. With constructor injection, a `PaymentService` object cannot exist in a state where `paymentGateway` is null — the constructor requires it, the field is `final`, and the compiler enforces both. With field injection, the class has a public no-arg-constructible shape (as far as the compiler is concerned) that's actually broken until Spring's post-processor runs and reflectively populates the fields; construct it manually in a test or accidentally instantiate it outside a Spring context and you get null fields with failures deferred to first use rather than construction. Constructor injection also makes a class's dependencies part of its visible API — you can look at one line and know exactly what this class needs to function — which pays off enormously in code review and onboarding. The practical tell that a class has too many responsibilities is a constructor with eight or nine parameters; field injection hides that signal completely, letting classes silently accumulate dependencies with no friction, which is itself an argument for constructor injection as a design-quality forcing function, not just a testability preference.

**Explain what actually happens, mechanically, when Spring detects a circular dependency between two constructor-injected beans, and why Spring Boot changed its default behavior here in 2.6.** During context startup, Spring builds beans by resolving their dependency graph — to construct bean A it must first have a fully constructed bean B if B is a constructor argument, and vice versa. With constructor injection there's no way to hand over a partially-built object, unlike field/setter injection where Spring historically could construct a bare instance, register it early in the singleton cache, inject that "early reference" into the other bean, and finish populating it afterward. Spring Boot 2.6 turned off allowing even that early-reference workaround by default, because it was papering over what is almost always a genuine design flaw, and because behavior depending on precise bean creation order made systems fragile and hard to reason about — a refactor that changed which bean got created first could silently break something. Now the framework fails immediately and loudly at startup, in your CI pipeline or local run, rather than shipping a subtly fragile object graph that might behave correctly today and break after an unrelated change six months later.

**When would you actually reach for `prototype` scope instead of the default singleton, in a payments-style codebase?** Almost never for your core service and repository beans — those should be stateless and shared. A legitimate case is a stateful helper that accumulates data across multiple method calls within a single logical operation and would be unsafe to share across concurrent requests if it were a singleton — for example, a `ReconciliationBatchContext` that a batch job constructs once per run to accumulate matched/unmatched transaction counts and intermediate state as it processes a file, where each batch run needs its own isolated instance. The far more common real-world need that looks similar but isn't actually solved by `prototype` scope is per-request data — for that, you either pass the data explicitly through method parameters (the cleanest option) or use `request` scope if you specifically need it woven into the bean graph, since `prototype` alone doesn't tie the bean's lifecycle to anything — the container hands you a new instance and then washes its hands of managing its lifecycle, including calling `@PreDestroy`, which is a common gotcha: `@PreDestroy` is not invoked for prototype beans by the container, so if a prototype bean holds a resource that needs explicit cleanup, you own that cleanup yourself.

**You have two `PaymentGateway` implementations. A new developer adds `@Primary` to both because "it wasn't working" without it. What's actually going on, and what's the correct design?** `@Primary` only works to disambiguate when the container needs one default candidate among several — for example, autowiring a bare `PaymentGateway paymentGateway` field or constructor parameter with no `@Qualifier`. If it "wasn't working," the actual bug is almost always that some injection point uses `@Qualifier("razorpayGateway")` or similar, and `@Primary` doesn't affect a qualified lookup at all — the developer likely misdiagnosed a typo'd qualifier name or a missing `@Component` name as an "ambiguous bean" issue and reached for `@Primary` as a blunt fix. Marking both implementations `@Primary` produces a hard startup failure (`Bean definitions ambiguous, multiple beans marked as primary`) if both are actually candidates for the same unqualified injection point, which usually surfaces the real problem immediately rather than hiding it — but if it "worked," it likely means the two `@Primary` annotations were on beans that were never actually competing for the same injection point in the first place, meaning the `@Primary` additions did nothing and the real fix was elsewhere. The correct design keeps at most one implementation marked `@Primary` as the sensible default (say, whichever gateway most call sites should get without ceremony) and uses explicit `@Qualifier` at the handful of call sites that genuinely need the non-default implementation, or better, a keyed `Map\<String, PaymentGateway>` injection for router-style code that picks a gateway dynamically based on merchant configuration.

**Staff Engineer scenario:** A code review flags that `RefundService` and `PaymentService` have a circular dependency, currently worked around with `@Lazy` on the `PaymentService` field inside `RefundService`. The team wants to just leave it since "it works and refunds are rare." How do you evaluate this, and what do you actually recommend? First, understand why the cycle exists: trace what `RefundService` actually needs from `PaymentService` and vice versa — in a typical case, `RefundService` needs `PaymentService` to look up the original charge details, and `PaymentService` needs `RefundService` only to check whether a payment has any pending refunds before allowing a new charge against the same instrument, which is itself a sign the check is misplaced. The `@Lazy` workaround isn't just cosmetically ugly — it defers a real problem: the first call into the lazily-wired dependency does extra proxy resolution work, error stack traces from that path are less obvious (failures surface through a proxy rather than a direct call), and any future engineer adding a third interacting service (say, `ChargebackService`) now has a template that says "circular dependencies are fine here, just add `@Lazy`," compounding the coupling rather than containing it. The concrete fix: extract a `PaymentLookupService` (or similar) holding read-only queries — "get charge by ID," "get refund status for a charge" — that both `RefundService` and `PaymentService` depend on one-directionally; `PaymentService`'s pending-refund check calls into `PaymentLookupService` instead of `RefundService` directly, and `RefundService` continues depending on `PaymentService` for the charge lookup, or better, also moves to the shared lookup service if that's cleaner. The `@Lazy` annotation gets deleted, the cycle is structurally gone, and — importantly for a regulated payments codebase — no service can even accidentally reintroduce this coupling later, since the dependency graph is now a genuine DAG the compiler enforces, not something a `@Lazy` annotation covered up while leaving the design flaw intact.

\<a id="topic-3">\</a>

## Topic 3 — Building REST APIs with Spring Boot

### 30-second answer

Good REST APIs expose stable resource contracts with validation, clear errors, pagination, idempotency, and versioning.

### Why interviewers ask this

They are checking API design, not just controller annotations.

### Key points

- Use DTOs at API boundaries.
- Validate input with Bean Validation.
- Return consistent error shapes.
- Use pagination for collections.
- Design idempotency for retryable writes.

### Common traps

- Exposing JPA entities directly.
- Returning inconsistent error formats.
- Ignoring idempotency for POST-like operations.
- Letting controller classes absorb business logic.

### Senior-level answer

For senior roles, describe the API contract, failure behavior, compatibility plan, and operational signals, then show how Spring annotations implement that contract.


\<details>
\<summary>\<strong>Deep dive notes\</strong>\</summary>

Spring MVC's request handling starts at a single front controller, `DispatcherServlet`, which every
incoming HTTP request passes through first. It consults a `HandlerMapping` to figure out which
controller method matches the request's path, HTTP method, headers, and content type, invokes that
method through a `HandlerAdapter`, and then hands the return value to a
`HandlerMethodReturnValueHandler` — for a `@RestController`, this ultimately routes through
Jackson's `HttpMessageConverter` to serialize your returned object to JSON and write it to the
response body. `@RestController` is `@Controller` plus `@ResponseBody` applied to every method,
meaning return values are treated as the actual HTTP response body rather than a view name to be
resolved by a template engine — this is the whole distinction between building a server-rendered MVC
application and building a JSON REST API, and it's why you'll never see a `@RestController` method
returning a `String` that resolves to a Thymeleaf template. `@RequestMapping` is the base annotation
for binding a method to a route, and `@GetMapping`, `@PostMapping`, `@PutMapping`, `@DeleteMapping`,
`@PatchMapping` are HTTP-method-specific shorthand for it — functionally
`@GetMapping("/payments/{id}")` is just `@RequestMapping(path = "/payments/\{id\}", method =
RequestMethod.GET)`, but the shorthand form makes the controller's route table scannable at a
glance, which matters a great deal once a controller has a dozen endpoints.

The DTO-versus-entity distinction is one of those things that looks like ceremony to a junior
engineer and looks like a load-bearing wall to anyone who has been paged because of it. Returning a
`@Entity`-annotated JPA class directly from a `@RestController` method is a genuine anti-pattern for
three concrete, independent reasons, not just "it's not clean." First, it leaks persistence-layer
structure into your public API contract — if `Payment` has an internal `retryCount` field or a
`partitionKey` used purely for database sharding, serializing the entity directly exposes that to
every API consumer, and now removing or renaming an internal implementation detail is a breaking API
change for external clients who never should have seen it. Second, it tightly couples your API's
shape to your database schema — adding a database column, or changing a JPA mapping strategy, now
directly and immediately changes what your API returns, when in a well-designed system those should
be two independently evolvable concerns with a DTO mapping layer absorbing the difference. Third,
and most concretely dangerous in practice: lazy-loaded associations. If `Payment` has a
`@ManyToOne(fetch = FetchType.LAZY) private Merchant merchant`, and you return the entity directly
from a controller method outside of an open Hibernate session (which, in a typical layered
architecture, the transaction has already closed by the time Jackson serializes the response),
accessing `merchant` during serialization throws a `LazyInitializationException` — or, if you have
Hibernate5Module configured to silently null out unfetched lazy associations to avoid that crash,
you get a response that just silently omits the merchant data with no error, which is arguably worse
because it fails silently in production rather than loudly in testing. A DTO — a plain class with
exactly the fields the API contract promises, mapped explicitly from the entity inside the service
layer, where you're still inside the transaction and lazy associations are safe to touch — sidesteps
all three problems at once.

```java
public record CreatePaymentRequest(
        @NotNull(message = "customerId is required")
        UUID customerId,

        @NotNull(message = "amount is required")
        @Positive(message = "amount must be greater than zero")
        BigDecimal amount,

        @NotBlank(message = "currency is required")
        @Pattern(regexp = "^[A-Z]{3}$", message = "currency must be a 3-letter ISO code")
        String currency,

        @NotNull(message = "paymentMethodId is required")
        String paymentMethodId
) {}

public record PaymentResponse(
        UUID paymentId,
        UUID customerId,
        BigDecimal amount,
        String currency,
        String status,
        Instant createdAt
) {
    public static PaymentResponse from(Payment payment) {
        return new PaymentResponse(
                payment.getId(),
                payment.getCustomerId(),
                payment.getAmount(),
                payment.getCurrency(),
                payment.getStatus().name(),
                payment.getCreatedAt()
        );
    }
}
```

```java
@RestController
@RequestMapping("/api/v1/payments")
public class PaymentController {

    private final PaymentService paymentService;

    public PaymentController(PaymentService paymentService) {
        this.paymentService = paymentService;
    }

    @PostMapping
    public ResponseEntity<PaymentResponse> createPayment(
            @Valid @RequestBody CreatePaymentRequest request) {

        Payment payment = paymentService.createPayment(request);
        PaymentResponse body = PaymentResponse.from(payment);

        URI location = ServletUriComponentsBuilder.fromCurrentRequest()
                .path("/{id}")
                .buildAndExpand(payment.getId())
                .toUri();

        return ResponseEntity.created(location).body(body);
    }

    @GetMapping("/{id}")
    public ResponseEntity<PaymentResponse> getPayment(@PathVariable UUID id) {
        Payment payment = paymentService.findById(id)
                .orElseThrow(() -> new PaymentNotFoundException(id));
        return ResponseEntity.ok(PaymentResponse.from(payment));
    }
}
```

Note the `POST` handler returns `201 Created` with a `Location` header pointing at the newly created
resource (`/api/v1/payments/{id}`), via `ResponseEntity.created(location)`, rather than a bare `200
OK`. This isn't pedantry — it's what REST clients and API gateways expect for resource creation, and
enough tooling (client SDK generators, some API gateway caching rules) assumes this convention that
deviating from it causes friction downstream that's hard to trace back to "we return 200 instead of
201."

`@Valid` triggers Jakarta Bean Validation on the annotated `@RequestBody` parameter, evaluating
constraint annotations like `@NotNull`, `@Positive`, `@NotBlank`, `@Pattern`, `@Size`, and any
custom `@Constraint`-annotated validator you've written, and if any constraint fails, Spring throws
a `MethodArgumentNotValidException` before your controller method body even executes — validation
failures never reach your business logic, which is exactly where you want that boundary. The
critical piece that turns this into a good API rather than a broken one is catching that exception
centrally rather than letting Spring's default error handling produce its generic (and, depending on
configuration, potentially stack-trace-leaking) response. `@ControllerAdvice` combined with
`@ExceptionHandler` gives you a single place, applied globally across every controller, to translate
exceptions into a consistent, structured error response shape.

```java
public class PaymentNotFoundException extends RuntimeException {
    public PaymentNotFoundException(UUID id) {
        super("Payment not found: " + id);
    }
}

public record ApiError(String code, String message, Instant timestamp, List<String> details) {}

@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(PaymentNotFoundException.class)
    public ResponseEntity<ApiError> handlePaymentNotFound(PaymentNotFoundException ex) {
        ApiError error = new ApiError("PAYMENT_NOT_FOUND", ex.getMessage(), Instant.now(), List.of());
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(error);
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiError> handleValidationFailure(MethodArgumentNotValidException ex) {
        List<String> details = ex.getBindingResult().getFieldErrors().stream()
                .map(fe -> fe.getField() + ": " + fe.getDefaultMessage())
                .toList();
        ApiError error = new ApiError("VALIDATION_FAILED", "Request validation failed", Instant.now(), details);
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(error);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiError> handleUnexpected(Exception ex) {
        // Log the full exception internally with a correlation ID — never expose ex.getMessage()
        // or the stack trace to the client for an unhandled exception in a payments API.
        ApiError error = new ApiError("INTERNAL_ERROR", "An unexpected error occurred", Instant.now(), List.of());
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(error);
    }
}
```

The last handler in that example matters as much as the specific ones — a catch-all for
`Exception.class` that returns a generic, non-leaky message is what stands between "our
NullPointerException with a stack trace mentioning our internal class names and table structure" and
"a clean structured error," and in a PCI-DSS-adjacent environment, leaking internal implementation
details in error responses is a real finding in a security review, not a theoretical concern.

API versioning is the last piece, and it matters disproportionately in payments because backward
compatibility isn't optional — a merchant's integration hitting your API might not get updated for
years, and breaking it breaks their revenue, which breaks your relationship with them. There are
three common strategies, each with real trade-offs:

| Strategy | Example | Pros | Cons |
|---|---|---|---|
| URI versioning | `/api/v1/payments`, `/api/v2/payments` | Explicit and visible in every log line, trivial to route at a gateway/load-balancer level, easy for API consumers to understand and pin against | "Pollutes" the URI with something that isn't really part of the resource identity; can lead to duplicated controller code across versions if not carefully abstracted |
| Header-based versioning | `Accept-Version: 2` or a custom header | Keeps URIs clean and stable as the canonical resource identifier | Less visible/discoverable — easy to miss in casual API exploration or basic curl testing; harder to route at some gateway/CDN layers that don't inspect custom headers by default |
| Content-negotiation versioning | `Accept: application/vnd.payments.v2+json` | "Correct" REST purism — versioning is part of content type negotiation, which is what `Accept` exists for | Most complex to implement and document; poor tooling support and discoverability; very few real-world API consumers expect or handle this correctly |

For a payment platform specifically, URI versioning is the pragmatic recommendation, and it's what
essentially every major payments API in the industry actually ships (Stripe, for instance, versions
primarily via a date-based header for finer-grained control, but keeps URIs stable — a hybrid worth
mentioning, but URI versioning remains the simplest, most universally supported default). The
reasoning: it's trivially routable at an API gateway or load balancer without custom header
inspection logic, it's immediately visible in access logs and monitoring dashboards which version a
given caller is on (crucial for planning a deprecation timeline), and merchants integrating against
your API can literally see and pin the version in the URL they wrote down, with zero ambiguity about
what they're calling.

\</details>

### Interview Questions

**Why is returning a JPA entity directly from a `@RestController` considered bad practice, specifically — what actually breaks?** Three concrete failure modes, not just "it's not clean architecture." It leaks internal persistence fields that were never meant to be part of the public API contract, turning routine internal refactors (renaming a column, adding an internal bookkeeping field) into accidental breaking changes for API consumers. It couples your API shape directly to your database schema, removing the independent evolvability that a DTO layer is supposed to provide. And most concretely, lazy-loaded JPA associations accessed during JSON serialization — which happens outside the transactional context where the entity was originally loaded — throw `LazyInitializationException`, or silently serialize as null if you've configured Jackson's Hibernate module to suppress that exception, which is arguably worse because the API silently returns incomplete data instead of failing loudly. A DTO built explicitly inside the service layer, while the transaction is still open, sidesteps all three at once and gives you a stable, intentional public contract.

**Walk through what happens end-to-end when a malformed `CreatePaymentRequest` — say, a negative amount — hits your `POST /api/v1/payments` endpoint.** `DispatcherServlet` routes the request to `PaymentController.createPayment`, and before the method body executes, Spring's argument resolver sees the `@Valid` annotation on the `@RequestBody` parameter and runs Jakarta Bean Validation against the deserialized `CreatePaymentRequest` object. The `@Positive` constraint on `amount` fails, and Spring throws `MethodArgumentNotValidException` — the controller method body never runs, meaning the negative amount never reaches `PaymentService` or touches the database. That exception propagates up to the `@RestControllerAdvice`'s `@ExceptionHandler(MethodArgumentNotValidException.class)` method, which extracts the specific field errors from the `BindingResult`, builds a structured `ApiError` response with a `VALIDATION_FAILED` code and field-level details, and returns it with `400 Bad Request`. The client gets a precise, actionable error telling them exactly which field failed and why, rather than a generic 500 or, worse, a request that silently proceeds with bad data.

**When would you choose `REQUIRES_NEW` propagation over the default `REQUIRED` for a controller-triggered operation — and how does this connect to your REST API design?** This is really a question that spans the controller and transaction boundary. A concrete example: `POST /api/v1/payments/{id}/refund` needs to both process the refund against the gateway and write an audit log entry that must persist even if the refund itself later fails or gets rolled back for an unrelated reason within the same overall request-handling transaction. If the audit write uses the default `REQUIRED` propagation, it joins the same transaction as the refund logic, and a rollback anywhere in that transaction rolls back the audit entry too — which is exactly wrong for an audit trail that's supposed to independently record "a refund was attempted here," regardless of outcome. Marking the audit-write method `@Transactional(propagation = Propagation.REQUIRES_NEW)` forces it into its own independent transaction that commits (or fails) on its own, decoupled from the outer transaction's fate — the API layer doesn't need to know about this, but designing the controller and service methods with an awareness of where transaction boundaries should genuinely be independent is what prevents "the refund failed and the audit trail vanished too" from becoming a real incident.

**How would you design versioning for a payments API to change the shape of a response — say, splitting a single `amount` field into `amount` and `currency` as two fields — without breaking every existing merchant integration overnight?** The core discipline is that you never mutate the response shape of an existing, live API version — `/api/v1/payments` keeps returning exactly what it always returned, forever, or until you formally deprecate and sunset it with advance notice. The new shape ships as `/api/v2/payments`, and both versions run simultaneously behind the same service, typically sharing the same underlying service-layer logic with two separate DTO mapping layers — one producing the v1 shape (perhaps computed by re-deriving a single combined `amount` string from the v2 internal representation), one producing the native v2 shape. You'd instrument both endpoints with usage metrics tagged by API key, giving you real data on which merchants are still on v1, communicate a deprecation timeline to them directly, and only remove the v1 route once traffic against it is verified at zero or those merchants have explicitly migrated — in a regulated payments environment, unilaterally breaking a merchant's integration without notice is a business and possibly contractual problem, not just an engineering one.

**Staff Engineer scenario:** Your team's `PaymentController` currently returns the JPA `Payment` entity directly, and it's "worked fine for two years." A new feature needs to add a `@OneToMany` lazy collection of `RefundAttempt` records to the `Payment` entity for internal reconciliation tooling. The day this ships, the payments API starts intermittently throwing 500s in production, but only for some payments and only sometimes. Diagnose it and fix it properly. The intermittent nature is the key clue: `LazyInitializationException` on the new `refundAttempts` collection only fires when Jackson tries to serialize a `Payment` whose session has already closed by the time serialization happens, and whether that's true depends on subtle factors like which thread pool the request landed in, whether Spring's `OpenSessionInViewFilter` is enabled (masking the problem inconsistently depending on how deep in the call stack the session closes), and possibly caching behavior that means some `Payment` objects still have the collection already initialized from an earlier query in the same transaction while others don't. The quick, wrong fix is enabling `spring.jpa.open-in-view=true` (if it wasn't already) to paper over the symptom by keeping the Hibernate session open through view rendering — this "fixes" the crash but reintroduces N+1 query risk at serialization time and keeps database connections held open for the duration of response serialization, which is a scalability liability under load, not a real fix. The correct fix is exactly the DTO boundary this topic argues for: stop returning `Payment` entities from the controller entirely, introduce a `PaymentResponse` DTO built inside `PaymentService` while still inside the transaction (where accessing lazy collections is safe), and have that DTO expose only the fields the public API contract actually needs — which, notably, is not `refundAttempts` at all, since that's internal reconciliation data that never should have been reachable from the public payments API's serialization path in the first place. This incident is a natural forcing function to retrofit the DTO boundary across the whole controller, not just patch this one field.

\<a id="topic-4">\</a>

## Topic 4 — Spring Data JPA & Transactions

### 30-second answer

Spring Data JPA simplifies persistence, while `@Transactional` defines unit-of-work boundaries through proxies.

### Why interviewers ask this

This catches many real production bugs around lazy loading, transaction boundaries, and consistency.

### Key points

- Transactions are usually proxy-based.
- Self-invocation can bypass transactional behavior.
- Propagation and isolation must match the use case.
- Lazy loading outside a transaction causes failures.
- Optimistic locking protects against lost updates.

### Common traps

- Putting `@Transactional` everywhere.
- Assuming private/self-called methods are transactional.
- Mixing remote calls inside DB transactions.
- Ignoring N+1 queries.

### Senior-level answer

Keep transactions short, explicit, and aligned with business invariants. Use database constraints, locking, and outbox patterns where service-level consistency matters.


\<details>
\<summary>\<strong>Deep dive notes\</strong>\</summary>

Spring Data JPA's repository abstraction removes almost all of the DAO boilerplate that used to
dominate persistence-layer code — no hand-written `EntityManager.createQuery()` calls for the common
cases, no manual `try/finally` around `EntityManager` lifecycle. You declare an interface extending
`JpaRepository\<Payment, UUID>`, and Spring generates a runtime proxy implementation with `save()`,
`findById()`, `findAll()`, `delete()`, and pagination/sorting support already built in, with zero
implementation code from you. Derived query methods extend this further through method name parsing:
`findByCustomerIdAndStatus(UUID customerId, PaymentStatus status)` is parsed at startup into a JPQL
query matching both conditions, purely from the method signature — no annotation, no manual query
string, though this convenience has a real ceiling: derived method names beyond three or four
conditions become unreadable (`findByCustomerIdAndStatusAndCreatedAtBetweenAndMerchantIdIn(...)` is
a real signature you'll see in production codebases, and it's a code smell once you're past two or
three conditions). Past that point, `@Query` with explicit JPQL or native SQL is the better tool —
it's more verbose but far more readable and debuggable, and it's required anyway for anything
involving aggregation, subqueries, or database-specific functions that don't map cleanly to a method
name.

```java
public interface PaymentRepository extends JpaRepository<Payment, UUID> {

    List<Payment> findByCustomerIdAndStatus(UUID customerId, PaymentStatus status);

    @Query("SELECT p FROM Payment p WHERE p.merchant.id = :merchantId AND p.createdAt >= :since")
    List<Payment> findRecentByMerchant(@Param("merchantId") UUID merchantId, @Param("since") Instant since);

    @Query(value = "SELECT * FROM payments WHERE status = 'FAILED' AND retry_count < 3 FOR UPDATE SKIP LOCKED",
           nativeQuery = true)
    List<Payment> findRetryableFailedPayments();
}
```

The N+1 query problem is the single most common performance bug in JPA-based services, and every
senior engineer should be able to explain it precisely, not just name-drop it. Take a `Payment`
entity with `@ManyToOne(fetch = FetchType.LAZY) private Merchant merchant`. Fetching 100 payments
via `paymentRepository.findAll()` issues exactly one query. But if your code then iterates over
those 100 payments and calls `payment.getMerchant().getName()` on each — say, to build a report —
Hibernate lazily fires a separate `SELECT * FROM merchants WHERE id = ?` for every single payment
whose merchant hasn't already been loaded into the persistence context, because lazy loading fetches
on first access, one at a time, with no batching by default. That's 1 query to get the payments plus
100 queries to get their merchants — 101 total where 2 (or even 1) would suffice, and this scales
linearly with result size, meaning it's invisible in a local test with 3 rows of seed data and a
genuine production incident at 10,000 rows under load.

There are three real fixes, each suited to a different situation. `@EntityGraph` lets you declare,
at the repository method level, which associations should be eagerly fetched for that specific query
without changing the entity's default `FetchType` globally (which would affect every other query
using that entity, potentially over-fetching where you didn't need the association at all):

```java
public interface PaymentRepository extends JpaRepository<Payment, UUID> {

    @EntityGraph(attributePaths = {"merchant"})
    List<Payment> findByStatus(PaymentStatus status);
}
```

`JOIN FETCH` in explicit JPQL achieves the same result with more visibility into exactly what SQL
gets generated, which is preferable when the query is already custom:

```java
@Query("SELECT p FROM Payment p JOIN FETCH p.merchant WHERE p.status = :status")
List<Payment> findByStatusWithMerchant(@Param("status") PaymentStatus status);
```

And DTO projections sidestep the problem at its root by never loading the full entity graph in the
first place — if the report only needs the merchant's name, not the full `Merchant` entity, a
projection query selects exactly those columns in a single SQL query with a join, with no entity
hydration overhead and no possibility of a lazy-loading trap because there's no lazy association in
a DTO at all:

```java
public record MerchantPaymentSummary(UUID paymentId, BigDecimal amount, String merchantName) {}

@Query("""
    SELECT new com.paypal.payments.dto.MerchantPaymentSummary(p.id, p.amount, p.merchant.name)
    FROM Payment p WHERE p.status = :status
    """)
List<MerchantPaymentSummary> findSummariesByStatus(@Param("status") PaymentStatus status);
```

| Fix | When to use | Trade-off |
|---|---|---|
| `@EntityGraph` | Need the full entity with one specific association eagerly loaded, for a specific query | Still loads the full entity graph — more data than needed if you only wanted a couple of fields |
| `JOIN FETCH` (JPQL) | Same as above, when you want explicit control over the generated query | Slightly more verbose; risk of duplicate rows in the result if fetching a collection association without `DISTINCT` |
| DTO projection | You only need a subset of fields, especially for reporting/list views | Not a managed entity — no dirty checking, can't be used for updates; requires an explicit constructor-expression query per shape needed |

Pagination via `Pageable`/`Page\<T>` is built into every `JpaRepository` method for free —
`paymentRepository.findByStatus(PaymentStatus.FAILED, PageRequest.of(0, 20,
Sort.by("createdAt").descending()))` returns a `Page\<Payment>` carrying both the page content and
metadata (total elements, total pages). Under the hood this is offset-based pagination — `LIMIT 20
OFFSET 400` for page 20 — and it has a well-known scaling problem: the database still has to scan
and discard the first 400 rows before it can return rows 401–420, so query cost grows with how deep
into the result set you page, not just with the page size. For a merchant dashboard paging through
the first few pages of recent transactions this is invisible, but for a system that needs to page
deep into millions of historical payment records — an export job, a reconciliation sweep — offset
pagination degrades badly and can time out entirely at scale. Keyset (cursor) pagination fixes this
by paging on an indexed column's value rather than a row offset — instead of "skip 400 rows," the
query becomes `WHERE created_at < :lastSeenCreatedAt ORDER BY created_at DESC LIMIT 20`, which uses
the index to jump directly to the right starting point regardless of how deep you are, at the cost
of losing the ability to jump to an arbitrary page number (you can only page forward/backward from a
cursor, not request "page 47" directly) — a trade-off that's almost always worth it for genuinely
large, sequentially-consumed datasets like transaction history exports.

`@Transactional` is where interview conversations separate engineers who've memorized the annotation
from engineers who've actually debugged a broken one in production. Propagation controls how a
transactional method behaves when called from within an already-active transaction. `REQUIRED`, the
default, joins the existing transaction if one is active, or starts a new one if not — this covers
the overwhelming majority of real cases, where you want a natural business operation (say, "process
a payment") to be one atomic unit regardless of how many service methods it internally calls.
`REQUIRES_NEW` always suspends any existing transaction and starts a fresh, independent one — the
audit-log example from Topic 3 is the canonical case: you want the audit write to commit (or fail)
completely independently of whatever transaction is calling it, so a later rollback in the outer
transaction doesn't erase the audit trail. `NESTED` creates a savepoint within the existing
transaction rather than a fully independent one — the outer transaction and the nested one share the
same underlying database transaction and connection, but a rollback inside the nested scope only
rolls back to the savepoint, not the entire outer transaction; a realistic case is attempting
several optional enrichment steps (fraud-score lookup, currency-conversion rate lookup) where a
failure in one shouldn't abort the whole payment, but you still want that step's partial writes
cleanly undone if it does fail. Isolation levels — `READ_COMMITTED` (the typical database default
and usually the right choice), `REPEATABLE_READ`, `SERIALIZABLE` — control what concurrent
transactions can see of each other's uncommitted or concurrently-changing data; for most payment
operations, `READ_COMMITTED` combined with explicit row locking (`SELECT ... FOR UPDATE`, which the
native query example above uses via `FOR UPDATE SKIP LOCKED` for safe concurrent retry-worker
processing) is the pragmatic choice, reserving `SERIALIZABLE` for the rare case where you genuinely
cannot tolerate any concurrent-modification anomaly and are willing to pay its throughput cost.

The self-invocation pitfall is, without exaggeration, one of the most common real Spring bugs in
production codebases, and it's a favorite interview trap precisely because it's invisible until you
understand the mechanism. `@Transactional` works through a Spring-generated proxy wrapping your bean
— when another bean calls `paymentService.processPayment(...)`, it's actually calling the proxy,
which opens a transaction, then delegates to the real method. But if `processPayment()` internally
calls `this.recordAuditEntry(...)` — another `@Transactional` method in the *same class* — that call
goes directly to the real object's method via a plain Java method call, completely bypassing the
proxy, because `this` inside the class refers to the raw object, not the proxy wrapping it. The
transactional advice on `recordAuditEntry` is simply never applied — the method runs, but with no
transaction boundary at all, which is silent: no exception, no warning, just data that isn't
atomically committed the way the annotation implies it should be.

```java
@Service
public class PaymentService {

    @Transactional
    public void processPayment(PaymentRequest request) {
        // ... charge logic ...
        recordAuditEntry(request);   // BUG: bypasses the proxy — runs with NO transaction
    }

    @Transactional
    public void recordAuditEntry(PaymentRequest request) {
        // this method's @Transactional is silently ignored when called via self-invocation above
    }
}
```

The fix is structural, not a workaround: move `recordAuditEntry` into a separate `@Service` bean and
inject it, so the call goes through the container-managed proxy the way every other cross-bean call
does:

```java
@Service
public class PaymentService {

    private final AuditService auditService;

    public PaymentService(AuditService auditService) {
        this.auditService = auditService;
    }

    @Transactional
    public void processPayment(PaymentRequest request) {
        // ... charge logic ...
        auditService.recordAuditEntry(request);   // goes through the proxy correctly
    }
}

@Service
public class AuditService {
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordAuditEntry(PaymentRequest request) {
        // now genuinely transactional, and independently committed per REQUIRES_NEW
    }
}
```

Finally, schema migrations: `spring.jpa.hibernate.ddl-auto=update` is convenient for local
development (it's exactly what the dev profile in Topic 1 uses) but is unequivocally the wrong tool
for production. It infers schema changes from your entity annotations and applies them automatically
at startup, with no review step, no rollback plan, and behavior that has genuinely surprised
experienced teams — Hibernate's inference doesn't always do what you'd expect for column type
changes, renames (which it can't detect at all — a rename looks like "add a new column, leave the
old one," silently losing data continuity), or index management. The standard, production-safe
practice is Flyway or Liquibase: versioned, explicit, hand-reviewed SQL migration scripts, checked
into version control alongside the code, applied in a controlled, ordered, auditable way, with the
schema's evolution history preserved as a literal sequence of files rather than inferred and
reapplied fresh on every deploy.

```sql
-- src/main/resources/db/migration/V12__add_retry_count_to_payments.sql
ALTER TABLE payments
    ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_payments_status_retry_count
    ON payments (status, retry_count)
    WHERE status = 'FAILED';
```

```yaml
spring:
  jpa:
    hibernate:
      ddl-auto: validate   # Hibernate checks the schema matches entities but never modifies it
  flyway:
    enabled: true
    locations: classpath:db/migration
```

With `ddl-auto: validate`, Hibernate becomes a safety net rather than a schema owner — it fails
startup loudly if your entity mappings don't match what Flyway actually applied, catching drift
between code and schema at deploy time rather than at first query in production.

\</details>

### Interview Questions

**Explain the N+1 problem precisely — what makes it "N+1" rather than just "slow"?** It's specifically the shape of the query pattern: one query to fetch the initial collection (the "1"), followed by one additional query per item in that collection to fetch a lazily-associated entity (the "N"), for a total of N+1 round trips where a single well-joined query could have done it in one. It's dangerous specifically because it's invisible at small scale — a unit test with 3 rows of seed data shows 4 queries, which looks completely fine in a query-count assertion or in local manual testing — and only becomes a visible production problem once result set sizes are large enough that the linear query growth actually shows up as measurable latency or database connection pool exhaustion, which is exactly the kind of bug that survives code review and passes CI, and gets caught for the first time by a paging alert.

**When would `@EntityGraph` be the wrong choice compared to a DTO projection, even though both "fix" an N+1 problem?** `@EntityGraph` still loads the complete `Merchant` entity into the persistence context as a managed entity — every column, every other lazy association still lazily deferred but the eagerly-graphed one fully hydrated — which is correct when you genuinely need a managed `Merchant` object, for instance because you're about to modify it and rely on Hibernate's dirty checking to persist the change. If the actual need is read-only, and only the merchant's name is needed for a report or list view, `@EntityGraph` is doing strictly more work than necessary — full entity hydration, first-level cache registration, potential column bloat — for data you're going to discard everything but one field from. A DTO projection query selects exactly the columns needed, in one query, with no entity management overhead, and is the better choice whenever the consuming code is read-only and doesn't need the full entity's behavior.

**Describe the self-invocation problem with `@Transactional` in as much mechanical detail as you can, and explain why it's dangerous specifically because it fails silently.** Spring implements `@Transactional` via AOP proxying — by default, a CGLIB subclass proxy (or a JDK dynamic proxy if the bean implements an interface) wraps the real bean, and the transactional interceptor logic runs in that proxy layer before delegating to the real method. Any call that goes through the proxy — which is what happens when Bean A calls a method on injected Bean B — gets the transactional advice applied. But a call from one method to another method in the same class, via the implicit `this` reference, never goes through the proxy at all, because `this` inside a class body is a reference to the raw, unproxied object; the JVM invokes the method directly, and the AOP layer simply isn't in that call path. It's dangerous because there's no exception, no startup warning, no runtime error — the annotated method executes exactly as written, just without the atomicity guarantee its annotation promises, meaning a multi-step write that should be all-or-nothing can partially fail and leave inconsistent data with zero indication anything went wrong until someone notices the inconsistency downstream, potentially much later and far from the code that caused it.

**Why is `ddl-auto=update` specifically dangerous in production, beyond "it's not best practice" — what's a concrete failure mode?** The most concrete failure is a column or table rename. If you rename a `Payment` entity's field from `merchantId` to `merchantAccountId` and the corresponding `@Column`, Hibernate's schema inference has no way to know this was a rename rather than "remove one column, add an unrelated new one" — because at the SQL level, that's exactly what those look like as independent operations, and Hibernate isn't tracking your git history. On `update`, it adds the new column (empty, all nulls) and leaves the old column in place untouched — it doesn't even drop it, since `update` is additive-only by design as a safety measure, but the net effect is your new column has no data, silently, and nothing in the deploy process flags this as a problem; the application just starts returning nulls for a field that used to be populated, and you find out from a support ticket, not a deploy log. Flyway/Liquibase migrations make this an explicit, reviewed SQL statement — `ALTER TABLE payments RENAME COLUMN merchant_id TO merchant_account_id` — where the rename is stated as what it actually is, reviewed by a human before it ships, and reversible via a paired down-migration if something goes wrong.

**Staff Engineer scenario:** A payments reconciliation batch job pages through 5 million historical transaction records nightly using standard offset-based `Pageable` pagination, and over the last six months the job's runtime has crept from 20 minutes to over 3 hours, occasionally timing out entirely. Diagnose the root cause and propose a fix. The root cause is the fundamental cost profile of offset pagination: `LIMIT 1000 OFFSET N` requires the database to traverse and discard the first N rows before returning the next page, so cost grows with how deep into the dataset you've paged, not just with page size — at offset 4,000,000, the database is doing meaningfully more work per page than it was at offset 10,000, even though the page size never changed. As the total row count has grown over six months (more historical data accumulating), the average offset depth per run has grown too, which is exactly why the runtime crept up gradually rather than failing outright from day one — this is a scaling curve, not a sudden misconfiguration, which is why it's easy to miss until it's a real production problem. The fix is switching the job to keyset pagination on an indexed, monotonically ordered column — `transaction_id` or `created_at` — where each batch queries `WHERE transaction_id > :lastSeenId ORDER BY transaction_id LIMIT 1000` instead of an offset, letting the database use the index to seek directly to the right starting point regardless of how far into the dataset the job has progressed, giving genuinely flat per-page cost throughout the entire 5-million-row run rather than a cost curve that grows with depth. The one real trade-off worth naming to an interviewer: keyset pagination loses the ability to jump to an arbitrary page number, which is irrelevant for a sequential batch job like this reconciliation sweep but would matter for, say, a merchant-facing dashboard that lets users type in a page number — meaning this fix is specifically correct for backend batch processing, not a blanket replacement for `Pageable` everywhere in the codebase.

\<a id="topic-5">\</a>

## Topic 5 — Testing Spring Boot Applications

### 30-second answer

Spring testing ranges from fast unit tests to slice tests and full integration tests. Use the smallest test that proves the behavior.

### Why interviewers ask this

They want confidence strategy, not only knowledge of `@SpringBootTest`.

### Key points

- Unit test domain logic without Spring.
- Use slice tests for MVC/JPA layers.
- Use Testcontainers for real DB/Kafka behavior.
- Mock external systems at boundaries.
- Keep integration tests valuable but not bloated.

### Common traps

- Using `@SpringBootTest` for every test.
- Mocking the thing you need to verify.
- Ignoring transaction behavior in tests.
- Having slow flaky test suites.

### Senior-level answer

Build a test pyramid that protects contracts and risky integrations. For architect roles, discuss where unit, integration, contract, and end-to-end tests each belong.


\<details>
\<summary>\<strong>Deep dive notes\</strong>\</summary>

The testing pyramid isn't an abstract principle in a Spring Boot codebase — it maps directly onto
specific, named testing annotations, each with a real, measurable startup cost, and knowing which
one to reach for is a genuine day-to-day engineering decision, not just interview trivia. At the
base, plain unit tests using Mockito with zero Spring context involved are the fastest tests you can
write — milliseconds each, no application context to start, no classpath scanning, no bean wiring —
and should make up the large majority of your test suite. A `PaymentService` with its dependencies
mocked via `@Mock` and injected via `@InjectMocks` (or manually through its constructor, which,
notably, is trivial specifically because the class uses constructor injection, tying directly back
to Topic 2) lets you test business logic — fee calculation, status transition rules, validation
logic — in complete isolation from Spring, from the database, from HTTP, from everything except the
class under test and its immediate collaborators.

```java
@ExtendWith(MockitoExtension.class)
class PaymentServiceTest {

    @Mock private PaymentGateway paymentGateway;
    @Mock private LedgerClient ledgerClient;
    @Mock private PaymentRepository paymentRepository;

    private PaymentService paymentService;

    @BeforeEach
    void setUp() {
        paymentService = new PaymentService(paymentGateway, ledgerClient, paymentRepository);
    }

    @Test
    void charge_recordsLedgerEntryAfterSuccessfulGatewayCharge() {
        PaymentRequest request = new PaymentRequest(UUID.randomUUID(), BigDecimal.TEN, "USD");
        GatewayResponse response = new GatewayResponse(BigDecimal.TEN, "SUCCESS");
        when(paymentGateway.charge(request)).thenReturn(response);
        when(paymentRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        paymentService.charge(request);

        verify(ledgerClient).recordEntry(request.getAccountId(), BigDecimal.TEN);
    }
}
```

Above the unit layer, Spring Boot provides "slice" tests — test annotations that boot only a narrow,
relevant slice of the application context rather than the whole thing, which is a deliberate middle
ground: more realistic than a pure Mockito unit test, dramatically cheaper than a full context
startup. `@WebMvcTest(PaymentController.class)` boots only the web layer — the controller under
test, Spring MVC infrastructure, `@ControllerAdvice` exception handlers, Jackson serialization —
while `@MockBean`-ing the service layer, so you're verifying HTTP-facing behavior specifically:
status codes, JSON response shape, validation error handling, without a real database anywhere in
the picture.

```java
@WebMvcTest(PaymentController.class)
class PaymentControllerTest {

    @Autowired private MockMvc mockMvc;
    @MockBean private PaymentService paymentService;

    @Test
    void createPayment_returns201WithLocationHeader() throws Exception {
        Payment payment = new Payment(UUID.randomUUID(), /* ... */);
        when(paymentService.createPayment(any())).thenReturn(payment);

        mockMvc.perform(post("/api/v1/payments")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                            {"customerId":"%s","amount":10.00,"currency":"USD","paymentMethodId":"pm_123"}
                            """.formatted(UUID.randomUUID())))
                .andExpect(status().isCreated())
                .andExpect(header().exists("Location"))
                .andExpect(jsonPath("$.status").value("SUCCESS"));
    }

    @Test
    void createPayment_rejectsNegativeAmount() throws Exception {
        mockMvc.perform(post("/api/v1/payments")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                            {"customerId":"%s","amount":-5.00,"currency":"USD","paymentMethodId":"pm_123"}
                            """.formatted(UUID.randomUUID())))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
    }
}
```

`@DataJpaTest` is the analogous slice for the persistence layer — it boots only JPA infrastructure
(entity manager, repositories, an embedded or configured test database) and, by default, wraps each
test in a transaction that's rolled back afterward, giving you fast, isolated repository tests:
verifying that `findByCustomerIdAndStatus` actually returns the right rows given seeded data, or
that a `@Query` you hand-wrote is syntactically correct and returns what you expect, without needing
to boot the web layer or any unrelated service beans at all. `@SpringBootTest` is the top of the
pyramid — it boots the entire application context, every bean, exactly as it would run in production
(optionally with a real embedded web server via `webEnvironment =
SpringBootTest.WebEnvironment.RANDOM_PORT` for genuine end-to-end HTTP tests) — and it should be a
deliberately small fraction of your suite specifically because of the cost: full context startup can
easily take several seconds per test class even in a moderately sized service, and that cost
compounds linearly across a CI pipeline running hundreds of test classes, turning what should be a
fast feedback loop into a ten-minute wait before you know if your change broke anything.

The historically common way to make `@DataJpaTest` "fast" was pairing it with an in-memory H2
database configured to run in a Postgres-compatibility mode, and this is exactly the practice
Testcontainers has largely replaced, for a very concrete reason: H2 emulating Postgres is still H2,
not Postgres, and the gaps between them are real and have burned real teams — Postgres-specific
features like `JSONB` columns, partial indexes, `FOR UPDATE SKIP LOCKED` row-locking semantics used
in the retry-worker query earlier in this document, window functions, or subtle differences in how
each database handles case-sensitivity, date/time precision, or constraint violation error codes. A
query that works perfectly against H2 in your test suite can fail, behave differently, or silently
produce different results against real Postgres in production — "worked in tests, broke in prod" is
close to the canonical failure mode this gap produces, and it's exactly why testing against the real
database engine, not a compatible-ish stand-in, is worth the setup cost. Testcontainers solves this
by spinning up an actual, disposable Postgres (or Kafka, or Redis) instance inside a Docker
container for the duration of the test run — genuinely the same database engine, same version, same
behavior as production, torn down automatically afterward, with zero persistent test-environment
infrastructure to maintain.

```java
@Testcontainers
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
class PaymentRepositoryIntegrationTest {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("payments_test")
            .withUsername("test")
            .withPassword("test");

    @DynamicPropertySource
    static void configureProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
    }

    @Autowired private PaymentRepository paymentRepository;

    @Test
    void findRetryableFailedPayments_respectsRowLockingSemantics() {
        Payment failed = new Payment(/* status = FAILED, retryCount = 1 */);
        paymentRepository.save(failed);

        List<Payment> retryable = paymentRepository.findRetryableFailedPayments();

        assertThat(retryable).extracting(Payment::getId).contains(failed.getId());
    }
}
```

`@AutoConfigureTestDatabase(replace = Replace.NONE)` is the detail that's easy to miss and worth
calling out explicitly: `@DataJpaTest` by default tries to auto-configure an embedded in-memory
database and will silently replace your real `DataSource` configuration with one, which defeats the
entire point of wiring up a real Testcontainers Postgres instance — this annotation tells Spring
Boot "don't do that, use the datasource I've configured," which is exactly the kind of gotcha that
costs a debugging session the first time you hit it and is worth just knowing up front.

```xml
<dependency>
    <groupId>org.testcontainers</groupId>
    <artifactId>postgresql</artifactId>
    <version>1.20.1</version>
    <scope>test</scope>
</dependency>
<dependency>
    <groupId>org.testcontainers</groupId>
    <artifactId>junit-jupiter</artifactId>
    <version>1.20.1</version>
    <scope>test</scope>
</dependency>
```

| Test type | Spring context scope | Real DB/broker? | Typical speed | Where it belongs in the pyramid |
|---|---|---|---|---|
| Plain Mockito unit test | None | No | Milliseconds | Base — majority of tests |
| `@WebMvcTest` | Web layer only, service mocked | No | Tens of ms | Slice — moderate count |
| `@DataJpaTest` (+ Testcontainers) | JPA layer only | Yes (real engine via container) | ~1 second (container reuse amortizes startup) | Slice — moderate count |
| `@SpringBootTest` | Entire application context | Optionally yes | Several seconds+ per class | Top — small, deliberate minority |

The right ratio — heavily weighted toward fast unit tests, a moderate number of slice tests covering
each layer's specific concerns, and a small, deliberate set of full `@SpringBootTest` integration
tests covering genuine end-to-end flows — is exactly what an interviewer is listening for when they
ask about your team's testing approach, because the wrong ratio is a real, common failure mode: a
suite with too many `@SpringBootTest` classes because it feels like the "most correct" option (it
does test everything, after all) produces a CI pipeline that takes twenty minutes to give feedback
on a one-line change, which teams predictably respond to by running tests less often, batching more
changes per CI run, and catching regressions later and more expensively than they should — the
pyramid shape isn't a purity rule, it's what keeps the feedback loop fast enough that people
actually rely on it.

\</details>

### Interview Questions

**Why is `@WebMvcTest` faster than `@SpringBootTest`, mechanically, and what does that speed cost you in terms of what the test actually validates?** `@WebMvcTest` boots a deliberately narrow slice of the Spring context — the specified controller, MVC infrastructure like `HandlerMapping` and message converters, and `@ControllerAdvice` beans — while explicitly excluding full auto-configuration for things like the datasource, JPA, and unrelated service beans, which is why it starts in tens of milliseconds rather than seconds. What that buys you is fast, focused verification of HTTP-facing concerns: status codes, response JSON shape, header presence, validation error formatting. What it costs you is exactly what it excludes — a `@WebMvcTest` with the service layer mocked out via `@MockBean` tells you nothing about whether the service layer's actual logic, or the repository layer beneath it, or the real database interaction, behaves correctly; it's purely testing the controller's contract with its own immediate dependency. That's a deliberate, correct trade-off as long as you also have unit tests covering the service logic and slice or integration tests covering the persistence layer — the gap only becomes a real problem if a team mistakes `@WebMvcTest` coverage for actual end-to-end confidence.

**Why has Testcontainers become the standard over H2-in-Postgres-mode for integration tests, and can you give a concrete example of a query that would behave differently between the two?** H2's Postgres compatibility mode approximates Postgres syntax and behavior but is a different database engine underneath, and the gap shows up exactly where it hurts most: database-specific features. The native query used earlier in this document, `SELECT * FROM payments WHERE status = 'FAILED' AND retry_count < 3 FOR UPDATE SKIP LOCKED`, relies on Postgres's specific row-locking semantics for safe concurrent processing by multiple retry workers — `SKIP LOCKED` behavior, and how it interacts with concurrent transactions, is genuinely Postgres-engine behavior, and testing it against H2 either fails outright if H2 doesn't support the exact syntax, or worse, "passes" against a single-threaded test that never actually exercises the concurrent-locking behavior the feature exists for, giving false confidence. Testcontainers spinning up real `postgres:16-alpine` means the exact same query, index behavior, and locking semantics run in the test as in production — the test is validating actual Postgres behavior, not H2's approximation of it, which is precisely the gap that "worked in tests, broke in prod" bugs live in.

**What is the "correct" ratio between unit tests, slice tests, and full integration tests, and what specifically goes wrong when a team inverts it?** There's no single universal number, but the shape is what matters: a large base of fast unit tests (the majority, often 70%+ of test count), a meaningfully smaller set of slice tests (`@WebMvcTest`, `@DataJpaTest`) covering layer-specific concerns, and a small, deliberately curated set of full `@SpringBootTest` integration tests covering genuine critical end-to-end paths — the "buy a payment, refund it, check the ledger" kind of test that's worth the cost specifically because it validates real cross-layer interaction that no slice test can. When a team inverts this — writing mostly `@SpringBootTest` because it "actually tests the real thing" — the CI pipeline slows down proportionally to full-context-startup cost times test count, which is often minutes rather than seconds; teams under that pressure predictably start skipping test runs locally, batching larger changesets before running CI, and both practices push defect discovery later and more expensively than a fast, well-shaped pyramid would have caught it at.

**How would you test the retry-worker query using `FOR UPDATE SKIP LOCKED` to make sure it actually prevents two concurrent workers from picking up the same failed payment?** This needs more than a single-threaded `@DataJpaTest` call — a single thread calling the repository method twice sequentially will trivially "pass" without ever exercising the concurrent-locking behavior the query exists for. A real test spins up two concurrent transactions against the same Testcontainers Postgres instance — practically, using two separate `EntityManager`/transaction contexts driven from two threads or via `CompletableFuture`, both calling `findRetryableFailedPayments()` against a dataset with a single eligible row, with the first transaction intentionally not yet committed when the second one runs its query. The assertion is that the second transaction's result excludes the row the first transaction has locked — demonstrating `SKIP LOCKED` actually skipped it rather than blocking or double-returning it. This is exactly the kind of test that's expensive to write and slow to run, which is precisely why it belongs as one deliberately placed, high-value integration test rather than something you'd write for every repository method — a good instinct for a staff engineer to signal is exactly this kind of calibration: not "test everything with real concurrency," but "identify the small number of genuinely concurrency-sensitive code paths and give those the expensive test they specifically need."

**Staff Engineer scenario:** Your team's CI pipeline takes 22 minutes to run the test suite, and a survey shows engineers are increasingly skipping local test runs before pushing, relying on CI to catch problems — which means failures are discovered later, cost more to trace back to a specific change, and slow the whole team down. You're asked to fix this without just deleting test coverage. What's your diagnostic approach and likely fix? First, actually measure the distribution rather than guessing — instrument the test run to report per-class or per-tag timing, and in the overwhelming majority of cases like this, the finding is that a small number of `@SpringBootTest` classes account for a disproportionate share of total runtime, because each one pays full context-startup cost independently, and if there isn't context caching working correctly (Spring's `TestContext` framework caches contexts across test classes that share identical configuration, but subtly different `@ActiveProfiles`, `@MockBean` sets, or `@DynamicPropertySource` usage between test classes silently defeats that cache and forces a fresh context per class), you can end up paying that startup cost far more times than necessary. The fix has two independent tracks: first, audit which `@SpringBootTest` classes could be rewritten as `@WebMvcTest` or `@DataJpaTest` slices instead — many full-context tests exist not because they need the whole context, but because that's what someone reached for by default, and converting them recovers most of the speed without losing meaningful coverage; second, for the tests that genuinely need full-context or Testcontainers-backed integration coverage, audit and standardize their configuration so they share identical context configuration and actually benefit from Spring's context caching, and enable Testcontainers' container reuse (`testcontainers.reuse.enable=true`) so the same Postgres container serves multiple test classes instead of a fresh container per class. The size of the fix should roughly match the size of the imbalance — if profiling shows five test classes account for 15 of the 22 minutes, that's exactly where the effort goes, not a blanket rewrite of the whole suite.

---

\<a id="topic-6">\</a>

## Topic 6 — Service Discovery (Eureka / Consul)

### 30-second answer

Service discovery lets clients find service instances dynamically. In Kubernetes, native Service DNS often replaces older Eureka-style discovery.

### Why interviewers ask this

They check platform judgment during modernization and migration.

### Key points

- Eureka uses registry and heartbeats.
- Consul can provide discovery and KV/config features.
- Kubernetes Services provide stable virtual endpoints.
- Readiness probes should control traffic eligibility.
- Avoid multiple competing discovery sources.

### Common traps

- Carrying Eureka into Kubernetes by default.
- Ignoring stale registry entries during deployments.
- Confusing liveness and readiness.
- Letting clients cache dead endpoints too long.

### Senior-level answer

Choose discovery based on runtime platform. In Kubernetes-first systems, prefer platform-native discovery unless there is a specific cross-platform requirement.


\<details>
\<summary>\<strong>Deep dive notes\</strong>\</summary>

In a monolith, calling "the payments module" is a Java method call — the compiler and the
classloader guarantee the callee exists. The moment you split `payment-service`, `notification-
service`, and `merchant-service` into independently deployed processes running on an orchestrator
like Kubernetes or ECS, that guarantee evaporates. Instances scale out under load, get rescheduled
after a node drains, restart after a crash, and get new IP addresses every time any of that happens.
If `notification-service` has `payment-service`'s IP hardcoded in an `application.yml` — or even in
an environment variable injected at deploy time — that config is stale the moment the orchestrator
reschedules a pod. You'd need to redeploy every consumer of `payment-service` every time `payment-
service` itself redeploys, which defeats the entire point of decomposing the system in the first
place: independent deployability. Service discovery exists to answer one dynamic question at call
time — "where are the current healthy instances of payment-service?" — without a human or a deploy
pipeline having to update config by hand.

Netflix Eureka, part of Spring Cloud Netflix, solves this with a registry-and-heartbeat model. Every
service instance, on startup, registers itself with the Eureka server, sending its hostname, IP,
port, and a handful of metadata fields (status page URL, health-check URL, application name). After
registration, each instance sends a heartbeat to the Eureka server — by default every 30 seconds —
to prove it's still alive. If the Eureka server doesn't receive a heartbeat from an instance within
a configurable lease-expiration window (default 90 seconds), it evicts that instance from the
registry. Critically, Eureka clients don't hit the Eureka server on every single service-to-service
call — that would make Eureka a single point of failure and a latency bottleneck for every request
in the system. Instead, each client pulls a full copy of the registry on startup and refreshes it on
a fixed interval (default every 30 seconds), caching it locally. When `notification-service` needs
to call `payment-service`, it resolves the instance list from its own local cache, not from a live
network call to Eureka. This means a Eureka server outage doesn't immediately break service-to-
service calls throughout the fleet — every client is still working off a recent cached view of who's
alive, and can keep making calls for as long as that cache stays reasonably fresh.

This client-side caching interacts with a feature called **self-preservation mode**, which is one of
the more interview-relevant and least understood parts of Eureka. Under normal network conditions,
Eureka expects to receive heartbeats from a predictable fraction of registered instances. If a large
chunk of instances suddenly stop sending heartbeats, Eureka has to distinguish between two very
different scenarios: either a lot of instances genuinely died at once, or the Eureka server itself
is experiencing a network partition and simply isn't receiving heartbeats that are still being sent.
Evicting every instance in the latter scenario would be catastrophic — you'd wipe the registry clean
during a transient network blip, and every client refreshing its cache afterward would see an empty
or near-empty registry for `payment-service`, effectively causing a fleet-wide outage triggered by a
monitoring false positive. Self-preservation mode protects against this: when the rate of renewals
(heartbeats) drops below a threshold (by default 85% of the expected rate), Eureka stops expiring
instances and keeps serving the last known-good registry, on the theory that it's better to serve
slightly stale data than to falsely believe the entire fleet died. The trade-off, and the thing
interviewers push on, is that self-preservation mode means Eureka will keep telling clients about
instances that are actually dead during a real, large-scale outage — trading correctness for
availability, which is a defensible choice for a discovery layer whose job is to keep the system
limping along rather than freeze it.

Consul, from HashiCorp, takes a different mechanical approach to the same problem. Where Eureka is
heartbeat/lease-based (the instance proves it's alive by pinging the server), Consul is primarily
health-check-based: you configure Consul with an active check against each service instance —
commonly an HTTP GET against a health endpoint, a TCP connect check, or a script check — and Consul
itself polls that check on an interval and deregisters the instance if the check starts failing.
This is a meaningfully different failure model: Eureka answers "did this instance say it's alive
recently," while Consul answers "did I just verify this instance is actually responding correctly."
Consul additionally functions as a general-purpose service mesh control plane and distributed KV
store, which is why it often shows up in polyglot shops that don't want a Java-specific discovery
mechanism, whereas Eureka is deeply idiomatic to the Spring Cloud / JVM ecosystem via `spring-cloud-
starter-netflix-eureka-client`.

Here's the honest, interview-critical point that a lot of candidates miss: **if you're running on
Kubernetes, you frequently don't need Eureka at all.** Kubernetes ships its own built-in service
discovery — a `Service` object gets a stable virtual IP and a DNS name (`payment-
service.default.svc.cluster.local`), and `kube-proxy` (or the CNI's equivalent) handles routing
traffic to healthy pod endpoints, using the kubelet's own liveness/readiness probes to decide what's
healthy. That's registration, health checking, and load-balanced resolution — the exact same problem
Eureka solves — already provided by the platform, for free, without an extra JVM process to run and
monitor. Bolting Eureka on top of Kubernetes is redundant work in the common case and can introduce
a second, occasionally inconsistent source of truth about which instances are healthy (a pod can be
"up" from Eureka's perspective via a heartbeat while Kubernetes has already marked it not-ready and
pulled it from Service endpoints). Eureka earns its keep in non-Kubernetes deployments — VMs, bare
EC2 instances, on-prem — or in hybrid environments, or where you specifically need Netflix-OSS-style
client-side load-balancing metadata (zone awareness, instance status pages) that plain Kubernetes
DNS doesn't give you. A senior engineer should be able to say, without prompting, "we run on K8s, so
we lean on Service/DNS discovery and don't run a Eureka server" — and know precisely why that's the
right default, not just parrot "Eureka is what Spring microservices use."

**Worked example — `payment-service` registering, `notification-service` looking it up:**

```yaml
# payment-service application.yml
spring:
  application:
    name: payment-service

eureka:
  client:
    service-url:
      defaultZone: http://eureka-server:8761/eureka/
    register-with-eureka: true
    fetch-registry: true
  instance:
    prefer-ip-address: true
    lease-renewal-interval-in-seconds: 30
    lease-expiration-duration-in-seconds: 90
```

```java
@SpringBootApplication
@EnableDiscoveryClient
public class PaymentServiceApplication {
    public static void main(String[] args) {
        SpringApplication.run(PaymentServiceApplication.class, args);
    }
}
```

`notification-service` looks up `payment-service` through the Eureka-aware, load-balanced
`DiscoveryClient` rather than a hardcoded URL:

```java
@Service
public class PaymentStatusClient {

    private final DiscoveryClient discoveryClient;
    private final RestTemplate restTemplate;

    public PaymentStatusClient(DiscoveryClient discoveryClient, RestTemplate restTemplate) {
        this.discoveryClient = discoveryClient;
        this.restTemplate = restTemplate;
    }

    public PaymentStatus fetchStatus(String paymentId) {
        List<ServiceInstance> instances = discoveryClient.getInstances("payment-service");
        if (instances.isEmpty()) {
            throw new IllegalStateException("No healthy payment-service instances registered");
        }
        ServiceInstance instance = instances.get(0); // in practice, delegate to Spring Cloud LoadBalancer
        String url = instance.getUri() + "/api/payments/" + paymentId + "/status";
        return restTemplate.getForObject(url, PaymentStatus.class);
    }
}
```

In practice you'd never manually round-robin like `instances.get(0)` — you'd let `@LoadBalanced
RestTemplate` or a Feign client (Topic 9) resolve `http://payment-service/...` transparently, with
Spring Cloud LoadBalancer doing instance selection behind the scenes using the same Eureka-backed
registry.

\</details>

### Interview Questions

**Why doesn't a Eureka client hit the Eureka server on every outbound call, and what does that design trade off?** Eureka clients cache the registry locally and refresh it periodically (every 30 seconds by default) instead of querying the server per-call, because a discovery lookup is on the hot path of every inter-service request in the system — routing that through a central server would make Eureka both a latency tax and a single point of failure. The trade-off is staleness: a client can keep routing traffic to an instance that died in the last refresh window, or fail to route to a brand-new instance until its next cache refresh picks it up. This is why discovery-based routing is paired with client-side retries and circuit breakers (Topic 10) rather than relied on alone for correctness — discovery gets you close to the truth quickly, not exactly the truth instantaneously.

**What is Eureka self-preservation mode, and why would you ever want a registry to intentionally serve stale data?** Self-preservation triggers when the renewal (heartbeat) rate from registered instances drops sharply — below roughly 85% of the expected rate — which is ambiguous evidence: it could mean mass instance death, or it could mean the Eureka server is network-partitioned and simply isn't receiving heartbeats that are still being sent fine. Rather than guess wrong and evict a healthy fleet during a network blip, Eureka freezes the registry and keeps serving its last known state. The trade-off is that during a genuine large-scale outage, self-preservation mode will keep advertising dead instances for longer than you'd like — which is why it's tunable and why production Eureka deployments monitor renewal thresholds explicitly rather than trusting the default blindly.

**On Kubernetes, do you still need Eureka? Justify your answer.** Generally no. Kubernetes' own `Service` abstraction plus cluster DNS already provides registration (pods behind a Service are automatically tracked), health-based membership (via readiness probes removing not-ready pods from Service endpoints), and resolution (a stable DNS name resolves to healthy pod IPs, load-balanced by kube-proxy). Running Eureka on top duplicates that mechanism with a separate JVM process, a separate heartbeat protocol, and a second source of truth about instance health that can disagree with Kubernetes' own view — for instance, a pod Kubernetes has already deemed not-ready via a failing readiness probe might still be within its Eureka lease window and get advertised as healthy. Eureka remains justified off Kubernetes — VMs, bare-metal, hybrid-cloud — or where you need Netflix-OSS-specific metadata like zone-aware routing that plain K8s DNS doesn't carry.

**Consul does health checking differently from Eureka — walk through the practical difference.** Eureka is passive from the server's perspective: instances push heartbeats, and the server infers liveness from their presence or absence. Consul is active: you register a check (HTTP endpoint, TCP connect, script, TTL) and Consul itself polls or waits on that check, deregistering the instance the moment the check fails or times out. The practical implication is fidelity — Consul's model can catch "the process is running but the health endpoint returns 500" in a way a bare heartbeat can't, since a heartbeat only proves the process's Eureka client thread is alive, not that the service is actually serving correctly. The cost is that Consul's active checks put continuous polling load on every registered service, whereas Eureka's heartbeat is a push the client controls.

**Staff Engineer scenario:** Your team runs `payment-service` on Kubernetes with Eureka layered on top, inherited from an earlier EC2-based deployment that was lifted-and-shifted. During a rolling deployment, `notification-service` starts throwing intermittent connection-refused errors against `payment-service` instances that Kubernetes has already terminated. Walk through the root cause and the fix. The root cause is exactly the dual-source-of-truth problem: Kubernetes terminates a pod (SIGTERM, connection draining, removal from Service endpoints) faster than that pod's Eureka lease expires and gets evicted from the Eureka registry, so `notification-service`'s Eureka-cached instance list still contains an IP that Kubernetes has already stopped routing to — the pod may even be fully gone by the time the client tries it, hence connection-refused rather than a timeout. There are two fixes, and a staff-level answer names both and picks one deliberately: first, tighten Eureka's lease-renewal and eviction intervals and make sure `payment-service` calls `DiscoveryClient` deregistration (or relies on the shutdown hook Spring Cloud Netflix wires up) on graceful shutdown so it actively deregisters instead of waiting out its lease; second, and the one a staff engineer should actually push for, drop Eureka for this deployment entirely and route `notification-service → payment-service` through Kubernetes Service DNS, since Kubernetes' own readiness-probe-driven endpoint removal is already faster and more accurate than Eureka's heartbeat lease for exactly this failure mode. The deeper lesson to surface in the postmortem: discovery mechanisms inherited from a pre-Kubernetes architecture should be revisited during a platform migration, not carried forward by default.

---

\<a id="topic-7">\</a>

## Topic 7 — API Gateway with Spring Cloud Gateway

### 30-second answer

An API gateway centralizes cross-cutting edge concerns such as routing, auth, rate limiting, TLS termination, and request shaping.

### Why interviewers ask this

They want to know whether you can place responsibilities correctly at the edge.

### Key points

- Gateway is not a business-logic dumping ground.
- Filters handle cross-cutting concerns.
- Rate limiting and auth can be enforced centrally.
- Route config must be observable and safe to change.
- Gateway failures affect the whole system.

### Common traps

- Putting domain orchestration into the gateway.
- Making gateway a single bottleneck.
- Ignoring per-route timeout/retry behavior.
- Not propagating correlation IDs.

### Senior-level answer

Use the gateway for edge policy and routing, while keeping business workflows in services. Design it as critical infrastructure with HA, observability, and conservative changes.


\<details>
\<summary>\<strong>Deep dive notes\</strong>\</summary>

Once you have a dozen or more microservices, every one of them independently needs authentication,
TLS termination, rate limiting, request/response logging, and often response shaping for external
consumers. Reimplementing that in each service is not just duplicated code — it's duplicated *risk*:
a rate-limiting bug fixed in `payment-service` but forgotten in `merchant-service` is a real
production incident waiting to happen, and an auth check implemented slightly differently in two
services is exactly the kind of inconsistency that becomes a security finding in a PCI audit. An API
Gateway centralizes these cross-cutting concerns into a single, well-tested chokepoint that every
external request passes through before it ever reaches a downstream service. It also decouples the
shape of your public API from your internal service topology: clients call
`api.yourcompany.com/api/payments/{id}`, and the gateway is free to route that to whatever `payment-
service` instance, on whatever internal path, is currently serving that traffic — you can split,
merge, or rename backend services without breaking a single external contract, as long as the
gateway's routing rules are updated to match.

Spring Cloud Gateway is built around three concepts: **routes**, **predicates**, and **filters**. A
route is the unit of configuration — a path or host pattern paired with a destination URI. A
predicate is the condition that decides whether an incoming request matches that route (path
pattern, header value, HTTP method, and so on — predicates compose with AND semantics). A filter is
something that runs on the request on its way in, the response on its way out, or both, and is where
cross-cutting policy actually gets applied — adding headers, stripping headers, rewriting paths,
applying rate limits, tripping circuit breakers. This maps naturally onto YAML configuration, which
is how most Spring Cloud Gateway deployments are actually run in production, since it lets ops teams
change routing without a code deploy.

```yaml
spring:
  cloud:
    gateway:
      routes:
        - id: payment-service-route
          uri: lb://payment-service
          predicates:
            - Path=/api/payments/**
          filters:
            - AddRequestHeader=X-Gateway-Source, api-gateway
            - name: RequestRateLimiter
              args:
                redis-rate-limiter.replenishRate: 50
                redis-rate-limiter.burstCapacity: 100
                key-resolver: "#{@userKeyResolver}"
            - name: CircuitBreaker
              args:
                name: paymentServiceCB
                fallbackUri: forward:/fallback/payments

        - id: merchant-service-route
          uri: lb://merchant-service
          predicates:
            - Path=/api/merchants/**
          filters:
            - AddRequestHeader=X-Gateway-Source, api-gateway
```

The `lb://payment-service` scheme is Spring Cloud Gateway integrating directly with service
discovery (Topic 6) and Spring Cloud LoadBalancer — the gateway resolves the logical name `payment-
service` to a live instance at request time rather than pointing at a fixed host. A correlation ID
filter, which every request in a payments system should carry end to end for tracing and log
correlation, is naturally implemented as a global filter so you don't have to remember to add it per
route:

```java
@Component
public class CorrelationIdFilter implements GlobalFilter, Ordered {

    private static final String CORRELATION_ID_HEADER = "X-Correlation-Id";

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String correlationId = exchange.getRequest().getHeaders().getFirst(CORRELATION_ID_HEADER);
        if (correlationId == null) {
            correlationId = UUID.randomUUID().toString();
        }
        String finalId = correlationId;
        ServerWebExchange mutatedExchange = exchange.mutate()
                .request(r -> r.header(CORRELATION_ID_HEADER, finalId))
                .build();
        return chain.filter(mutatedExchange)
                .then(Mono.fromRunnable(() ->
                        mutatedExchange.getResponse().getHeaders().add(CORRELATION_ID_HEADER, finalId)));
    }

    @Override
    public int getOrder() {
        return Ordered.HIGHEST_PRECEDENCE;
    }
}
```

An interviewer who's watched a candidate study L4/L7 networking and reverse-proxy fundamentals will
often probe: "isn't this just a load balancer?" It isn't, and the distinction is worth stating
precisely. A plain load balancer — an L4 device, or even a basic L7 reverse proxy like a bare Nginx
config — distributes traffic across backend instances based on connection or simple HTTP-level
rules; it doesn't know or care about the semantic content of the request beyond routing keys. An API
Gateway is content-aware and policy-aware: it inspects the request enough to apply authentication,
transform the body or headers, aggregate calls to multiple backends into one response for a client,
enforce per-client rate limits, and make routing decisions based on business-meaningful attributes
(a header claiming a client tier, a JWT claim, an API version in the path). The gateway sits at a
higher semantic layer than a load balancer, and in most real architectures it *uses* a load balancer
(or client-side load-balancing via service discovery, as above) internally as part of getting a
request to a healthy backend instance — the two aren't competitors, the gateway is doing more work
on top.

Rate limiting and circuit breaking at the gateway are a first line of defense specifically because
they're cheap to apply before a request has consumed any downstream resources. If `payment-service`
is degraded and its own internal circuit breaker (Topic 10) is tripping, you still want the gateway
itself to stop forwarding new requests to it — otherwise every one of those requests pays the cost
of a connection attempt, a timeout, and a failed call, multiplied across every client hitting the
gateway, before the client-side circuit breaker inside the gateway (or worse, no protection at all
if the gateway blindly forwards) kicks in. Gateway-level rate limiting similarly protects the whole
downstream fleet from a single noisy or malicious client before that traffic ever fans out.

The **Backend-for-Frontend (BFF)** pattern is a variant worth naming even briefly: instead of one
gateway serving every client type identically, you run a dedicated gateway per client type — a
mobile BFF and a web BFF, say — each shaped around what that specific client actually needs. A
mobile client on a metered connection wants a slimmed-down, aggregated payload (one call that
already joins payment status, merchant name, and loyalty points, because round-trips are expensive
on mobile networks); a web client backing a rich admin dashboard might want more granular, paginated
endpoints it can call independently. Rather than cramming both shapes into one generic gateway API
with conditional logic, a BFF gives each frontend team ownership of an API tailored to their client,
while both BFFs still route into the same set of backend microservices.

| Concern | Plain Load Balancer / Reverse Proxy | API Gateway (Spring Cloud Gateway) |
|---|---|---|
| Primary job | Distribute connections/requests across instances | Route, secure, and shape traffic based on request content |
| Layer of awareness | L4 (connection) or basic L7 (host/path) | Full L7 — headers, body, JWT claims, business rules |
| Cross-cutting policy (auth, rate limit) | Not typically — needs a separate layer | Built-in, centralized |
| Response aggregation/transformation | No | Yes (composing multiple backend calls, reshaping payloads) |
| Awareness of service discovery | Sometimes (via config) | Native (`lb://service-name` resolution) |
| Where it sits | Often in front of, or as part of, the gateway itself | In front of the microservice fleet, behind DNS/CDN |

\</details>

### Interview Questions

**What specific problem does an API Gateway solve that individual services calling each other directly doesn't?** Without a gateway, every service that's externally exposed has to independently implement authentication, rate limiting, TLS termination, and logging, and every external client has to know the internal topology of the system to call the right service directly. A gateway centralizes those cross-cutting concerns into one enforced chokepoint — fixed once, applied everywhere — and decouples the external API contract from internal service boundaries, so you can refactor, split, or merge backend services without breaking external clients as long as the gateway's routes are updated accordingly. It's the same "don't repeat yourself" argument applied at the infrastructure layer instead of the code layer.

**How does Spring Cloud Gateway know which live instance of `payment-service` to route a request to?** Through the `lb://payment-service` URI scheme, which tells Spring Cloud Gateway to resolve the logical service name via Spring Cloud LoadBalancer instead of treating it as a literal host. LoadBalancer, in turn, asks the configured discovery client (Eureka, Consul, or Kubernetes' own service registry) for the current set of healthy instances and applies a load-balancing strategy — round-robin by default — to pick one. This is what lets the gateway config stay static (`lb://payment-service`) while the actual set of backing instances scales up and down freely underneath it.

**Why put rate limiting at the gateway instead of, or in addition to, inside each service?** Gateway-level rate limiting rejects excess traffic before it costs the downstream fleet anything — no thread, no connection, no database call is spent on a request that never should have been let through. Rate limiting purely inside each service still lets that traffic consume network and connection-handling resources on the way in, and it means every service has to implement and tune its own limiter correctly. In practice, most payments platforms do both: coarse-grained, per-client or per-API-key limits at the gateway to protect the whole fleet, and finer-grained, business-aware limits inside individual services (e.g., a per-merchant transaction velocity check inside `payment-service` that the gateway has no visibility into).

**When would you introduce a Backend-for-Frontend instead of one shared gateway?** When different client types have meaningfully divergent needs from the same backend services — not just cosmetic differences, but structurally different call patterns, like a mobile client needing aggressively aggregated, low-round-trip payloads versus a web dashboard needing fine-grained, independently paginated endpoints. A single shared gateway serving both tends to accumulate client-specific conditional logic and version branching that makes it hard for either team to move independently. The trade-off is operational: a BFF per client type means more gateway deployments to run, secure, and keep consistent on shared policy like auth, so it's worth it only once the divergence in client needs is real and ongoing, not for a single one-off endpoint difference.

**Staff Engineer scenario:** `payment-service` starts timing out under a traffic spike, and instead of failing fast, requests pile up at the gateway, which itself starts running out of connections and takes `merchant-service`'s (otherwise-healthy) traffic down with it, since both are routed through the same gateway instance pool. What went wrong, and what would you change? The failure mode is a shared-fate problem: the gateway had no isolation between routes, so a slow downstream (`payment-service`) exhausted a shared resource pool (connections, threads, or reactive scheduler capacity depending on the gateway's runtime) that `merchant-service`'s otherwise-unrelated traffic also depended on. The fix has two layers. First, apply a per-route circuit breaker (as in the YAML example, `CircuitBreaker` filter with a `fallbackUri`) so that once `payment-service`'s failure/timeout rate crosses a threshold, the gateway stops forwarding to it and returns a fast, cheap fallback response instead of holding a connection open for the full timeout window — this is exactly what stops one bad route from starving the shared pool. Second, and more architecturally, evaluate whether resource isolation between routes (bulkheading, in Resilience4j terms — Topic 10) is configured per-route rather than shared globally, so `payment-service`'s degradation has a hard ceiling on how many gateway resources it can consume, leaving headroom for `merchant-service` traffic to keep flowing. The broader lesson for a staff-level postmortem: a gateway is itself a single point of shared fate across all the services behind it unless you deliberately design isolation into it — it doesn't get resilience for free just by existing.

---

\<a id="topic-8">\</a>

## Topic 8 — Centralized Configuration with Spring Cloud Config

### 30-second answer

Centralized config manages environment-specific settings outside the build artifact and can support controlled refresh.

### Why interviewers ask this

They check operational maturity: config drift, secrets, rollback, and runtime changes.

### Key points

- Config should be versioned.
- Secrets should use a secrets manager, not plain config.
- Refresh must be controlled and observable.
- Defaults and overrides need clear precedence.
- Bad config can cause fleet-wide incidents.

### Common traps

- Storing secrets in Git.
- Changing config without audit/rollback.
- Assuming dynamic refresh is always safe.
- Letting every service invent config conventions.

### Senior-level answer

Treat configuration as production code: versioned, reviewed, auditable, and rollbackable. Separate ordinary config from secrets and avoid uncontrolled fleet-wide refreshes.


\<details>
\<summary>\<strong>Deep dive notes\</strong>\</summary>

A payments platform with thirty microservices, each with its own `application.yml`, has thirty
places where a rate-limit threshold, a feature flag, a third-party API base URL, or a fraud-check
timeout can live — and thirty places you'd have to touch, and thirty services you'd have to
redeploy, to change one of them consistently. Worse, in a regulated environment, "who changed the
daily transaction limit for merchant tier 2, and when" needs to be an answerable question, not
something reconstructed by grepping deployment logs across a dozen repos. Spring Cloud Config Server
solves this by externalizing configuration into a single service, backed — in the standard and
strongly recommended pattern — by a Git repository. Config becomes config-as-code: every change is a
commit, with an author, a timestamp, a diff, and a PR review trail if you wire branch protection on
the config repo the same way you would on application code. For an auditor asking about change
control on production financial parameters, "here's the Git history of the config repo, here's the
PR approval on this specific commit" is a far stronger answer than "someone SSH'd in and edited a
properties file."

```yaml
# config-server application.yml
server:
  port: 8888

spring:
  application:
    name: config-server
  cloud:
    config:
      server:
        git:
          uri: https://github.com/yourorg/payments-config-repo.git
          default-label: main
          search-paths: '{application}'
          clone-on-start: true
```

```java
@SpringBootApplication
@EnableConfigServer
public class ConfigServerApplication {
    public static void main(String[] args) {
        SpringApplication.run(ConfigServerApplication.class, args);
    }
}
```

The Git repo is laid out per-application (and optionally per-profile), e.g. `payment-service.yml`,
`payment-service-prod.yml`, `notification-service.yml`, with the Config Server resolving and merging
the right files based on the requesting client's `spring.application.name` and active profile. On
the client side, modern Spring Boot (2.4+) pulls this config at startup via the
`spring.config.import` property, which supersedes the older `bootstrap.yml`-based mechanism:

```properties
# payment-service application.properties (or bootstrap)
spring.application.name=payment-service
spring.config.import=configserver:http://config-server:8888
spring.cloud.config.fail-fast=true
spring.cloud.config.retry.max-attempts=6
```

`fail-fast=true` combined with retry settings is a deliberate choice worth calling out: on startup,
if the Config Server is unreachable, do you want `payment-service` to start anyway with whatever
local defaults it has baked in, or refuse to start at all? For most values that's a judgment call,
but for something like a fraud-check timeout or a transaction limit, starting with a stale or
default value silently is far more dangerous in a payments context than failing the health check and
blocking the rollout — so `fail-fast` plus a bounded retry is the common production choice: try hard
to get real config, and if you genuinely can't, don't come up in an unknown state.

Externalized config alone only solves half the operational problem — the other half is picking up a
*change* to config without redeploying. A plain `@Value`-injected field is read once at bean
construction and frozen for the life of that bean; changing the underlying config source doesn't
touch it. `@RefreshScope` solves this specifically: it marks a bean as one Spring should throw away
and recreate — re-reading its `@Value` and `@ConfigurationProperties` bindings from scratch — when a
refresh event fires, rather than one Spring should mutate in place.

```java
@RefreshScope
@Component
public class RateLimitProperties {

    @Value("${payment.rate-limit.requests-per-second:100}")
    private int requestsPerSecond;

    public int getRequestsPerSecond() {
        return requestsPerSecond;
    }
}
```

Hitting `POST /actuator/refresh` on a single instance re-creates that bean on that one instance,
picking up whatever the Config Server now returns for `payment.rate-limit.requests-per-second`.
That's fine for a demo or a single-instance dev environment, and it's genuinely how a lot of people
first learn the mechanism — but it doesn't scale operationally: curling `/actuator/refresh` on every
one of forty running `payment-service` pods, one at a time, by hand or via a script, is exactly the
kind of manual, error-prone, easy-to-half-do operation you were trying to eliminate by centralizing
config in the first place. The realistic production pattern is **Spring Cloud Bus**, which wires
every service instance to a shared message broker (Kafka or RabbitMQ) and broadcasts a
`RefreshRemoteApplicationEvent` to the whole fleet with one call:

```properties
spring.cloud.bus.enabled=true
spring.cloud.stream.kafka.binder.brokers=kafka-broker:9092
```

```bash
# hitting one instance's bus endpoint refreshes the whole fleet listening on the bus
curl -X POST http://payment-service-1:8080/actuator/busrefresh
```

Every instance subscribed to the bus topic picks up the event and refreshes its own `@RefreshScope`
beans locally — one API call, fleet-wide propagation, no per-pod scripting.

Be precise about what this mechanism does and doesn't give you, because this is exactly where
interviewers probe for depth. `@RefreshScope` refreshes *bean state* — the values bound into
`@Value` or `@ConfigurationProperties` fields on beans marked with the annotation. It does not re-
run arbitrary code paths, doesn't retroactively change decisions already made for in-flight
requests, and doesn't help at all for state that was captured into a local variable, a constant, or
baked into a non-refresh-scoped singleton at startup — that state is simply stale until the process
restarts. More importantly, this pattern is not a substitute for a real feature-flag system. Config
Server and `@RefreshScope` are good at "externalize this environment-level setting and let it change
without a redeploy" — a timeout, a rate limit, a base URL, a boolean toggle applied uniformly to
every instance. They are the wrong tool for "roll this feature out to 5% of merchants, expand to 25%
over the next hour, and let me kill it instantly if error rates spike for that cohort" — that's per-
request, per-user, percentage-based, often A/B-test-integrated targeting, which is what dedicated
feature-flag platforms (LaunchDarkly, Unleash, and similar) are actually built for, with SDKs
designed for millisecond-latency per-request flag evaluation rather than a fleet-wide config
refresh. A staff-level answer keeps these two tools clearly separated rather than trying to stretch
Config Server into being a flagging system because it's already there.

\</details>

### Interview Questions

**Why back Spring Cloud Config Server with Git specifically, rather than a database or a plain shared filesystem?** Git gives you versioning, a diff-based audit trail, and a review workflow (pull requests, branch protection, required approvals) essentially for free, which matters enormously in a regulated environment where you need to answer "who changed this value and when, and who approved it" for financial configuration. A database backend can technically store the same key-value pairs, but you'd have to build change history, review gates, and rollback yourself; Git already is that system, and Config Server is explicitly designed to treat a Git repo as its source of truth, including checking out specific commits or tags if you need to pin a config version to a release.

**Walk through what happens end-to-end when `payment-service` starts up with `spring.config.import=configserver:...` configured.** On startup, before the rest of the Spring context is fully assembled, `payment-service` makes an HTTP call to the Config Server, passing its `spring.application.name` (and active profile) as part of the request path. The Config Server resolves the matching file(s) in its backing Git repo — for example `payment-service.yml` merged with `payment-service-prod.yml` — clones or refreshes its local copy of the repo if needed, and returns the resolved properties as a JSON payload. `payment-service` merges that payload into its own Spring `Environment`, layered alongside its local `application.yml`, with the Config Server's values generally taking precedence for anything defined in both. If `fail-fast` is enabled and this call fails, the application aborts startup after exhausting its retry budget rather than starting with incomplete configuration.

**What's the actual difference between `/actuator/refresh` and Spring Cloud Bus, and why does it matter at scale?** `/actuator/refresh` re-creates `@RefreshScope` beans on the single instance that received the HTTP call — it has no fleet awareness at all. At scale, with dozens or hundreds of instances behind a load balancer, hitting `/actuator/refresh` on one instance leaves every other instance still running stale config, and there's no built-in way to know you got them all. Spring Cloud Bus solves the fan-out problem by connecting every instance to a shared broker topic; a single `/actuator/busrefresh` call publishes one event that every subscribed instance independently consumes and acts on, giving you fleet-wide consistency from one API call instead of needing external orchestration (a script iterating over every pod IP) to fake fleet-wide behavior.

**Why isn't `@RefreshScope` a substitute for a feature-flag system?** `@RefreshScope` operates at the granularity of a bean, refreshed uniformly across whatever instances receive the refresh event — it has no concept of per-request or per-user targeting, gradual percentage rollout, or instant kill-switch behavior scoped to a specific cohort. A feature-flag platform is built around a fundamentally different access pattern: a flag is evaluated per request, often with millisecond-latency SDK calls or locally-cached rulesets, against attributes of that specific request (user ID, merchant tier, geography) to decide behavior — and changes propagate near-instantly without a bean-recreation cycle. Trying to simulate percentage rollout with Config Server would mean encoding rollout logic into your config values and application code yourself, which is exactly the complexity a dedicated flagging system exists to absorb. Config Server answers "what environment am I running in and what are its settings"; a feature-flag system answers "for this specific request, right now, which behavior applies."

**Staff Engineer scenario:** A rate-limit value was pushed to the config repo and `/actuator/busrefresh` was called, but two out of forty `payment-service` pods kept enforcing the old rate limit for several minutes, causing inconsistent throttling behavior that showed up as a P1 in the incident channel. How do you investigate, and what would you change to prevent recurrence? Start by checking whether those two pods were actually subscribed to the Spring Cloud Bus topic at the time the event was published — the most common cause of this exact symptom is that the pods were mid-restart or mid-startup (still connecting to the Kafka/RabbitMQ binder) when the refresh event fired and simply missed it, since Spring Cloud Bus events aren't retained or replayed to instances that weren't listening at publish time. Confirm via the broker's consumer-group offsets or the instance logs around `RefreshRemoteApplicationEvent` handling. The immediate fix is operational: re-issue the refresh, or restart the two lagging pods so they pick up current config on the startup path instead of the refresh path. The durable fix is to stop treating "did the refresh propagate" as an assumption — add a lightweight config-version identifier (a hash or a Git commit SHA, exposed on `/actuator/env` or a custom health indicator) that's checked as part of readiness or a post-refresh verification step in the deploy pipeline, so a mismatched instance is detected automatically instead of surfacing as an inconsistent-behavior incident in production. The broader point for a staff engineer to land: config refresh is an eventually-consistent, best-effort broadcast, not a transaction — the system should be designed to detect drift, not just to trigger the refresh and assume it worked everywhere.

---

\<a id="topic-9">\</a>

## Topic 9 — Inter-Service Communication: RestTemplate/WebClient vs OpenFeign

### 30-second answer

Spring services can call others with blocking clients, reactive clients, or declarative Feign clients; the choice affects readability, threading, and resilience.

### Why interviewers ask this

They want modern Spring judgment and understanding of downstream failure behavior.

### Key points

- `RestTemplate` is legacy/maintenance mode.
- `WebClient` is modern and supports reactive/non-blocking use.
- OpenFeign is good for declarative HTTP clients.
- Every client needs timeouts and error handling.
- Client calls should be observable and bounded.

### Common traps

- No timeouts.
- Blocking event-loop threads.
- Using one client style everywhere without reason.
- No fallback or bulkhead for slow dependencies.

### Senior-level answer

Pick the client based on service style and team maintainability. Regardless of client, enforce timeouts, retries where safe, circuit breakers, auth, tracing, and clear error mapping.


\<details>
\<summary>\<strong>Deep dive notes\</strong>\</summary>

Once services need to call each other synchronously — `payment-service` fetching a merchant's risk
tier from `merchant-service` mid-transaction, for instance, where the call has to complete before
you can decide how to process the payment — Spring gives you three practical tools, and knowing when
to reach for which one, and why the ecosystem moved between them, is a fair thing for an interviewer
to probe.

**`RestTemplate`** is the original, synchronous, blocking HTTP client that shipped with Spring for years and is what you'll find scattered through any Spring codebase older than roughly 2018. It's simple to use and easy to read, but it's officially in maintenance mode — Spring hasn't added new features to it since Spring 5, and the documentation explicitly points newcomers toward `WebClient` instead. It's worth knowing cold because you will encounter it in legacy code and in interview questions about "what's wrong with this code," but you shouldn't be reaching for it in anything new.

```java
// legacy style — still common in older services, not recommended for new code
RestTemplate restTemplate = new RestTemplate();
MerchantRiskProfile profile = restTemplate.getForObject(
        "http://merchant-service/api/merchants/{id}/risk", 
        MerchantRiskProfile.class, 
        merchantId);
```

**`WebClient`**, introduced with Spring WebFlux, is the reactive, non-blocking replacement. The important nuance — and a real interview trap — is that `WebClient` is usable both reactively, inside a WebFlux application built on Reactor/Netty, and inside a perfectly ordinary Spring MVC servlet application, where you'd typically block on the result at the call site with `.block()`. Even in that blocking-call-site usage, `WebClient` is still the modern recommendation over `RestTemplate` because of how it's implemented underneath: it uses a non-blocking I/O client (Reactor Netty by default) so the actual network wait doesn't tie up a servlet container thread the way `RestTemplate`'s blocking `HttpURLConnection`/Apache HttpClient-based implementation does — and if you later evolve that call site to a reactive one (returning a `Mono`/`Flux` all the way up instead of blocking), you get the full non-blocking benefit without swapping clients.

```java
@Service
public class MerchantRiskWebClient {

    private final WebClient webClient;

    public MerchantRiskWebClient(WebClient.Builder builder) {
        this.webClient = builder.baseUrl("http://merchant-service").build();
    }

    public Mono<MerchantRiskProfile> fetchRiskProfile(String merchantId) {
        return webClient.get()
                .uri("/api/merchants/{id}/risk", merchantId)
                .retrieve()
                .bodyToMono(MerchantRiskProfile.class)
                .timeout(Duration.ofMillis(800));
    }

    // blocking call site inside a traditional MVC service — still gets non-blocking I/O underneath
    public MerchantRiskProfile fetchRiskProfileBlocking(String merchantId) {
        return fetchRiskProfile(merchantId).block();
    }
}
```

**OpenFeign** takes a different approach entirely: instead of writing imperative HTTP call code, you declare a Java interface, annotate it, and Spring generates a runtime implementation via dynamic proxies. For a system with a dozen or more downstream services each needing their own client, this collapses what would otherwise be a repetitive pile of `WebClient`/`RestTemplate` boilerplate — URL building, response deserialization, error handling per endpoint — into a handful of interface declarations that read like the API contract itself.

```java
@FeignClient(
    name = "merchant-service", 
    fallback = MerchantServiceClientFallback.class
)
public interface MerchantServiceClient {

    @GetMapping("/api/merchants/{merchantId}/risk")
    MerchantRiskProfile getRiskProfile(@PathVariable("merchantId") String merchantId);
}
```

```java
@Component
public class MerchantServiceClientFallback implements MerchantServiceClient {

    @Override
    public MerchantRiskProfile getRiskProfile(String merchantId) {
        // safe default when merchant-service is unavailable — treat as highest-scrutiny tier
        // rather than silently letting an unknown-risk merchant through at default trust
        return MerchantRiskProfile.unknownRiskDefault(merchantId);
    }
}
```

```java
@Service
public class PaymentProcessor {

    private final MerchantServiceClient merchantServiceClient;

    public PaymentProcessor(MerchantServiceClient merchantServiceClient) {
        this.merchantServiceClient = merchantServiceClient;
    }

    public void processPayment(PaymentRequest request) {
        MerchantRiskProfile riskProfile = merchantServiceClient.getRiskProfile(request.getMerchantId());
        // downstream logic branches on riskProfile.getTier() to decide additional checks
    }
}
```

The `name = "merchant-service"` value is the same logical service name resolved through Spring Cloud
LoadBalancer against the discovery client (Eureka, Consul, or Kubernetes DNS via a
`ServiceInstanceListSupplier`) — Feign doesn't bypass discovery, it sits on top of it, resolving
`merchant-service` to an actual healthy instance URI on every call the same way the gateway's
`lb://` scheme does. The `fallback` attribute is Feign's integration point with resilience tooling:
when `merchant-service` is unreachable or its circuit breaker (wired via Resilience4j — Topic 10) is
open, Spring routes the call to `MerchantServiceClientFallback` instead of propagating the exception
up into `processPayment`, letting the payment flow continue with a safe, explicit default instead of
crashing on a downstream outage it has no control over.

| | `RestTemplate` | `WebClient` | OpenFeign |
|---|---|---|---|
| Execution model | Blocking | Non-blocking (usable blocking or reactive) | Blocking by default (wraps an HTTP client underneath) |
| Status | Maintenance mode — not recommended for new code | Actively developed, modern default | Actively developed, modern default |
| Boilerplate per downstream call | Moderate — manual URL building, manual error handling | Moderate — fluent builder, but written out per call | Minimal — one interface method per endpoint |
| Declarative contract readability | No — imperative code | No — imperative code (though fluent) | Yes — interface reads like the API |
| Discovery + load-balancing integration | Via `@LoadBalanced` bean | Via `@LoadBalanced` `WebClient.Builder` | Native, built-in |
| Resilience4j fallback integration | Manual (wrap the call yourself) | Manual (`.onErrorResume`, manual circuit breaker wrapping) | Native, via `fallback`/`fallbackFactory` |
| Best fit | Reading/maintaining legacy code | Reactive pipelines, or blocking MVC call sites where you still want non-blocking I/O underneath | Many downstream services, want contract-like clients with minimal boilerplate |

\</details>

### Interview Questions

**`RestTemplate` is deprecated in spirit if not in fact — what specifically is wrong with it, mechanically?** `RestTemplate`'s underlying HTTP client implementations are blocking — the calling thread sits idle waiting on the network response for the full round-trip. In a traditional Spring MVC app backed by a bounded servlet thread pool (e.g., Tomcat's default worker pool), every blocked thread waiting on a slow downstream call is a thread that isn't available to handle another incoming request, so under load, a slow downstream dependency can exhaust the entire thread pool and take the whole service down, not just the calls that depend on that dependency. `WebClient`'s non-blocking I/O releases the underlying thread back to the pool while waiting on the network, so the same downstream slowness degrades throughput more gracefully rather than starving the whole server. That's the mechanical reason Spring's own docs steer new code toward `WebClient` even in ordinary blocking MVC applications.

**Is `WebClient` only useful in a reactive (WebFlux) application?** No, and this is a common misconception. You can use `WebClient` inside a standard Spring MVC application and simply `.block()` at the call site to get a synchronous result — you still benefit from non-blocking I/O underneath during the actual network wait, even though the calling code is written and executes in a blocking style overall. The full benefit — no thread blocked anywhere in the call chain — only materializes if the reactive type (`Mono`/`Flux`) is propagated all the way up through the call stack instead of being collapsed with `.block()`, which is why `WebClient` inside an MVC app is a genuine improvement over `RestTemplate` but a smaller one than using it inside an actually-reactive WebFlux service.

**Why would you choose OpenFeign over hand-writing `WebClient` calls, and is there a real downside?** Feign's main win is boilerplate reduction and readability at scale — once you have more than a handful of downstream services, an interface-per-service with one annotated method per endpoint is dramatically less code to write and maintain than a `WebClient` call built out by hand for each endpoint, and the interface itself functions as living documentation of the contract. The real downside is a layer of indirection: the actual HTTP call, retry behavior, and error handling are generated by a dynamic proxy at runtime, which makes some debugging (stack traces, understanding exactly what's happening on a slow call) slightly less direct than reading straight-line `WebClient` code, and it couples you more tightly to the Spring Cloud OpenFeign dependency and its configuration surface (encoders, decoders, error decoders) rather than the more general-purpose `WebClient`/Reactor ecosystem.

**How does a `@FeignClient` with a `fallback` interact with Resilience4j, and what happens on the call path when the downstream service is down?** `spring-cloud-starter-openfeign` integrates with Resilience4j's circuit breaker so that calls made through a `@FeignClient` are automatically wrapped in a circuit breaker (when `feign.circuitbreaker.enabled=true` is set). When `merchant-service` is down or timing out enough to trip the breaker into the open state, Feign short-circuits the call entirely — it doesn't even attempt the network call — and instead invokes the method on the configured `fallback` bean, returning whatever safe default that fallback provides. From the caller's (`PaymentProcessor`'s) perspective, this is transparent: it calls `merchantServiceClient.getRiskProfile(...)` and gets back either the real profile or the fallback's default, with no exception to catch in the normal case, which is exactly the point — the resilience behavior is centralized in the client definition rather than scattered as try/catch blocks at every call site.

**Staff Engineer scenario:** During code review, you see a new `@FeignClient` added for a downstream `loyalty-service` call inside the payment processing path, with no `fallback` configured and no timeout set beyond the framework default. The PR author argues "it's fine, `loyalty-service` is reliable." What do you push back on, and why does it matter specifically in a payment-processing path? The core issue is that "reliable" is not the same as "guaranteed available on every call," and a payment processing path is exactly where an unbounded dependency on a non-critical downstream service is most dangerous — if `loyalty-service` (arguably not essential to completing a payment, unlike a fraud or risk check) has a slow period or an outage, and the Feign call has no fallback and an over-generous or default timeout, every in-flight payment request now blocks on `loyalty-service`'s availability, turning a minor, non-critical service's bad day into a payment-processing outage. The fix is threefold: set an explicit, tight timeout appropriate to how long you're actually willing to wait on a non-critical enrichment call; add a `TimeLimiter`/circuit breaker (Topic 10) so a slow `loyalty-service` degrades gracefully instead of piling up blocked calls; and add a `fallback` that lets the payment proceed without loyalty data (e.g., loyalty points get credited asynchronously later, out of the critical path) rather than failing the payment outright over a non-essential enrichment. The broader principle to push in review: every synchronous downstream call added to a payment's critical path needs an explicit answer to "what happens to this payment if this specific call fails or hangs," and "it's usually fine" is not that answer.

---

\<a id="topic-10">\</a>

## Topic 10 — Resilience Patterns with Resilience4j

### 30-second answer

Resilience4j provides patterns like circuit breaker, retry, timeout, bulkhead, and rate limiter to prevent dependency failures from becoming service failures.

### Why interviewers ask this

They check production readiness and failure thinking.

### Key points

- Timeouts are mandatory.
- Retries need budgets and idempotency.
- Circuit breakers stop repeated calls to failing dependencies.
- Bulkheads isolate resources.
- Rate limiters protect downstream and self.

### Common traps

- Retrying non-idempotent operations blindly.
- Retry storms without jitter/budget.
- Using circuit breakers without observability.
- Applying the same policy to every dependency.

### Senior-level answer

Design resilience per dependency and business operation. Combine timeout, retry, breaker, bulkhead, fallback, and metrics based on failure cost and idempotency.


\<details>
\<summary>\<strong>Deep dive notes\</strong>\</summary>

You've almost certainly already studied circuit breakers, retries, bulkheads, rate limiters, and
timeouts as system design concepts — why they exist, what cascading failure looks like without them,
why a naive retry storm can turn a partial outage into a total one. This topic is deliberately not
re-deriving that theory; it's the Spring-specific mechanics of Resilience4j, the library that
actually implements these patterns in a JVM service, because "I understand circuit breakers
conceptually" and "I can configure one correctly in a Spring Boot service and reason about how it
interacts with three other annotations on the same method" are different, and the second is what a
staff-level interview at a payments company is actually testing.

Resilience4j is organized into independent modules, each with its own annotation, each of which can
be applied to a method independently or stacked together. Here they are individually, each guarding
a call to a downstream fraud-check service — a realistic dependency for a payment processing path,
since fraud checks are exactly the kind of call that's business-critical but can't be allowed to
take the whole payment pipeline down if it degrades.

```java
@Service
public class FraudCheckClient {

    private final RestClient restClient; // Spring 6 sync client, shown for variety

    @CircuitBreaker(name = "fraudCheckService", fallbackMethod = "fraudCheckFallback")
    public FraudCheckResult checkTransaction(PaymentRequest request) {
        return restClient.post()
                .uri("/api/fraud/check")
                .body(request)
                .retrieve()
                .body(FraudCheckResult.class);
    }

    public FraudCheckResult fraudCheckFallback(PaymentRequest request, Throwable t) {
        return FraudCheckResult.degradedFallback(request.getTransactionId());
    }
}
```

```java
@Retry(name = "fraudCheckService", fallbackMethod = "fraudCheckFallback")
public FraudCheckResult checkTransactionWithRetry(PaymentRequest request) { /* ... */ }

@RateLimiter(name = "fraudCheckService")
public FraudCheckResult checkTransactionRateLimited(PaymentRequest request) { /* ... */ }

@Bulkhead(name = "fraudCheckService", type = Bulkhead.Type.THREADPOOL)
public FraudCheckResult checkTransactionBulkheaded(PaymentRequest request) { /* ... */ }

@TimeLimiter(name = "fraudCheckService")
public CompletableFuture<FraudCheckResult> checkTransactionTimeLimited(PaymentRequest request) { /* ... */ }
```

The circuit breaker's job is to stop calling a downstream that's clearly failing, rather than
letting every request pay the full cost of discovering that failure independently. It's a state
machine with three states. **Closed** is the normal state — calls pass through to the real
downstream, and Resilience4j tracks outcomes over a sliding window. **Open** is the tripped state —
once the failure rate within that sliding window crosses `failureRateThreshold`, the breaker flips
open and every call is short-circuited immediately to the fallback, without attempting the network
call at all, for a fixed `waitDurationInOpenState`. **Half-open** is the probing state entered
automatically after that wait duration elapses — the breaker lets a small number of calls through
(`permittedNumberOfCallsInHalfOpenState`) to test whether the downstream has recovered; if enough of
those succeed, it closes again, and if they fail, it reopens and waits again.

```yaml
resilience4j:
  circuitbreaker:
    instances:
      fraudCheckService:
        sliding-window-type: COUNT_BASED
        sliding-window-size: 20
        failure-rate-threshold: 50
        wait-duration-in-open-state: 15s
        permitted-number-of-calls-in-half-open-state: 5
        minimum-number-of-calls: 10
        automatic-transition-from-open-to-half-open-enabled: true
  retry:
    instances:
      fraudCheckService:
        max-attempts: 3
        wait-duration: 200ms
        retry-exceptions:
          - java.io.IOException
          - java.util.concurrent.TimeoutException
  ratelimiter:
    instances:
      fraudCheckService:
        limit-for-period: 100
        limit-refresh-period: 1s
        timeout-duration: 100ms
  bulkhead:
    instances:
      fraudCheckService:
        max-concurrent-calls: 25
  timelimiter:
    instances:
      fraudCheckService:
        timeout-duration: 800ms
```

Externalizing these thresholds in YAML rather than hardcoding them into annotation attributes is the
realistic production pattern for exactly the same reason Config Server exists (Topic 8): a
`failureRateThreshold` or `waitDurationInOpenState` is a value operators need to tune based on live
production behavior — often during an actual incident — without waiting on a code deploy.
Annotation-only configuration (`@CircuitBreaker(name = "x")` with no matching YAML block falls back
to library defaults) is fine for a prototype; a real payments service configures these instance-by-
instance in YAML, and ideally through Spring Cloud Config so those thresholds are versioned and can
be adjusted fleet-wide via a refresh event.

The `fallbackMethod` is where a genuinely payments-specific design question shows up, and it's a
favorite for staff-level interviews because there's no universally correct answer — the correct
answer depends on context, and demonstrating that you know *which* context matters is the actual
signal. When the fraud-check service is unavailable, should `checkTransaction` **fail closed** —
reject the payment outright, refusing to process anything it can't screen — or **fail open** — let
the payment through, flagged for asynchronous review, so a fraud-check outage doesn't become a full
payment-processing outage? The wrong answer is picking one policy and applying it globally. The
right framing ties the decision to transaction risk tier: for a high-value transaction, a first-time
payment instrument, or a merchant already flagged as elevated-risk, failing closed is very likely
correct — the cost of wrongly blocking a legitimate high-risk transaction during a fraud-service
outage is lower than the cost of letting a genuinely fraudulent one through unscreened. For a small,
low-risk, repeat transaction from an established customer with a long clean history, failing open
with the transaction queued for async post-hoc review is often the better trade — you keep the
payment platform available for the overwhelming majority of low-risk traffic instead of taking a
full outage because one screening dependency degraded, and you accept a small, bounded, reviewable
risk on a narrow slice of traffic instead. Implementing this well means the fallback isn't a single
static default but a function of the request's own risk attributes:

```java
public FraudCheckResult fraudCheckFallback(PaymentRequest request, Throwable t) {
    if (request.getRiskTier() == RiskTier.HIGH || request.getAmount().compareTo(HIGH_VALUE_THRESHOLD) > 0) {
        return FraudCheckResult.rejected(request.getTransactionId(), "fraud-check unavailable, failing closed for high-risk tx");
    }
    return FraudCheckResult.allowedPendingAsyncReview(request.getTransactionId());
}
```

The last genuinely tricky mechanical point, and a real gotcha even for engineers who've used
Resilience4j for a while, is **composition order** when multiple annotations stack on one method.
Resilience4j applies them in a fixed, specific nesting order regardless of the order you write the
annotations in the source: `Retry` wraps `CircuitBreaker` wraps `RateLimiter` wraps `TimeLimiter`
(with `Bulkhead` innermost of all, closest to the actual call). This ordering has real behavioral
consequences. Because `Retry` is outermost, a retry attempt re-enters the circuit breaker on every
attempt — meaning a request can trip the breaker across the course of its own retries, and once the
breaker opens, subsequent retry attempts from that same logical call get short-circuited to the
fallback immediately rather than each one blocking on a fresh network attempt. Because `TimeLimiter`
is closer to the actual call than `CircuitBreaker`, a call that times out is what the circuit
breaker sees and counts toward its failure rate — the breaker is reacting to the time-limited
outcome, not to the raw, potentially much longer, underlying call duration. Get this backwards in
your mental model — assume, say, that `CircuitBreaker` is outermost and shields `Retry` — and you'll
mispredict exactly what a stack trace or a metrics dashboard shows you during an incident, which is
precisely the kind of subtle-but-checkable knowledge a staff interview question is designed to
surface.

\</details>

### Interview Questions

**Walk through the circuit breaker's closed/open/half-open state machine and Resilience4j's specific configuration knobs for each transition.** In the closed state, calls flow through normally and Resilience4j records outcomes in a sliding window (count-based or time-based, set via `sliding-window-type`/`sliding-window-size`); once the observed failure rate within that window exceeds `failure-rate-threshold` (and enough calls have been observed, per `minimum-number-of-calls`, so a tiny sample doesn't trigger prematurely), the breaker transitions to open. In open state, every call is short-circuited to the fallback with no network attempt made, for the duration set by `wait-duration-in-open-state`. Once that duration elapses, and assuming `automatic-transition-from-open-to-half-open-enabled` is set, the breaker moves to half-open and allows a limited number of real calls through, governed by `permitted-number-of-calls-in-half-open-state`; if enough of those succeed it closes again, resetting the failure count, and if they fail it reopens and starts the wait duration over. The whole point of half-open is to avoid two bad extremes: hammering a still-broken downstream with full traffic the instant the wait timer expires, or leaving the breaker open forever once the downstream has actually recovered.

**For a payment platform, should a fraud-check failure default to blocking the payment or letting it through — and how would you actually implement that decision?** There's no single correct global policy — the right answer depends on the risk profile of the specific transaction, which is the point an interviewer is testing for. High-value transactions, new payment instruments, and elevated-risk merchants should fail closed when the fraud-check dependency is unavailable, since the cost of wrongly letting a risky transaction through unscreened outweighs the cost of momentarily blocking it. Low-risk, low-value, established-customer transactions are usually better served failing open with the transaction flagged for asynchronous post-hoc fraud review, so a fraud-check outage degrades the platform's risk posture on a narrow, bounded slice of traffic instead of taking payment processing down entirely. Implementing this correctly means the Resilience4j `fallbackMethod` inspects the request's own risk attributes rather than returning one static value, so the fail-open/fail-closed decision is made per-transaction, not per-deployment.

**What's the actual nesting/composition order when `@Retry`, `@CircuitBreaker`, `@RateLimiter`, `@TimeLimiter`, and `@Bulkhead` are stacked on the same method, and why does it matter?** Resilience4j applies them in a fixed order — `Retry` outermost, then `CircuitBreaker`, then `RateLimiter`, then `TimeLimiter`, with `Bulkhead` closest to the actual call — regardless of the order the annotations are written in source. It matters because `Retry` being outermost means each retry attempt re-enters and can itself trip the circuit breaker, and because `TimeLimiter` sitting inside `CircuitBreaker` means the breaker's failure-rate calculation is based on time-limited outcomes (a timeout counts as a failure the breaker sees), not on the raw underlying call latency. Misunderstanding this ordering leads to wrong predictions about exactly when a breaker trips relative to retries and timeouts, which is a real source of confusion when debugging a production incident under this stack.

**Why prefer YAML-based Resilience4j configuration over annotation attributes in a production service?** Thresholds like `failureRateThreshold` or `waitDurationInOpenState` are operational tuning parameters, not business logic — they're exactly the kind of value you want to adjust live, often mid-incident, in response to how a downstream dependency is actually behaving, without cutting a new code deploy to change a number in an annotation. Externalizing them in YAML (and ideally through Spring Cloud Config, so changes are versioned, audited, and can be pushed fleet-wide via Spring Cloud Bus) gives operators that lever directly. Hardcoded annotation attributes bake the threshold into the deployed artifact, meaning any tuning requires a full build-and-deploy cycle — acceptable for a prototype, a real liability during an active incident in production.

**What's the difference between `@Bulkhead`'s `SEMAPHORE` and `THREADPOOL` types, and when would you pick each?** `SEMAPHORE` bulkheading limits concurrent calls by permits on the calling thread itself — the call still executes on the caller's thread, but only up to `max-concurrent-calls` are allowed to be in flight at once, with excess calls rejected immediately rather than queued. `THREADPOOL` bulkheading instead runs the guarded call on a dedicated, isolated thread pool separate from the caller's own threads (typically the servlet container's request-handling threads), so a downstream that's slow can only ever exhaust that dedicated pool's capacity, not the pool serving the rest of the application's traffic. `SEMAPHORE` is lighter-weight (no extra thread pool and its associated context-switching and memory overhead) and is the more common default for typical service-to-service calls; `THREADPOOL` is worth the extra overhead specifically when you need true isolation — guaranteeing a slow or hanging call to one downstream can never consume threads the rest of the application needs, which is a stronger guarantee than semaphore-based limiting provides since a semaphore still occupies the calling thread for the duration of a hanging call.

**Staff Engineer scenario:** Post-incident review reveals that during a `fraud-check-service` degradation, `payment-service`'s circuit breaker for `fraudCheckService` never tripped, even though the fraud-check calls were consistently taking 4+ seconds against an expected 200ms — and that slowness alone caused a backlog that eventually exhausted `payment-service`'s own thread pool. Diagnose why the breaker didn't help, and what configuration was missing. The most likely root cause is that no `TimeLimiter` (or equivalent bounded timeout) was configured on the fraud-check call path, so calls that were slow but not outright erroring — no connection refused, no 5xx, just very slow 2xx responses — never registered as "failures" to the circuit breaker at all; a circuit breaker configured purely on error/exception outcomes is blind to pure latency degradation unless something converts "too slow" into a recorded failure. Without a `TimeLimiter` wrapping the call (or a bounded HTTP client-level read timeout counted as a `Retry`-exception), Resilience4j's failure-rate calculation stayed low even while real user-facing latency exploded, so the breaker's `failureRateThreshold` was never crossed and it stayed closed, dutifully forwarding every request to a downstream that was technically "succeeding" but far too slowly to matter. The fix is to add an explicit `TimeLimiter` with a timeout tight enough to reflect actual acceptable latency for this call (well under the 4+ second observed duration, likely in the 500ms–1s range given a 200ms expected baseline), configured so that a timeout is treated as a recorded failure by the circuit breaker sitting around it — this closes the gap between "erroring" and "unacceptably slow," which is exactly the distinction that let this incident happen. The broader lesson: a circuit breaker without an accompanying timeout is only defending against hard failures, not the arguably more common and more dangerous case of a downstream that's alive but degraded.

---

\<a id="topic-11">\</a>

## Topic 11 — Microservices Decomposition Patterns in Practice

### 30-second answer

Microservices should be split around business capabilities, data ownership, and change boundaries, not just technical layers.

### Why interviewers ask this

They want architecture judgment, especially avoiding distributed monoliths.

### Key points

- Bounded contexts guide boundaries.
- Each service should own its data.
- Cross-service transactions need sagas/outbox/reconciliation.
- Shared databases couple teams and releases.
- Start simpler when scale does not justify distribution.

### Common traps

- Splitting by controller/service/repository layers.
- Sharing one database across services.
- Creating chatty synchronous chains.
- Ignoring ownership and operational cost.

### Senior-level answer

Decompose when independent ownership, scale, reliability, or deployment justifies it. Keep invariants local where possible and use async/event patterns carefully for cross-boundary workflows.


\<details>
\<summary>\<strong>Deep dive notes\</strong>\</summary>

Bounded contexts and service-boundary theory tell you where the seams in a domain *should* be; this
topic is about the mechanics of actually getting there from a running system, in a Spring Boot
codebase, without a big-bang rewrite that risks the platform's stability along the way — which, on a
payments system processing live money movement, is simply not a risk most organizations can
responsibly take.

The **Strangler Fig pattern** is the standard, low-risk way to migrate functionality out of a
monolith into a new microservice incrementally. The name comes from the strangler fig vine, which
grows around a host tree, gradually taking over its structural role, until eventually the original
tree can be removed while the vine stands on its own — the migration equivalent is routing traffic
for a specific piece of functionality to a new service while the monolith still handles everything
else, then gradually expanding what the new service owns until the monolith's corresponding code
path is provably dead and can be deleted. Concretely: say a legacy monolithic `PaymentPlatform`
application currently handles refunds inline as part of its own codebase, at `/api/v1/refunds`. You
stand up a new, purpose-built `refund-service`, and instead of cutting every client over to it at
once, you change the API Gateway's routing rule (Topic 7) so that only `/api/v1/refunds/**` traffic
is routed to `refund-service`, while every other path — `/api/v1/payments`, `/api/v1/merchants`,
everything else — continues to route to the monolith exactly as before.

```yaml
spring:
  cloud:
    gateway:
      routes:
        - id: refund-service-strangler-route
          uri: lb://refund-service
          predicates:
            - Path=/api/v1/refunds/**
          # newly extracted functionality — routed to the new service

        - id: legacy-monolith-catchall
          uri: lb://payment-platform-monolith
          predicates:
            - Path=/api/v1/**
          # everything not yet extracted still hits the monolith
```

Route ordering and predicate specificity matter here — the more specific `refunds` route has to be
evaluated and matched before the broad monolith catch-all, or every refund request falls through to
the old code path regardless of intent. Once `refund-service` has run in production carrying real
traffic for a meaningful bake-in period — verified against the monolith's prior behavior, ideally
with a period of shadow traffic or a canary rollout where a small percentage of refund traffic goes
to the new service while the rest still hits the monolith, so you can compare outcomes before fully
committing — only then does the monolith's own refund code path get deleted. The discipline that
makes this pattern work, and the thing worth stating explicitly in an interview, is that the old
code is never deleted *before* the new service has been proven live under real traffic; the
temptation to delete it early "since we're migrating anyway" is exactly what turns a strangler
migration into a risky big-bang cutover wearing a strangler-fig costume. Doing this well typically
also means the monolith and the new service share the same underlying data for a transitional period
— either the new service reads from the monolith's database directly during the earliest phase (a
pragmatic, temporary exception to database-per-service, explicitly called out as technical debt with
a removal plan) or, more cleanly, the monolith publishes refund-related events that `refund-service`
consumes to build its own local view, so the new service is source-of-truth-correct even before the
monolith's write path is fully retired.

The **Sidecar pattern** is worth knowing exists even if your current stack doesn't use one, because
it's a common interview topic for candidates whose experience is Spring-Cloud-centric and who
haven't necessarily worked in a service-mesh environment. Instead of every service implementing
cross-cutting concerns — mutual TLS, request retries, circuit breaking, distributed tracing, metrics
collection — in its own application code (which is essentially what Resilience4j and Spring Cloud
Gateway are doing, in-process, in everything covered so far in this document), a sidecar runs those
concerns as a separate, co-located process alongside the main service container, typically as a
second container in the same Kubernetes pod, intercepting the service's network traffic
transparently. Istio, built on the Envoy proxy, is the canonical example: each pod gets an Envoy
sidecar that handles mTLS between services, retry and circuit-breaking policy, and telemetry, all
configured centrally through the mesh's control plane rather than through library dependencies and
annotations inside each service's own code. The trade-off versus the Resilience4j/Spring Cloud
Gateway approach covered in this document is real and worth naming directly: a service mesh
centralizes resilience and security policy outside application code, which is powerful for a
polyglot fleet (a Go service and a Java service get the same mTLS and retry behavior for free, with
zero code in either) and for consistency at scale, but it adds real operational complexity — another
control plane to run, understand, and debug, and a layer where "why did this call fail" now has to
be diagnosed partly outside your own application's logs and metrics. Most Spring-centric shops get a
long way with in-process Resilience4j and gateway-level policy before the case for a full mesh
becomes compelling; a mesh tends to earn its cost once the fleet is genuinely polyglot or once
security requirements (mandatory mTLS everywhere, enforced independent of any given service
remembering to configure it) outgrow what's practical to enforce per-service.

**Database-per-service** is the principle that each microservice owns its own datasource and schema exclusively — no other service is permitted to connect to it, query its tables, or share a JDBC connection pool against it, even read-only, even "just this once." In a Spring Data context this has a very concrete implication: `payment-service` gets its own `spring.datasource.url` pointing at a database or schema that only `payment-service`'s own `@Repository`/`JpaRepository` beans ever touch; `merchant-service` has a completely separate one. The point isn't paranoia for its own sake — it's what actually makes independent deployability real. If `merchant-service` reaches directly into `payment-service`'s `payments` table for a report, then `payment-service` can no longer freely change that table's schema (add a column, split a table, change a type) without coordinating a simultaneous deploy with `merchant-service`, which is precisely the tight coupling microservices were supposed to eliminate — you've just moved the coupling from a shared JVM classpath to a shared database schema, which is arguably worse, since a shared schema has no compiler to catch the breakage at build time.

The genuinely hard part, and the part every candidate who's touched a real decomposition project has
opinions about, is what happens to the SQL `JOIN` that used to be trivial inside the monolith. If
`payment-service` needs merchant name and risk tier alongside a payment record — data that now lives
in `merchant-service`'s own database — that join has to become one of three things, each with a real
trade-off, not a free lunch:

| Approach | How it works | Latency/consistency trade-off | Best fit |
|---|---|---|---|
| Synchronous API call | `payment-service` calls `merchant-service` (via Feign/WebClient, Topic 9) at request time | Adds a network hop and a hard dependency to every request path; needs a fallback (Topic 10) for when `merchant-service` is down | Data needed fresh, on the critical path, and the caller can tolerate the extra hop and failure mode |
| Data replication / CDC-based local read replica | `merchant-service`'s changes stream via Debezium/CDC into a denormalized local table inside `payment-service`'s own database | No runtime dependency on `merchant-service` being up; data is eventually consistent, with a small, usually sub-second replication lag | High-read, latency-sensitive paths where a brief staleness window is acceptable and an extra network hop per request isn't |
| Event-driven denormalization | `merchant-service` publishes domain events (`MerchantRiskTierChanged`) to Kafka; `payment-service` consumes them and maintains its own local, purpose-shaped projection | Same eventual-consistency trade-off as CDC, but the contract is an explicit, versioned domain event rather than a raw table-shape capture, which is more stable across `merchant-service`'s internal refactors | Same use case as CDC, preferred when you want an explicit event contract decoupled from `merchant-service`'s internal schema, consistent with the event-driven and Kafka Streams patterns already covered for cross-service data flow |

This is the direct application of the CDC and event-streaming material already covered for cross-
service data flow — the same "avoid a synchronous dependency on the critical path by maintaining a
local, continuously-updated projection" idea that shows up in stream-processing contexts generally
applies here as the standard way to avoid turning every cross-service data need into a brittle web
of synchronous calls.

Finally, "how do you know when to split a service" deserves an honest, non-mechanical answer,
because the mechanical ones — a line-count threshold, "more than N endpoints," "more than N tables"
— are all wrong in ways that show up quickly in practice. A 3,000-line module that's owned by one
team, changes coherently as a unit, deploys on its own schedule without waiting on unrelated work,
and has a stable, narrow interface to the rest of the system can be a perfectly good monolithic
module that doesn't need to be a separate service — splitting it would just add network calls and
operational overhead without buying anything. The signal that's actually worth splitting on is a
mismatch between team ownership and deployment boundaries: when a piece of functionality is owned
(in practice, day-to-day) by a team that can't ship a change to it without coordinating a deploy
with other teams' unrelated work landing in the same artifact, when its release cadence is being
throttled by code that has nothing to do with it, or when its scaling profile is different enough
from the rest of the monolith that it's forcing the whole application to be over-provisioned to
handle one hot path — those are the conditions where extracting a service buys real independent
deployability. Team topology and change frequency are the honest heuristics; a services-per-line-of-
code target is a proxy that's easy to game and easy to apply to the wrong boundary, splitting along
a seam that's structurally convenient rather than organizationally or operationally meaningful.

\</details>

### Interview Questions

**Explain the Strangler Fig pattern and why it's preferred over a full cutover for a payments platform specifically.** The Strangler Fig pattern migrates functionality out of a monolith incrementally, routing a narrow, well-defined slice of traffic (e.g., one API path) to a newly extracted service while everything else continues to be served by the monolith unchanged, then expanding the new service's scope only after each slice has been verified in production. It's strongly preferred over a big-bang cutover on a payments platform because a full cutover concentrates all migration risk into a single moment — any bug in the new service's handling of, say, refund logic is discovered against live financial transactions with no fallback, whereas a strangler migration lets you verify the new service's correctness against real traffic on a narrow, bounded slice, roll back a single route if something's wrong, and only delete the monolith's old code path once the new one has demonstrated it's trustworthy under production load.

**What does "database-per-service" actually forbid, and why does violating it undermine the whole point of microservices?** It forbids any service from directly reading or writing another service's database or schema — no shared connection pool, no cross-service SQL join, no "just this one read-only query" against another team's tables. Violating it re-introduces the exact coupling microservices are meant to remove: if `merchant-service`'s schema can't change without checking whether `payment-service` has a query depending on its current shape, the two services can no longer deploy independently, which was the entire justification for splitting them apart in the first place — and it's a worse form of coupling than a shared library dependency, because there's no compiler or build step to catch the breakage before it hits production.

**A cross-service SQL join used to be trivial in the monolith — what are your options once the tables are in separate service databases, and how do you choose between them?** Three realistic options: a synchronous API call to the owning service at request time, which is simplest to reason about but adds latency and a hard runtime dependency (needing a Resilience4j fallback, Topic 10, for when the owning service is down); a CDC-based local read replica, where changes stream via something like Debezium into a denormalized table inside the calling service's own database, removing the runtime dependency at the cost of eventual consistency; and event-driven denormalization, where the owning service publishes explicit domain events that the calling service consumes to build its own local projection, similar to CDC in its consistency trade-off but with a more stable, intentional contract than replicating raw table shape. The choice comes down to how fresh the data needs to be and whether the calling service can tolerate a hard runtime dependency on the owning service being available — a critical, latency-sensitive, high-read path usually favors CDC or events to avoid the synchronous coupling, while a low-volume, non-critical lookup might just take the synchronous call and accept the simplicity.

**What's the Sidecar pattern, and when does it actually earn its operational cost over what Spring Cloud Gateway and Resilience4j already give you?** A sidecar is a co-located process — commonly a second container in the same Kubernetes pod — that handles cross-cutting concerns like mTLS, retries, and telemetry by transparently intercepting the main service's network traffic, rather than those concerns being implemented as libraries and annotations inside the service's own code, as Resilience4j and Spring Cloud Gateway do. It earns its cost primarily in a genuinely polyglot fleet, where you don't want to reimplement the same resilience and security policy in every language's own library ecosystem, or where security requirements (mandatory, unbypassable mTLS between every service, for instance) need to be enforced at the infrastructure layer rather than trusted to every team remembering to configure it correctly in their own code. For a largely Spring-centric shop, in-process Resilience4j plus gateway-level policy usually covers the same ground with meaningfully less operational surface area — running and debugging a full service mesh control plane is not a small addition, and it's worth being honest that most teams should reach for it only once the polyglot or security requirements genuinely outgrow what per-service configuration can deliver.

**How do you actually decide when a piece of functionality should be split into its own service, if not by size or line count?** The reliable signal is a mismatch between team ownership and deployment boundaries, not the size of the code itself — a large, cohesive module owned entirely by one team that deploys on its own schedule without being blocked by unrelated changes is a perfectly healthy part of a monolith, extracting it would only add network overhead for no organizational benefit. Splitting earns its cost when a team can't ship changes to functionality they own without coordinating a deploy with unrelated teams' code in the same artifact, when release cadence for that functionality is being throttled by unrelated work, or when its scaling or reliability profile is different enough from the rest of the system that it's forcing the whole monolith to be provisioned or operated around one hot or fragile path. Line-count or endpoint-count thresholds are proxies that are easy to apply to the wrong seam entirely — a structurally convenient split isn't the same as an organizationally or operationally meaningful one.

**Staff Engineer scenario:** Six months into a Strangler Fig migration of refunds out of `PaymentPlatform`, a teammate proposes deleting the monolith's legacy refund code now, since `refund-service` has been "live for a while" and "nobody's complained." How do you evaluate whether that's actually safe, and what would you want to see before agreeing? "Nobody's complained" isn't evidence of correctness — it's the absence of a support ticket, which is a weak, lagging signal, especially for refund logic, where a subtly wrong outcome (an incorrect refund amount, a refund applied to the wrong ledger entry) might not surface as an obvious user complaint for a long time, if ever, and by the time it does, the money's already moved. Before agreeing to delete the monolith's code path, I'd want to confirm: that the gateway routing has genuinely sent 100% of refund traffic to `refund-service` for a meaningful, monitored period, not just "most of it, probably"; that there's reconciliation evidence — refund amounts, statuses, and downstream ledger effects from `refund-service` compared against what the monolith would have produced for the same inputs, ideally via a shadow-traffic or dual-write comparison period rather than trusting behavioral equivalence by inspection; and that any transitional data-access shortcut taken during migration (the new service reading the monolith's database directly, as an explicit temporary exception) has actually been closed out, with `refund-service` now fully on its own datasource, per the database-per-service principle — deleting the monolith's code while the new service still secretly depends on the monolith's database is a fragile state to be caught in permanently. Only once traffic routing, behavioral verification, and data ownership are all fully settled would I agree the old code is dead weight rather than an emergency rollback path.

---

\<a id="topic-12">\</a>

## Topic 12 — Spring Boot Actuator & Production Readiness

### 30-second answer

Actuator exposes health, metrics, info, and operational endpoints that help run Spring services safely.

### Why interviewers ask this

They check whether you think beyond code completion to operability.

### Key points

- Health endpoints should distinguish liveness and readiness.
- Metrics need useful tags without high cardinality.
- Sensitive endpoints must be secured.
- Custom health indicators should reflect real dependencies.
- Graceful shutdown matters in rolling deploys.

### Common traps

- Exposing actuator publicly.
- Using liveness to check downstream dependencies.
- Creating high-cardinality metrics.
- Ignoring readiness during startup/shutdown.

### Senior-level answer

Use Actuator as part of the production contract: safe health checks, useful metrics, secured endpoints, and deployment-aware readiness behavior.


\<details>
\<summary>\<strong>Deep dive notes\</strong>\</summary>

Actuator is the operational skin Spring Boot puts over your application: a set of built-in HTTP
endpoints (and JMX beans, if you still live in that world) that expose what a running instance is
doing without you writing a line of monitoring code. Add `spring-boot-starter-actuator` to a
`payment-service` and you get `/actuator/health` for a rollup of dependency and application health,
`/actuator/metrics` for every Micrometer meter the app has registered (JVM memory, GC pauses, HTTP
request latencies, thread pool utilization), `/actuator/info` for build and git metadata you can
wire into your CI pipeline, `/actuator/env` for a dump of every property source and its resolved
value (including where it came from, which is invaluable when someone swears they set
`PAYMENT_GATEWAY_TIMEOUT_MS=5000` and the app is clearly still using the default), and
`/actuator/loggers`, which is the one senior engineers actually reach for at 2am — it lets you
`POST` a new log level to a specific logger package on a *running* instance, no redeploy, no
restart. If `com.acme.payment.gateway` is misbehaving in production and you need `DEBUG`-level
request/response logging to see what the gateway is actually sending back, you don't cut a release,
you hit the endpoint:

```bash
curl -X POST https://payment-service.internal:8081/actuator/loggers/com.acme.payment.gateway \
  -H "Content-Type: application/json" \
  -d '{"configuredLevel": "DEBUG"}'
```

and dial it back the same way once you've captured what you need. That single endpoint has probably
saved more incident-response time than any dashboard, because it collapses "reproduce in a lower
environment, add logging, redeploy, wait, reproduce again" into thirty seconds against the actual
misbehaving instance.

The piece that trips people up conceptually — and that Kubernetes makes you get right or it will
actively fight you — is the split between **liveness** and **readiness**. They sound like synonyms
and they are not. Liveness answers "is this process fundamentally broken in a way that only a
restart fixes" — a deadlocked thread pool, an unrecoverable out-of-memory condition, a stuck event
loop. Readiness answers a completely different question: "is this process healthy but not currently
able to serve traffic" — still populating a local cache from a startup query, still waiting for a
connection pool to warm up, or, mid-request-storm, deliberately shedding load because a downstream
dependency is degraded. Spring Boot exposes these as two separate groups automatically when it
detects it's running under Kubernetes: `/actuator/health/liveness` and `/actuator/health/readiness`.
The reason this split exists, and the reason getting it wrong is a classic production incident, is
entirely about what each probe *causes* Kubernetes to do. A failing liveness probe gets the pod
killed and restarted. A failing readiness probe just gets the pod pulled out of the Service's
endpoint list — no traffic routed to it — while the process keeps running and is left alone to
finish whatever it's doing.

**Staff Engineer scenario:** Your `ledger-service` deploys fine in staging but in production, under real load, new pods keep crash-looping during rollout — `CrashLoopBackOff` in `kubectl get pods`, and each restart makes things marginally worse because now you have even fewer healthy pods absorbing the same traffic. Investigation shows the pod's startup sequence does a full reconciliation read against a read-replica to warm an in-memory balance cache, and under production data volume that takes 40–60 seconds — comfortably fine in staging where the dataset is tiny. The Deployment YAML, copied from a template, has liveness and readiness pointed at the *same* endpoint with the *same* short `initialDelaySeconds`. Kubernetes calls that endpoint, gets a non-200 because the cache warm-up isn't done, and because it's wired as the liveness probe, kills the pod — which restarts, begins warming the cache again, gets killed again, forever. The fix isn't a code change to the health check logic at all; it's separating the two probes properly: liveness should just answer "is the JVM up and the main event loop responsive" (nearly always true during a slow startup), while readiness should reflect "is the cache warm and are downstreams reachable," with a longer `initialDelaySeconds`/`failureThreshold` budget that tolerates a legitimately slow but healthy startup. This is precisely the failure mode the liveness/readiness split exists to prevent, and it's a very common thing for an interviewer to hand you as a "here's a symptom, find the root cause" exercise.

Out of the box, Actuator's aggregate health status is a boolean-ish rollup — UP if every registered
`HealthIndicator` reports UP, DOWN if any of them does — which is exactly the wrong default for
anything beyond a toy service, because it means any dependency you wire a health check to for
visibility can, by design, take your service out of rotation. Writing a custom indicator is
straightforward:

```java
@Component
public class DownstreamPaymentGatewayHealthIndicator implements HealthIndicator {

    private final PaymentGatewayClient gatewayClient;

    public DownstreamPaymentGatewayHealthIndicator(PaymentGatewayClient gatewayClient) {
        this.gatewayClient = gatewayClient;
    }

    @Override
    public Health health() {
        try {
            GatewayPingResponse ping = gatewayClient.ping(Duration.ofMillis(800));
            if (ping.isReachable()) {
                return Health.up()
                        .withDetail("gateway", "reachable")
                        .withDetail("latencyMs", ping.latencyMillis())
                        .build();
            }
            return Health.down()
                    .withDetail("gateway", "unreachable")
                    .withDetail("reason", ping.failureReason())
                    .build();
        } catch (Exception ex) {
            return Health.down(ex).withDetail("gateway", "exception during ping").build();
        }
    }
}
```

The design question that separates a junior implementation from a senior one is: should this
indicator's DOWN status flip the whole service's *readiness*, pulling `payment-service` out of the
load balancer entirely, or should it just be visible in the `/actuator/health` details for
dashboards and alerting without affecting whether traffic keeps flowing? The answer depends entirely
on whether the dependency is on the critical path for the requests this service serves. If `payment-
service` literally cannot authorize a payment without the gateway, DOWN-on-gateway-unreachable
failing readiness is arguably correct — you'd rather shed the pod and let requests queue or fail
fast than accept traffic you can't fulfill. But if the same service also exposes a read-only "view
transaction history" endpoint that doesn't touch the gateway at all, failing readiness for the
entire pod because one downstream is flaky is an over-aggressive health check that turns one
dependency's partial outage into your own total outage — and worse, if every instance of `payment-
service` does this simultaneously, you've just taken your whole fleet out of rotation because of
someone else's incident, which is the textbook cascading-failure anti-pattern. Spring Boot lets you
control this explicitly: register the indicator under a named group and decide per-group whether it
participates in readiness:

```yaml
management:
  endpoint:
    health:
      show-details: always
      group:
        readiness:
          include: readinessState,downstreamPaymentGateway
```

or, more conservatively for a genuinely non-critical dependency, leave it out of the `readiness`
group entirely and let it only surface in the general `/actuator/health` payload and your
metrics/alerting pipeline — visible to humans, invisible to the Kubernetes controller deciding
whether to route traffic.

The other half of "production readiness" is security, and this is the part that shows up in real
breach post-mortems, not hypotheticals: Actuator endpoints left on their defaults and exposed on the
same port as the application, unauthenticated, on the public internet. `/actuator/env` dumps every
resolved property, which very often includes database credentials or API keys sourced from
environment variables (Spring does mask common credential-looking property names, but that masking
is heuristic, not a guarantee). `/actuator/heapdump` will hand out an actual heap dump of the
running JVM — which can contain live objects holding decrypted card data, session tokens, or PII
sitting in memory at the moment of capture. `/actuator/shutdown`, if enabled, will let anyone who
can reach it kill your process. The fix has two independent layers, and a senior engineer should
reach for both, not either: first, run Actuator on a **separate management port** that isn't exposed
by the same ingress/load balancer as your application traffic —

```yaml
management:
  server:
    port: 9001
  endpoints:
    web:
      exposure:
        include: health,info,metrics,loggers
```

— so even if someone misconfigures the ingress, the sensitive endpoints simply aren't routable from
outside the cluster. Second, and independently, put real authentication and authorization in front
of whatever *is* exposed, using the same `SecurityFilterChain` mechanism covered in Topic 14,
scoping `/actuator/**` to an `ADMIN` authority and leaving only `/actuator/health` open for the
Kubernetes probes to hit unauthenticated (since the kubelet isn't carrying a bearer token). Relying
on network topology alone is fragile — cloud misconfigurations, a stray public load balancer rule,
or a debugging session where someone temporarily exposes a port are all real ways that "it's on an
internal port" stops being true; relying on authentication alone means a compromised internal
network segment still gets you nothing. Defense in depth here is not a platitude, it's the actual
difference between an internal debugging convenience and a CVE writeup with your company's name in
the title.

\</details>

### Interview Questions

**Why does Kubernetes need separate liveness and readiness probes instead of one health check?** Because they trigger fundamentally different remediation actions and conflating them causes real outages. A failing liveness probe tells Kubernetes "this process is unrecoverably broken, kill and restart it" — appropriate for a deadlock or an unrecoverable OOM. A failing readiness probe tells Kubernetes "this process is fine but shouldn't receive traffic right now" — appropriate for a slow startup, a cache warming up, or deliberate load shedding — and the remedy is just removing the pod from the Service endpoints, not restarting it. If you wire both to the same check with a short timeout, a legitimately slow-but-healthy startup gets misread as a crash, the pod gets killed mid-startup, and you get a self-inflicted crash loop that never resolves because every restart re-triggers the same slow startup path.

**Should a health check for a non-critical downstream dependency ever fail your service's readiness?** Generally no, and this is a deliberate design decision, not an oversight. Readiness failing means "pull me out of the load balancer" — appropriate only when the service genuinely cannot do its job without that dependency. If the dependency is non-critical to the endpoints being served, failing readiness turns a partial, isolated outage elsewhere into a full self-inflicted outage of your own service, and if many instances of your service do this simultaneously it can cascade into taking your entire fleet out of rotation in sympathy with someone else's incident. The better pattern is to surface the dependency's status in the `/actuator/health` details for observability and alerting, keep it out of the `readiness` health group, and let the endpoints that actually depend on it fail individually (with a circuit breaker, per Topic 10) rather than failing the whole pod.

**What's the actual risk of leaving `/actuator/env` and `/actuator/heapdump` exposed without authentication?** These are two of the most sensitive endpoints Actuator ships. `/actuator/env` reveals every resolved configuration property including, in many misconfigured setups, credentials and API keys pulled from environment variables that don't match Spring's masking heuristics. `/actuator/heapdump` hands out a full memory snapshot of the running JVM, which can contain decrypted secrets, session tokens, or sensitive customer data that happened to be live in memory — effectively a data exfiltration endpoint with zero forensic trace beyond an access log line. This is a documented, recurring class of real-world security incident, not a theoretical concern, and the fix is layered: put Actuator on a separate management port not exposed by the public ingress, and independently require authentication/authorization on top of that so a network misconfiguration alone doesn't become a breach.

**How would you let an operator change a specific package's log level in production without redeploying?** Use the `/actuator/loggers` endpoint, which is writable, not just readable — `POST` a JSON body with `configuredLevel` to `/actuator/loggers/{logger-name}` and the change takes effect immediately on the live JVM via the underlying logging framework's configuration API, no restart involved. This is invaluable for exactly the scenario where a specific component (say, the payment gateway client) is misbehaving in production and you need DEBUG-level detail to diagnose it without cutting a release, running it in a lower environment that may not reproduce the issue, or restarting the instance and potentially losing the state that's exhibiting the problem. Naturally this endpoint needs to be behind the same authentication/authorization controls as the rest of Actuator, since letting an unauthenticated caller flip your logging to TRACE is both a DoS vector (log volume) and a potential information-disclosure vector.

**How do you keep one flaky non-critical dependency from taking your whole service out of the load balancer?** Configure Actuator's health groups explicitly rather than relying on the default aggregate rollup. Register a `HealthIndicator` for the dependency so its status is visible in `/actuator/health` details, but scope the `readiness` health group (the one Kubernetes' readiness probe actually reads) to only the indicators that represent genuinely blocking dependencies — `management.endpoint.health.group.readiness.include`. Combine this with a circuit breaker (Topic 10) around calls to the non-critical dependency so individual requests that need it fail fast and gracefully instead of hanging, while requests that don't touch it are served normally. The health check and the resilience pattern work together: the health check controls whether the *pod* stays in rotation, the circuit breaker controls whether individual *requests* degrade gracefully — conflating the two is how a partial outage becomes a total one.

---

\<a id="topic-13">\</a>

## Topic 13 — Observability: Metrics, Tracing, and Structured Logging

### 30-second answer

Observability combines logs, metrics, and traces so teams can understand service behavior and diagnose incidents.

### Why interviewers ask this

They want production diagnosis maturity.

### Key points

- Logs explain events.
- Metrics show trends and alerts.
- Traces show request flow across services.
- Correlation IDs tie signals together.
- OpenTelemetry is the common direction.

### Common traps

- Logging sensitive data.
- Creating noisy alerts.
- Missing correlation IDs.
- High-cardinality labels in metrics.

### Senior-level answer

Design observability around questions operators need to answer: is it broken, who is impacted, where is it slow, what changed, and how do we prove recovery?


\<details>
\<summary>\<strong>Deep dive notes\</strong>\</summary>

Once a payment platform is more than a couple of services, "is it working" stops being answerable by
staring at one application's logs and becomes a distributed-systems question, which is exactly the
gap Micrometer, distributed tracing, and structured logging exist to close. Micrometer is Spring
Boot's metrics facade — think SLF4J, but for metrics instead of logs. Your application code
instruments against Micrometer's vendor-neutral API (`Counter`, `Gauge`, `Timer`,
`DistributionSummary`), and which backend those numbers actually land in — Prometheus, Datadog,
CloudWatch, New Relic — is a matter of which `MeterRegistry` implementation is on the classpath and
configured, with zero changes to instrumentation code. This matters operationally more than it
sounds: a platform team can migrate from self-hosted Prometheus to a managed observability vendor,
or run both in parallel during a migration, without touching a single `@Timed` annotation or
`Counter.builder()` call in `payment-service`.

The three meter types map to genuinely different questions. A `Counter` only ever goes up and
answers "how many of these happened" — total payments processed since startup. A `Gauge` reports a
point-in-time value that can go up or down — current size of the retry queue, number of open
connections in the pool. A `Timer` (or `DistributionSummary` for non-time measurements) captures
both a count and a distribution of durations — not just "how many payments processed" but "what does
the latency distribution of processing them look like," which is what lets you report p50/p95/p99,
not just an average that hides your worst-case tail. A worked instrumentation of payment processing:

```java
@Service
public class PaymentProcessingService {

    private final MeterRegistry meterRegistry;
    private final PaymentGatewayClient gatewayClient;

    public PaymentProcessingService(MeterRegistry meterRegistry, PaymentGatewayClient gatewayClient) {
        this.meterRegistry = meterRegistry;
        this.gatewayClient = gatewayClient;
    }

    public PaymentResult processPayment(PaymentRequest request, MerchantTier merchantTier) {
        Timer.Sample sample = Timer.start(meterRegistry);
        String status = "success";
        try {
            PaymentResult result = gatewayClient.authorizeAndCapture(request);
            if (!result.isSuccessful()) {
                status = "failure";
            }
            return result;
        } catch (Exception ex) {
            status = "failure";
            throw ex;
        } finally {
            meterRegistry.counter("payment.processed",
                    "status", status,
                    "merchantTier", merchantTier.name()).increment();

            sample.stop(Timer.builder("payment.processing.duration")
                    .tag("status", status)
                    .tag("merchantTier", merchantTier.name())
                    .publishPercentileHistogram()
                    .register(meterRegistry));
        }
    }
}
```

`payment.processed` tagged by `status` and `merchantTier` lets you build a dashboard panel for
"failure rate by merchant tier over time" directly out of the metrics backend, no log-scraping
required, and `payment.processing.duration` with `publishPercentileHistogram()` gives you real p99
latency, not a misleading average across a heavily skewed distribution.

The tag choice — `merchantTier` rather than raw `merchantId`, and definitely not `customerId` — is
not a stylistic preference, it's the difference between a metrics bill you can predict and one that
blows up unannounced. This is **cardinality**, and it is one of the most common production gotchas
in metrics instrumentation: every unique combination of tag values creates a distinct time series
that the backend has to store and index. `status` (two values) times `merchantTier` (maybe four
tiers) is eight time series — trivial. `status` times raw `customerId` on a platform with millions
of customers is potentially millions of time series for a single metric, and most Prometheus-
compatible backends will either silently drop data, blow past a cardinality limit and start
rejecting scrapes, or generate a bill that gets a Slack message from finance. The fix isn't "don't
tag by anything interesting," it's "tag by bounded dimensions" — merchant tier, region, payment
method type, error category — and push genuinely high-cardinality identifiers like `customerId` or
`paymentId` into structured logs and trace attributes instead, where they belong as searchable
context rather than as metric-series keys.

Metrics tell you *that* something is slow or failing in aggregate; distributed tracing tells you
*where in a specific request* the time went. Micrometer Tracing is Spring Boot 3's replacement for
the now-EOL Spring Cloud Sleuth, and it does the same conceptual job: it generates a trace ID for an
incoming request and propagates it, along with a span ID per hop, across service boundaries via HTTP
headers (or Kafka headers, per kafka-deep-dive.md's coverage of header propagation in event-driven
flows), so the same trace ID shows up in every service's logs and in a tracing backend like Zipkin
or Jaeger. Consider a UPI payment flowing through `api-gateway` → `payment-service` → `fraud-
service` → `ledger-service`: with tracing wired up, a single request generates one trace ID at the
gateway, and each hop creates a child span under it — `fraud-service`'s span nested under `payment-
service`'s, `ledger-service`'s span nested under that. In Zipkin's waterfall view, an engineer
investigating a customer complaint about a slow payment doesn't grep four services' logs by
timestamp and guess at correlation; they search by trace ID (or by request attributes, if the
backend supports it) and see one visual bar chart: gateway 12ms, payment-service 40ms, fraud-service
380ms, ledger-service 18ms — immediately pointing at `fraud-service` as the hop that ate the latency
budget, without a single log line read.

```yaml
management:
  tracing:
    sampling:
      probability: 1.0
  zipkin:
    tracing:
      endpoint: http://zipkin.internal:9411/api/v2/spans

logging:
  pattern:
    level: "%5p [${spring.application.name:},%X{traceId:-},%X{spanId:-}]"
```

That last line is the connective tissue between tracing and logging: Micrometer Tracing populates
the trace ID and span ID into SLF4J's MDC (Mapped Diagnostic Context) automatically, and the logging
pattern above pulls `%X{traceId}` and `%X{spanId}` into every log line without any manual
`MDC.put()` calls in application code. Combined with structured JSON logging — swapping Logback's
default text pattern for a JSON encoder —

```xml
<encoder class="net.logstash.logback.encoder.LogstashEncoder">
    <includeMdcKeyName>traceId</includeMdcKeyName>
    <includeMdcKeyName>spanId</includeMdcKeyName>
    <customFields>{"service":"payment-service"}</customFields>
</encoder>
```

every log line becomes a structured, queryable record with the trace ID as a first-class searchable
field in whatever log aggregation platform (ELK, Splunk, Datadog Logs) ingests it. This is the
concrete operational payoff: "grep the logs across twelve services for this one stuck payment,
correlating by rough timestamp and hoping the clocks are in sync" is exactly the failure mode
distributed tracing and MDC-propagated trace IDs are built to eliminate. An engineer gets one trace
ID from a customer support ticket or an error alert, pastes it into the log aggregator, and gets
every log line from every service that touched that specific payment, in causal order, correlated
automatically — no timestamp archaeology.

**Staff Engineer scenario:** Customers are intermittently reporting UPI payments that "hang" for 8–10 seconds before succeeding, well outside SLA, but it's inconsistent and doesn't reproduce on demand. Aggregate metrics on `payment.processing.duration` show p50 is fine and p99 is elevated but not dramatically — nothing screams "broken" at the dashboard level, because the slow requests are a small enough fraction that they don't move the aggregate much. This is precisely the case where metrics alone can't localize the problem — you need tracing. Pulling trace IDs for the specific slow requests (correlated from customer-reported transaction IDs via structured logs) and viewing them in Jaeger shows a consistent pattern: the `fraud-service` span itself is fast, but there's a large gap *between* `payment-service`'s call being issued and `fraud-service`'s span starting — meaning the time isn't inside fraud-service's processing at all, it's in whatever sits between the two calls. That redirects the investigation from "why is fraud-service slow" (a dead end, since its own span is fast) to "what's adding latency in the network/connection path to fraud-service" — which turns out to be a connection pool exhaustion issue in the HTTP client `payment-service` uses to call `fraud-service`, visible only because the trace waterfall showed a gap that wouldn't have been visible in either service's own internal metrics. This is the argument for tracing as a first-class investment, not a nice-to-have: some classes of latency bug are structurally invisible to per-service metrics and only show up in the cross-service causal view.

\</details>

### Interview Questions

**What's the difference between a Counter, a Gauge, and a Timer in Micrometer, and when would you use each?** A `Counter` is monotonically increasing and answers "how many" — total payments processed, total errors thrown — useful for rate calculations (Prometheus's `rate()` function, for instance) but meaningless as an absolute number without a time window. A `Gauge` reports the current value of something that goes up and down — active database connections, queue depth, in-flight requests — a snapshot, not a cumulative total. A `Timer` (or `DistributionSummary` for non-duration measurements) records both a count and a statistical distribution of values, which is what lets you compute percentiles like p95/p99 latency rather than just an average — critical in payments because tail latency, not average latency, is usually what breaches SLA and what customers actually notice. Picking the wrong type is a common mistake: using a Gauge for something that should be a Counter loses the ability to compute rates correctly if the gauge is sampled infrequently and misses transient spikes.

**Why is tagging a metric by customer ID a production risk, and what should you do instead?** Every unique combination of tag values on a metric creates a distinct time series in the backend, and this is called cardinality. A bounded tag like `status` or `merchantTier` produces a small, predictable number of series. A tag like `customerId` on a platform with millions of customers can produce millions of series for a single metric name, which most metrics backends handle badly — either by silently dropping series past a configured limit, rejecting the scrape/push entirely, or generating a storage and query cost bill that scales with your customer base rather than with your actual monitoring needs. The fix is to keep metric tags restricted to genuinely bounded dimensions (tier, region, payment method, error category) and push high-cardinality identifiers like customer ID, payment ID, or trace ID into structured logs and trace span attributes, where per-record storage and full-text/field search are the right tool, rather than into a time-series metrics backend.

**How does a trace ID actually get from `api-gateway` into `ledger-service`'s log lines, mechanically?** Micrometer Tracing instruments the HTTP client and server stack (and Kafka producer/consumer interceptors, for event-driven hops) to propagate trace context headers — typically B3 or W3C Trace Context format — across the network call. On the receiving side, the tracing instrumentation extracts those headers, creates a child span under the incoming trace, and — this is the part that connects tracing to logging — populates the trace ID and span ID into SLF4J's MDC for the duration of that request's processing thread. The Logback pattern (or JSON encoder field mapping) then includes those MDC values in every log statement emitted while handling that request, with no manual code in the business logic. The mechanism only works end-to-end if every hop in the chain — including any async boundaries, like a `@Async` method or a thread-pool handoff — correctly propagates or re-establishes the trace context, which is a common source of "the trace just stops" bugs when a service hands work off to a different thread without carrying the context along.

**Why do you need both metrics and tracing — isn't one enough?** They answer different questions and neither substitutes for the other. Metrics are cheap to store, easy to aggregate, and good for "is something wrong right now across the fleet" — an alert firing because p99 latency crossed a threshold, or error rate spiked. But metrics are aggregates; they tell you *that* something's wrong, not *which specific request* or *which specific hop* caused it, and some failure patterns (a small fraction of requests hitting a specific slow path) can hide inside an aggregate that still looks acceptable. Tracing is expensive relative to metrics (higher storage cost, usually sampled rather than capturing 100% of traffic at scale) but gives you the causal, per-request waterfall that lets you localize the problem to an exact service and an exact span. The practical pattern is metrics for detection and alerting, tracing for diagnosis once you know something's wrong — and structured logs correlated by trace ID as the bridge that lets you go from a trace-level anomaly down to the actual business-level detail (which payment, which merchant, what the request body looked like).

**What's the operational cost of sampling at `probability: 1.0` versus a lower sampling rate, and how would you decide?** Sampling every request (`1.0`) gives you complete tracing data — no risk of the one interesting failing request being the one that didn't get sampled — but at meaningful production volume the storage and processing cost of a tracing backend ingesting 100% of spans across every service can be substantial, and at very high throughput it can itself become a source of latency or backpressure in the instrumentation path. Lower sampling rates (say 5–10%) cut that cost roughly proportionally but mean that any individual customer-reported incident has a real chance the specific request wasn't sampled and simply has no trace to look at. The common resolution in payment systems is tail-based or error-based sampling: sample a small baseline percentage of all traffic for aggregate visibility, but force 100% sampling for any request that resulted in an error, exceeded a latency threshold, or belongs to a specific flagged category (e.g., high-value transactions) — giving you cheap baseline coverage plus guaranteed visibility exactly where you're most likely to need it for an incident.

---

\<a id="topic-14">\</a>

## Topic 14 — Spring Security: Authentication & Authorization

### 30-second answer

Spring Security provides authentication, authorization, filters, and integrations for OAuth2/OIDC/JWT-based systems.

### Why interviewers ask this

They check whether you understand security architecture, not just annotations.

### Key points

- Authentication verifies identity.
- Authorization decides allowed actions.
- JWT validation needs issuer, audience, signature, expiry, and scopes.
- Service-to-service auth may use OAuth2 client credentials or mTLS.
- Method security can protect business operations.

### Common traps

- Confusing OAuth and OIDC.
- Trusting unsigned/unvalidated JWT claims.
- Putting authorization only in the UI.
- Logging tokens or secrets.

### Senior-level answer

Use layered security: edge validation, service-level authorization, least privilege, secure token handling, and audited access to sensitive operations.


\<details>
\<summary>\<strong>Deep dive notes\</strong>\</summary>

Spring Security's core mental model is a chain of servlet filters that a request passes through
before it ever reaches your `@RestController`, each filter owning exactly one concern — CORS
handling, CSRF token validation, authentication (establishing who the caller is), and authorization
(deciding what that caller is allowed to do) — composed into a single `FilterChain` that either lets
the request through to your handler or short-circuits it with a 401/403. This matters at a design
level because it means security concerns are cross-cutting and declarative rather than scattered as
`if` checks inside controller methods: your `PaymentController` never has to manually check "is
there a valid token" before processing a refund, because by the time the request reaches it, the
filter chain has already either rejected it or attached a fully-populated `Authentication` object to
the `SecurityContext` that the controller (or the method-security layer in front of it) can trust.

The authentication/authorization distinction is the same one that shows up in any broader security-
architecture discussion — authentication is "who are you," authorization is "what are you allowed to
do given who you are" — but Spring gives you two concrete, complementary places to enforce
authorization, and knowing when to reach for which is a real design decision, not a style
preference. **Endpoint-level** rules, configured once in a `SecurityFilterChain` bean, are the
coarse-grained gate: which URL patterns require authentication at all, and which require a specific
role, before the request is even dispatched.

```java
@Configuration
@EnableWebSecurity
@EnableMethodSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/v1/health", "/api/v1/public/**").permitAll()
                .requestMatchers("/actuator/**").hasRole("ADMIN")
                .requestMatchers("/api/v1/payments/**").authenticated()
                .anyRequest().denyAll()
            )
            .oauth2ResourceServer(oauth2 -> oauth2.jwt(Customizer.withDefaults()))
            .csrf(csrf -> csrf.disable()) // stateless JWT API, no cookie-based session to protect
            .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS));
        return http.build();
    }
}
```

**Method-level** authorization, enabled via `@EnableMethodSecurity` and applied with `@PreAuthorize`, is the fine-grained gate: not just "you're allowed to hit this URL" but "you're allowed to invoke this specific operation, with these specific arguments." This distinction matters in payments specifically because "authenticated user who can view payments" and "authenticated user who can issue a refund" are very different privilege levels that often live behind the same URL prefix:

```java
@RestController
@RequestMapping("/api/v1/payments")
public class PaymentController {

    @GetMapping("/{paymentId}")
    @PreAuthorize("isAuthenticated()")
    public PaymentDto getPayment(@PathVariable String paymentId) {
        return paymentService.findById(paymentId);
    }

    @PostMapping("/{paymentId}/refund")
    @PreAuthorize("hasAuthority('PAYMENT_REFUND')")
    public RefundResult refundPayment(@PathVariable String paymentId, @RequestBody RefundRequest request) {
        return paymentService.refund(paymentId, request);
    }

    @DeleteMapping("/{paymentId}")
    @PreAuthorize("hasRole('ADMIN')")
    public void voidPayment(@PathVariable String paymentId) {
        paymentService.voidPayment(paymentId);
    }
}
```

`hasRole('ADMIN')` and `hasAuthority('PAYMENT_REFUND')` look similar but express different design
intents worth being precise about in an interview: roles are typically coarse organizational buckets
(`ADMIN`, `MERCHANT`, `SUPPORT_AGENT`) that Spring prefixes with `ROLE_` under the hood, while
authorities are finer-grained, often permission-shaped grants (`PAYMENT_REFUND`, `PAYMENT_VOID`,
`MERCHANT_ONBOARD`) that can be assigned independently of role — letting you build an actual
permissions model (a support agent with `PAYMENT_REFUND` but not `PAYMENT_VOID`) instead of forcing
every authorization decision through a small fixed set of roles. Real payment platforms almost
always end up needing the authority-based model for anything touching money movement, because "which
roles can refund" is a business/compliance question that changes independently of "which roles
exist."

For authentication itself, the dominant pattern for a stateless microservices platform is
configuring the service as an **OAuth2 Resource Server** validating JWTs rather than maintaining
server-side sessions. The `oauth2ResourceServer(oauth2 -> oauth2.jwt(...))` line above does real
work: on startup, Spring Security fetches the identity provider's JWKS (JSON Web Key Set) endpoint,
caches the public keys, and uses them to validate the signature on every incoming JWT — confirming
it was actually issued by your identity provider and hasn't been tampered with — without your
service needing to call the identity provider synchronously per request or hold any shared secret.
Once validated, it extracts claims (`sub` for subject/user identity, `scope` or a custom
`authorities` claim for permissions) and builds the `Authentication` object your `@PreAuthorize`
expressions evaluate against:

```yaml
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          jwk-set-uri: https://idp.acme.internal/.well-known/jwks.json
          issuer-uri: https://idp.acme.internal
```

```java
@Bean
public JwtAuthenticationConverter jwtAuthenticationConverter() {
    JwtGrantedAuthoritiesConverter authoritiesConverter = new JwtGrantedAuthoritiesConverter();
    authoritiesConverter.setAuthoritiesClaimName("scope");
    authoritiesConverter.setAuthorityPrefix(""); // scopes come pre-named, e.g. "PAYMENT_REFUND"

    JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
    converter.setJwtGrantedAuthoritiesConverter(authoritiesConverter);
    return converter;
}
```

The reason JWT fits stateless microservices better than server-side session cookies is structural,
not just a fashion preference: a session cookie requires the server that issued it (or a shared
session store every instance can reach) to validate it on every request, which means either sticky
routing or a shared-state dependency that becomes a scaling bottleneck and a single point of failure
across a fleet of services. A JWT carries its own validity proof (the signature) and its own claims,
so any instance of any service that trusts the issuer's public key can validate it independently,
with no shared state and no call back to an auth service on the hot path — which is exactly the
property you want when `payment-service`, `fraud-service`, and `ledger-service` are all
independently scaled and none of them should need to coordinate session state with each other.

Service-to-service authentication is a distinct problem from user-facing authentication and deserves
its own treatment, because "how does `payment-service` prove to `ledger-service` that this call is
legitimate" has no human sitting at a browser to redirect through a login flow. The standard pattern
is the OAuth2 **client-credentials** grant: each service has its own service-account client
ID/secret registered with the identity provider, and it exchanges those credentials directly for a
service-scoped access token — no user involved — which it then attaches to outbound calls. Spring
makes this a client-side interceptor concern rather than something scattered through business logic:

```java
@Bean
public WebClient ledgerServiceWebClient(OAuth2AuthorizedClientManager authorizedClientManager) {
    ServletOAuth2AuthorizedClientExchangeFilterFunction oauth2Filter =
            new ServletOAuth2AuthorizedClientExchangeFilterFunction(authorizedClientManager);
    oauth2Filter.setDefaultClientRegistrationId("ledger-service-client");

    return WebClient.builder()
            .baseUrl("https://ledger-service.internal")
            .apply(oauth2Filter.oauth2Configuration())
            .build();
}
```

```yaml
spring:
  security:
    oauth2:
      client:
        registration:
          ledger-service-client:
            client-id: payment-service
            client-secret: ${LEDGER_CLIENT_SECRET}
            authorization-grant-type: client_credentials
            scope: ledger:write
        provider:
          ledger-service-client:
            token-uri: https://idp.acme.internal/oauth2/token
```

The equivalent for a Feign client is an `Interceptor` bean that fetches (and caches/refreshes) the
client-credentials token and attaches it as a bearer header; the pattern is identical regardless of
which HTTP client library the call site uses. The alternative worth naming — and this ties directly
into whatever broader service-to-service security material already covers the trade-off in depth —
is **mTLS**, where the identity proof is a certificate presented at the TLS handshake layer rather
than a bearer token in the application layer. mTLS is stronger against token theft (there's no
bearer credential to steal off the wire or out of a log) and pushes identity verification down into
the infrastructure layer (often a service mesh sidecar, transparent to application code), but it's
heavier to operate — certificate issuance, rotation, and revocation infrastructure — and doesn't
naturally carry claims like scopes the way a JWT does, so many platforms end up layering both: mTLS
for transport-level service identity and network segmentation, OAuth2 client-credentials tokens for
the fine-grained "what is this specific call allowed to do" authorization decision.

| Approach | Identity proof | Where enforced | Carries claims/scopes | Operational overhead | Best fit |
|---|---|---|---|---|---|
| OAuth2 client-credentials (JWT) | Bearer token, app-layer | Application/API gateway | Yes, natively | Token issuance + refresh logic per client | Fine-grained per-call authorization, heterogeneous clients |
| mTLS | X.509 certificate, transport-layer | TLS handshake / mesh sidecar | No, needs pairing with another mechanism | Cert issuance, rotation, revocation (often via mesh) | Strong network-level service identity, defense against token theft |
| Both combined | Cert + token | Both layers | Yes | Highest, but strongest posture | High-security payment paths (e.g., ledger writes, gateway calls) |

**Staff Engineer scenario:** A security audit flags that `fraud-service` is accepting calls from `payment-service` using a long-lived static API key baked into a Kubernetes Secret, unrotated since the service was first stood up two years ago, and the audit wants it fixed without a big-bang rewrite before the next release window. The pragmatic staff-level answer isn't "migrate everything to mTLS via a service mesh" — that's a multi-quarter infrastructure project with its own risk. It's: stand up a client-credentials registration for `payment-service` against the existing identity provider (most IdPs support this without new infrastructure), swap the static API key check on `fraud-service`'s side for JWT validation against the IdP's JWKS endpoint (a `SecurityFilterChain` change, not a rewrite), and rotate/retire the static key once the token-based path is verified in production behind a feature flag or canary. This closes the actual audit finding (long-lived, unrotated, unscoped static credential) with a change scoped to two services and a config change, while leaving the larger "should we adopt mTLS platform-wide" conversation as a deliberate, separately-resourced follow-up rather than blocking the urgent fix on the bigger architectural decision.

\</details>

### Interview Questions

**Walk through what happens to a request from the moment it hits a Spring Boot service to the moment your controller code runs, security-wise.** The request first passes through the servlet filter chain Spring Security installs, in a fixed order: CORS filter decides whether the cross-origin request is even allowed to proceed; if OAuth2 resource server is configured, a bearer-token authentication filter extracts the JWT from the `Authorization` header, validates its signature against the cached JWKS, checks expiry and issuer, and — if valid — builds an `Authentication` object and stores it in the `SecurityContext` for the duration of the request (on a `ThreadLocal`, so it's implicitly available anywhere downstream on that thread). If authentication fails, the chain short-circuits with a 401 and the request never reaches your code. If it succeeds, the request proceeds to endpoint-level authorization — matched against the `authorizeHttpRequests` rules in your `SecurityFilterChain` bean — and if that passes, the request is finally dispatched to the controller, where any `@PreAuthorize` annotation triggers one more, method-scoped authorization check via an AOP proxy before your actual method body executes. Every one of these is a separate, replaceable concern, which is the whole point of the filter chain design.

**Why is JWT-based authentication considered a better fit for microservices than server-side session cookies?** Session cookies require the validating server to look up session state, which means either every instance of every service needs access to a shared, low-latency session store, or you need sticky routing that ties a client to a specific instance — both of which reintroduce shared state and coordination overhead into what's supposed to be an independently-scalable fleet of services. A JWT is self-validating: it carries a cryptographic signature that any service holding the issuer's public key (fetched once from the JWKS endpoint and cached) can verify locally, with the claims needed for authorization embedded directly in the token. No shared session store, no sticky routing, no synchronous call back to an auth service on the request hot path. The trade-off is that a JWT can't be instantly revoked the way a server-side session can (you'd need short expiries plus a token-blocklist or introspection endpoint for true instant revocation), so most platforms accept short-lived access tokens plus a refresh-token flow as the practical middle ground.

**What's the actual difference between `hasRole` and `hasAuthority` in `@PreAuthorize`, and why would a payments platform care?** `hasRole('ADMIN')` checks for a granted authority of `ROLE_ADMIN` — Spring silently adds the `ROLE_` prefix — and is meant for coarse-grained, mutually-exclusive-ish organizational categories. `hasAuthority('PAYMENT_REFUND')` checks for that exact string with no prefix magic, and is meant for fine-grained, independently-assignable permissions. On a payments platform this distinction is not academic: "which roles are allowed to issue a refund" is frequently a compliance or business decision that needs to be adjustable per person or per support tier without redefining what a role fundamentally means — a senior support agent might get `PAYMENT_REFUND` without also getting `PAYMENT_VOID` or `MERCHANT_ONBOARD`. Modeling authorization purely through a handful of roles forces you into role explosion (`ADMIN_WHO_CAN_REFUND`, `ADMIN_WHO_CANNOT_REFUND`) or, worse, over-privileging people because the nearest role happens to also grant capabilities they don't need — which is exactly the kind of finding a PCI-DSS or SOC2 access review will surface.

**How does service-to-service authentication differ from user authentication, and what are the options?** There's no human in the loop to redirect through a login page or hold a session, so the calling service itself has to prove its own identity using credentials it manages directly. The two dominant patterns are OAuth2 client-credentials — each service has its own registered client ID/secret, exchanges them directly with the identity provider for a short-lived, scoped access token, and attaches it as a bearer token on outbound calls, typically via an interceptor on `WebClient`, `RestTemplate`, or Feign so the token acquisition/refresh logic is centralized rather than duplicated per call site — and mTLS, where each service presents an X.509 certificate at the TLS handshake and identity is established at the transport layer, often transparently via a service mesh sidecar. Client-credentials tokens carry claims/scopes natively, which makes them good for fine-grained per-call authorization; mTLS is stronger against credential theft since there's no bearer secret traveling in an application header that could leak into a log, but needs its own certificate issuance/rotation infrastructure. Higher-security paths, like calls that write to a ledger, often combine both rather than choosing one.

**Why would you disable CSRF protection in a Spring Security config for a payment API, and is that actually safe?** CSRF protection exists to defend against a browser being tricked into submitting an authenticated request using credentials it's implicitly carrying — which in practice means cookie-based session authentication, because the browser attaches cookies automatically to any request to that origin, including ones triggered by a malicious page the user has open in another tab. A stateless API authenticated via a bearer JWT in an `Authorization` header has no such implicit credential — the browser doesn't auto-attach an `Authorization` header the way it auto-attaches cookies — so there's no CSRF attack surface to defend against for that authentication mechanism, and disabling the CSRF filter for a pure JWT-bearer-token API is standard and safe. The caveat that trips people up: if the same application *also* has any cookie-based session-authenticated surface (an admin web console using session cookies, for instance), CSRF protection needs to stay enabled for that surface specifically — CSRF and JWT-statelessness are per-authentication-mechanism concerns, not a global on/off switch for the whole application.

---

\<a id="topic-15">\</a>

## Topic 15 — Spring Kafka Integration

### 30-second answer

Spring Kafka wraps Kafka producer/consumer APIs with templates, listeners, serialization, error handling, retries, and transactions.

### Why interviewers ask this

They check whether you can connect Kafka theory to Spring implementation.

### Key points

- `KafkaTemplate` sends records.
- `@KafkaListener` consumes records with container-managed threading.
- Consumer group and partitioning shape parallelism.
- Retries and DLQs need explicit design.
- Idempotent consumers are essential.

### Common traps

- Assuming Kafka gives business exactly-once automatically.
- Ignoring partition key choice.
- Committing offsets before safe processing.
- Retrying poison messages forever.

### Senior-level answer

Design Spring Kafka flows around idempotency, offset timing, error handling, schema compatibility, observability, and partition-aware scaling.


\<details>
\<summary>\<strong>Deep dive notes\</strong>\</summary>

kafka-deep-dive.md already covers the mechanics that matter here — partitions and consumer groups,
ACKs and the in-sync replica set, exactly-once semantics, `@RetryableTopic` for retry topic chains,
DLQ design, and the Kafka-native Outbox and Saga implementations via Debezium — in enough depth that
repeating any of it would just be noise. This topic is deliberately narrower: given that you already
understand *why* Kafka behaves the way it does, here is *how you actually write the Spring code*
that produces to it, consumes from it, handles errors against it, and gets transactional guarantees
out of it, inside a Spring Boot service.

Producing is `KafkaTemplate`, Spring's thin, `RestTemplate`-shaped wrapper around the native Kafka
producer client. A `PaymentEventPublisher` publishing a `PaymentCompleted` event after a successful
authorization, keyed by `paymentId` so all events for the same payment land on the same partition
and preserve ordering (per the partitioning discussion in kafka-deep-dive.md):

```java
@Service
public class PaymentEventPublisher {

    private final KafkaTemplate<String, PaymentCompletedEvent> kafkaTemplate;

    public PaymentEventPublisher(KafkaTemplate<String, PaymentCompletedEvent> kafkaTemplate) {
        this.kafkaTemplate = kafkaTemplate;
    }

    public void publishPaymentCompleted(PaymentCompletedEvent event) {
        kafkaTemplate.send("payment.completed", event.paymentId(), event)
                .whenComplete((result, ex) -> {
                    if (ex != null) {
                        log.error("Failed to publish PaymentCompleted for paymentId={}", event.paymentId(), ex);
                        // surfaced to alerting; does NOT roll back the already-committed DB transaction
                    } else {
                        log.debug("Published PaymentCompleted offset={}", result.getRecordMetadata().offset());
                    }
                });
    }
}
```

The call site matters as much as the publisher class itself, and this is the gotcha worth being
precise about in an interview: the event has to be published *after* the database transaction that
recorded the payment has actually committed, not from inside it, unless you're specifically
implementing the transactional-outbox pattern kafka-deep-dive.md's Lesson 27 covers. If you call
`kafkaTemplate.send(...)` from inside a `@Transactional` method before the commit happens, you've
created a race — a consumer could receive and act on the `PaymentCompleted` event before the
producing transaction has actually committed and become visible to other readers, or worse, the
Kafka publish could succeed while the surrounding transaction later rolls back for an unrelated
reason, leaving you with an event on the wire describing a payment that, as far as the database is
concerned, never happened. The straightforward (non-outbox) fix is publishing from an
`@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)` handler, which Spring only
invokes once the enclosing transaction has actually committed:

```java
@Component
public class PaymentCompletedEventHandler {

    private final PaymentEventPublisher publisher;

    public PaymentCompletedEventHandler(PaymentEventPublisher publisher) {
        this.publisher = publisher;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onPaymentCompleted(PaymentCompletedDomainEvent domainEvent) {
        publisher.publishPaymentCompleted(domainEvent.toKafkaEvent());
    }
}
```

```java
@Service
public class PaymentService {

    private final ApplicationEventPublisher eventPublisher;

    @Transactional
    public void completePayment(Payment payment) {
        paymentRepository.save(payment);
        eventPublisher.publishEvent(new PaymentCompletedDomainEvent(payment)); // queued, not sent yet
        // Kafka publish only fires after this method's transaction commits successfully
    }
}
```

This is strictly weaker than the transactional outbox (there's still a small window where the DB
commit succeeds but the process crashes before the Kafka publish goes out, meaning the event is
simply lost rather than eventually delivered), which is exactly why kafka-deep-dive.md's outbox
coverage exists for the cases where that gap is unacceptable — payment completion events feeding a
ledger are usually exactly such a case. The `AFTER_COMMIT` pattern is the right tool when losing an
occasional event is tolerable (a non-critical notification, an analytics event) and the outbox is
the right tool when it isn't.

Consuming is `@KafkaListener`, and the design choice that matters most here is acknowledgment mode.
A `LedgerEventConsumer` reacting to `payment.completed` needs the Kafka offset to only commit once
the ledger update has actually succeeded — committing the offset first and updating the ledger
second would mean a crash between those two steps loses the event forever, since Kafka would believe
it was already processed. This is the same offset-commit-timing principle kafka-deep-dive.md's
Lesson 5 covers at the protocol level; in Spring Kafka it's controlled by setting `AckMode.MANUAL`
(or `MANUAL_IMMEDIATE`) and calling `Acknowledgment.acknowledge()` only after the business logic
succeeds:

```java
@Component
public class LedgerEventConsumer {

    private final LedgerService ledgerService;

    public LedgerEventConsumer(LedgerService ledgerService) {
        this.ledgerService = ledgerService;
    }

    @KafkaListener(
            topics = "payment.completed",
            groupId = "ledger-service",
            containerFactory = "manualAckContainerFactory")
    public void onPaymentCompleted(PaymentCompletedEvent event, Acknowledgment ack) {
        ledgerService.applyPaymentToLedger(event.paymentId(), event.amount(), event.merchantId());
        ack.acknowledge(); // offset only commits here — after the ledger write actually succeeded
    }
}
```

```java
@Bean
public ConcurrentKafkaListenerContainerFactory<String, PaymentCompletedEvent> manualAckContainerFactory(
        ConsumerFactory<String, PaymentCompletedEvent> consumerFactory) {
    ConcurrentKafkaListenerContainerFactory<String, PaymentCompletedEvent> factory =
            new ConcurrentKafkaListenerContainerFactory<>();
    factory.setConsumerFactory(consumerFactory);
    factory.getContainerProperties().setAckMode(ContainerProperties.AckMode.MANUAL);
    return factory;
}
```

If `applyPaymentToLedger` throws, `ack.acknowledge()` is never reached, the offset doesn't advance,
and — assuming default consumer behavior — the same record gets redelivered on the next poll, which
is exactly the at-least-once guarantee you want for a financial write, paired with an idempotent
ledger write (keyed by `paymentId`) on the consumer side to make redelivery safe rather than a
source of double-counting.

Error handling on the consumer side is Spring Kafka's `DefaultErrorHandler`, wired with a `BackOff`
policy and a `DeadLetterPublishingRecoverer` — this is the Spring-native mechanism for implementing
the DLQ pattern kafka-deep-dive.md's Lesson 25 covers conceptually, and it plugs directly into the
retry-topic thinking from that chapter's `@RetryableTopic` coverage as an alternative, more
manually-controlled path to the same outcome:

```java
@Bean
public DefaultErrorHandler ledgerErrorHandler(KafkaTemplate<String, Object> kafkaTemplate) {
    DeadLetterPublishingRecoverer recoverer = new DeadLetterPublishingRecoverer(kafkaTemplate,
            (record, ex) -> new TopicPartition("payment.completed.DLT", record.partition()));

    ExponentialBackOff backOff = new ExponentialBackOff(500L, 2.0);
    backOff.setMaxInterval(10_000L);
    backOff.setMaxElapsedTime(60_000L);

    DefaultErrorHandler errorHandler = new DefaultErrorHandler(recoverer, backOff);
    errorHandler.addNotRetryableExceptions(IllegalArgumentException.class); // bad data, retrying won't help
    return errorHandler;
}
```

Attaching this to the listener container factory means a transient failure (ledger DB briefly
unreachable) gets retried with exponential backoff on the same partition, while an exception
explicitly marked non-retryable (malformed event payload — no amount of retrying fixes that) is
routed straight to the `payment.completed.DLT` topic without wasting retry attempts, exactly
mirroring the retry-vs-DLQ decision tree kafka-deep-dive.md walks through conceptually, just
expressed as Spring bean wiring instead of broker-level topic chains.

Finally, transactional support: `@Transactional` combined with a transaction-capable `KafkaTemplate`
gives you the Spring-side implementation of read-process-write atomicity — consume a record, do a
database write, produce a downstream event, and commit the Kafka offset, all as one atomic unit that
either fully succeeds or fully rolls back, which is the Spring plumbing for the exactly-once
semantics kafka-deep-dive.md's Lesson 20 covers at the protocol level (idempotent producer plus
transactional coordinator):

```yaml
spring:
  kafka:
    producer:
      transaction-id-prefix: ledger-tx-
    consumer:
      isolation-level: read_committed
```

```java
@Component
public class LedgerReprocessConsumer {

    private final LedgerRepository ledgerRepository;
    private final KafkaTemplate<String, Object> kafkaTemplate;

    @KafkaListener(topics = "payment.completed", groupId = "ledger-tx-consumer")
    @Transactional("kafkaTransactionManager")
    public void process(PaymentCompletedEvent event) {
        ledgerRepository.applyPayment(event.paymentId(), event.amount()); // DB write, same transaction
        kafkaTemplate.send("ledger.updated", event.paymentId(), new LedgerUpdatedEvent(event)); // chained produce
        // offset commit, DB write, and downstream produce all commit or roll back together
    }
}
```

Note this specific arrangement — a DB write and a Kafka produce sharing one transactional outcome —
is exactly the kind of dual-resource atomicity problem the outbox pattern exists to solve *without*
requiring a distributed (XA/JTA) transaction spanning two different resource managers; using
`@Transactional("kafkaTransactionManager")` here works because Spring Kafka's transaction manager is
coordinating the Kafka-side transaction specifically, and true atomicity between the *database*
write and the Kafka produce still generally routes through the outbox pattern in production systems
rather than relying on distributed transactions across a relational database and Kafka, which is
fragile and slow. Where this pattern shines cleanly is read-process-write entirely *within* Kafka —
consume from one topic, produce to another, commit the offset, atomically — which is the classic
Kafka Streams / exactly-once processing use case.

| Concern | Spring mechanism | Kafka-level concept it implements (see kafka-deep-dive.md) |
|---|---|---|
| Producing after DB commit | `@TransactionalEventListener(AFTER_COMMIT)` or outbox | Avoiding the dual-write problem (Lesson 27) |
| Offset-commit timing | `AckMode.MANUAL` + `Acknowledgment.acknowledge()` | Consumer offset semantics (Lesson 5) |
| Retry + DLQ | `DefaultErrorHandler` + `BackOff` + `DeadLetterPublishingRecoverer` | DLQ pattern (Lesson 25), alternative to `@RetryableTopic` |
| Read-process-write atomicity | `@Transactional` + transactional `KafkaTemplate` | Exactly-once semantics (Lesson 20) |

\</details>

### Interview Questions

**Why shouldn't you publish a Kafka event from inside the same `@Transactional` method that writes to the database?** Because the database transaction and the Kafka publish are two independent resources with no shared atomicity guarantee by default — you can't roll back a message that's already been sent to a broker. If you publish before the transaction commits, one of two bad things can happen: a consumer processes the event and acts on data that isn't actually durably committed yet (or, if the transaction later rolls back for any reason, describes something that never actually happened), or the reverse — the transaction commits fine but the publish call itself throws, and now the database says the payment happened but no downstream service was ever told. The safe non-outbox pattern is publishing from an `AFTER_COMMIT`-phased transactional event listener, which only fires once the database transaction has actually and successfully committed; the fully safe pattern for anything that can't tolerate an occasional lost event is the transactional outbox, covered in depth in kafka-deep-dive.md's Lesson 27.

**What does `AckMode.MANUAL` actually change compared to the default acknowledgment mode, and why does it matter for a ledger consumer?** Spring Kafka's default ack mode commits offsets automatically, roughly in line with the consumer's poll loop, independent of whether your listener method actually succeeded — meaning a crash partway through business logic can still result in the offset being advanced, silently losing that record from the consumer's perspective (it'll never be redelivered). `AckMode.MANUAL` (or `MANUAL_IMMEDIATE`) hands control of exactly when the offset commits to your code, via `Acknowledgment.acknowledge()`, which you call only after the business-critical work — applying the payment to the ledger — has actually succeeded. If it throws before that call, the offset never advances and the record gets redelivered on the next poll. This only produces correct behavior when paired with an idempotent write on the consumer side (keyed by `paymentId`, for instance), since manual ack combined with retry is an at-least-once guarantee, not exactly-once — redelivery is expected, not a bug.

**How do `DefaultErrorHandler` with `DeadLetterPublishingRecoverer` and `@RetryableTopic` relate to each other — are they doing the same thing?** They're two different Spring Kafka mechanisms aimed at the same underlying pattern — kafka-deep-dive.md's DLQ design — but with different retry topologies. `@RetryableTopic` creates a chain of actual Kafka topics (`payment.completed-retry-0`, `-retry-1`, etc.) and re-publishes failed records to progressively delayed retry topics before eventually landing on a DLT, which means retries happen out-of-band on separate topics/partitions and don't block the main consumer's partition. `DefaultErrorHandler` with a `BackOff` retries in-place — blocking that consumer thread/partition for the backoff duration before giving up and routing to a DLT via `DeadLetterPublishingRecoverer` — which is simpler to reason about and doesn't create extra topics, but does mean a slow-to-recover failure can stall processing of everything behind it on that partition for the duration of the retries. The choice is a genuine trade-off: `@RetryableTopic` for high-throughput topics where blocking a partition during retries is unacceptable, `DefaultErrorHandler` for lower-volume or latency-tolerant consumers where the operational simplicity of not managing extra retry topics wins.

**If you wrap a `@KafkaListener` method in `@Transactional` alongside a DB write and a downstream Kafka produce, have you achieved true exactly-once processing across the database and Kafka?** Not by default, and this is a common trap. `@Transactional("kafkaTransactionManager")` gives you atomicity for the Kafka-side operations — the consumed offset commit and any produced records are coordinated together as one Kafka transaction, which is genuinely exactly-once at the Kafka level (per kafka-deep-dive.md's Lesson 20). But the relational database write is a separate resource manager entirely; unless you're using a full distributed (XA/JTA) transaction spanning both — which is operationally expensive and generally avoided in high-throughput systems — the DB commit and the Kafka transaction commit are two separate commits that can, in principle, diverge if the process crashes between them. In practice, production systems solve the DB-plus-Kafka atomicity problem with the transactional outbox pattern rather than distributed transactions: write the DB change and an outbox row in one local DB transaction, then let a separate process (often Debezium, per kafka-deep-dive.md) reliably publish from the outbox to Kafka.

**When would you choose plain `KafkaTemplate.send()` with manual error handling over full Spring Kafka transactions?** Transactions add real overhead — a transactional producer requires broker-side coordinator round trips and generally lower throughput than a non-transactional idempotent producer — and they only make sense when you actually need atomicity across multiple operations (a consume-produce chain, or multiple produces that must land together or not at all). For the common case of `payment-service` publishing a single `PaymentCompleted` event as a side effect of a completed transaction — not consuming anything, not producing multiple related records atomically — plain `KafkaTemplate.send()` fired from an `AFTER_COMMIT` listener (or an outbox relay) is simpler, cheaper, and sufficient; the idempotent producer configuration (`enable.idempotence=true`, on by default in modern Kafka clients) already gives you exactly-once delivery *per produce call* without needing the heavier transactional coordinator. Reach for `@Transactional` with the Kafka transaction manager specifically when the atomicity unit spans more than one Kafka operation or a consume-then-produce chain, not as a default for every producer.

---

\<a id="topic-16">\</a>

## Topic 16 — Dockerizing and Deploying Spring Boot to Kubernetes

### 30-second answer

Containerized Spring Boot apps need small images, correct JVM/container settings, health probes, graceful shutdown, config, and secrets.

### Why interviewers ask this

They check practical deployment maturity.

### Key points

- Use multi-stage builds.
- Set readiness/liveness probes correctly.
- Handle SIGTERM and graceful shutdown.
- Externalize config and secrets.
- Right-size CPU/memory and JVM options.

### Common traps

- Running as root.
- Baking secrets into images.
- Misusing liveness probes and causing restart loops.
- Ignoring JVM memory inside container limits.

### Senior-level answer

Treat deployment as part of architecture. A Spring service is production-ready only when startup, shutdown, probes, resources, logging, config, and rollback behavior are designed.


\<details>
\<summary>\<strong>Deep dive notes\</strong>\</summary>

Shipping a Spring Boot service to Kubernetes starts with the Dockerfile, and the single biggest
lever for image quality is a **multi-stage build**: one stage with the full JDK and build tool
(Maven or Gradle) that actually compiles and packages the application, and a second, separate stage
that starts from a minimal JRE base image and copies in only the built artifact — none of the build
tooling, source code, or dependency-resolution caches end up in the image that actually ships to
production.

```dockerfile
# ---- Build stage ----
FROM eclipse-temurin:21-jdk-alpine AS build
WORKDIR /workspace
COPY pom.xml .
COPY .mvn .mvn
COPY mvnw .
RUN ./mvnw dependency:go-offline -B
COPY src src
RUN ./mvnw package -DskipTests -B

# ---- Runtime stage ----
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
RUN addgroup -S spring && adduser -S spring -G spring
USER spring:spring
COPY --from=build /workspace/target/payment-service-*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75.0", "-jar", "app.jar"]
```

A single-stage equivalent would ship Maven itself, the full JDK (versus a much smaller JRE), every
downloaded dependency `.jar` used only at build time, and often the raw source tree into the
production image — bloating the image by hundreds of megabytes, slowing every pull during a rolling
deployment, and needlessly expanding the attack surface with build tooling nobody runtime needs. The
`dependency:go-offline` step, run before copying `src`, is a deliberate ordering trick for Docker's
layer caching: dependencies change far less often than application code, so as long as `pom.xml` is
unchanged, Docker reuses the cached dependency-resolution layer on rebuilds and only re-runs the
(much faster) `package` step, instead of re-downloading the entire dependency tree on every single
build.

Spring Boot pushes this idea one layer further with its **layered jar** support, which matters
specifically for CI/CD iteration speed once you're deploying multiple times a day. A default Spring
Boot fat jar bundles your application classes and every dependency into one monolithic archive; from
Docker's perspective, a one-line code change means the entire jar — dependencies included — is a new
file, so the whole thing gets re-pushed to the registry and re-pulled by every node, even though 99%
of the bytes (the dependency jars) didn't actually change. Layered jars split the archive into
logical layers — dependencies (rarely change), the Spring Boot loader itself (almost never changes),
resources, and application classes (change on every commit) — each becoming its own Docker layer:

```dockerfile
FROM eclipse-temurin:21-jdk-alpine AS build
WORKDIR /workspace
COPY . .
RUN ./mvnw package -DskipTests -B
RUN java -Djarmode=layertools -jar target/payment-service-*.jar extract --destination extracted

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY --from=build /workspace/extracted/dependencies/ ./
COPY --from=build /workspace/extracted/spring-boot-loader/ ./
COPY --from=build /workspace/extracted/snapshot-dependencies/ ./
COPY --from=build /workspace/extracted/application/ ./
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75.0", "org.springframework.boot.loader.launch.JarLauncher"]
```

Because each `COPY` becomes its own Docker layer, a code-only change invalidates and re-pushes only
the `application/` layer — typically a few kilobytes — while the `dependencies/` layer (often tens
or hundreds of megabytes) stays cached and unchanged across the fleet. On a platform where CI is
building and pushing images dozens of times a day, this is a genuine, measurable speed win worth
naming explicitly in an interview, not a micro-optimization — it's the difference between a multi-
minute image push per deploy and a near-instant one.

Configuration belongs outside the image entirely, for the same reason Topic 1's discussion of
profile and property precedence exists: environment variables sit above `application.yml` in
Spring's property-source resolution order, which is precisely the mechanism that makes externalized-
by-default configuration work without any custom plumbing. The same image built once in CI runs
unmodified in staging and production; what differs is what Kubernetes injects at deploy time — a
`ConfigMap` for non-sensitive values, a `Secret` for credentials, both surfaced as environment
variables:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-service
spec:
  replicas: 4
  selector:
    matchLabels:
      app: payment-service
  template:
    metadata:
      labels:
        app: payment-service
    spec:
      containers:
        - name: payment-service
          image: registry.acme.internal/payment-service:1.42.0
          ports:
            - containerPort: 8080
            - containerPort: 9001  # actuator management port, per Topic 12
          envFrom:
            - configMapRef:
                name: payment-service-config
            - secretRef:
                name: payment-service-secrets
          resources:
            requests:
              memory: "512Mi"
              cpu: "250m"
            limits:
              memory: "512Mi"
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: 9001
            initialDelaySeconds: 20
            periodSeconds: 10
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: 9001
            initialDelaySeconds: 15
            periodSeconds: 5
            failureThreshold: 6
```

This wires directly back to Topic 12: liveness and readiness are pointed at two distinct Actuator
endpoints on the separate management port, with a longer failure budget on readiness
(`failureThreshold: 6` at 5-second intervals gives 30 seconds of grace) than on liveness, reflecting
that a slow-but-healthy startup should be tolerated, not punished with a restart.

The last piece — JVM memory tuning inside a container — is a specific, well-documented trap: a
hardcoded `-Xmx512m` doesn't know anything about the container's actual memory limit set in the
Deployment's `resources.limits.memory`. If someone bumps the pod's memory limit to 1Gi during a
capacity fix but forgets the hardcoded `-Xmx` (a very easy thing to forget, since they live in two
different files owned by two different teams), the JVM heap stays capped at its old value and never
uses the memory it was actually given — wasted capacity, more frequent GC pauses than necessary. Go
the other direction — a hardcoded `-Xmx` set *higher* than the container's actual limit — and the
JVM will happily try to grow its heap past what the container is allowed to use, and the kernel's
cgroup OOM killer terminates the container outright, which shows up as a mysterious `OOMKilled` pod
restart that doesn't correlate cleanly with a Java-level `OutOfMemoryError` in the logs (because the
JVM never got the chance to throw one — the container was killed out from under it).
`-XX:MaxRAMPercentage=75.0`, used in both Dockerfiles above, tells the JVM to size its heap as a
percentage of whatever memory the container actually has available (modern JVMs are cgroup-aware and
read the container's limit directly), so the same image adapts correctly whether it's deployed with
a 512Mi limit or a 2Gi limit, with no coordination required between the Dockerfile and the
Deployment YAML.

| Approach | Adapts to container limit changes | Risk if limit changes without a matching code change | When it's actually fine |
|---|---|---|---|
| Hardcoded `-Xmx512m` | No | Wastes allocated memory (limit raised) or OOM-kill (limit lowered below heap need) | Never, for anything deployed to Kubernetes |
| `-XX:MaxRAMPercentage=75.0` | Yes, reads cgroup limit automatically | None — heap sizes itself off the container's actual limit | Standard default for containerized Spring Boot |
| `-XX:+UseContainerSupport` (on by default, modern JVMs) | Enables the above cgroup-awareness | N/A — prerequisite, not an alternative | Always leave enabled; only relevant on very old JVM versions where it needed explicit opt-in |

\</details>

### Interview Questions

**Why use a multi-stage Dockerfile instead of just building the jar with Maven locally or in CI and copying it into a single-stage image?** A multi-stage build gets you both benefits at once: the *build* stage still runs the full JDK and Maven/Gradle exactly as a "build locally, copy the jar" workflow would, but because it's a separate stage, none of that tooling — the JDK versus a slimmer JRE, Maven itself, the full dependency-resolution cache, the source tree — makes it into the final image; only the `COPY --from=build` step pulls the compiled artifact across. This gives you a reproducible, CI-agnostic build (the Dockerfile itself defines exactly how the jar gets built, so it doesn't depend on whatever happens to be installed on a CI runner) while still producing a minimal runtime image, which matters for both image pull time during rolling deploys and reduced attack surface — a JRE-only production image simply doesn't have a Maven binary or build-time dependency jars that could carry known CVEs.

**What specific CI/CD problem do Spring Boot layered jars solve, and how?** They solve slow image pushes/pulls on high-frequency deploys. A default fat jar treats the whole application-plus-dependencies bundle as one file; Docker layer caching operates at the file level, so any change anywhere in that jar — even a one-line application code change — invalidates the entire layer and forces a full re-push and re-pull of the whole jar across the cluster, even though the dependency jars (typically the overwhelming majority of the bytes) didn't actually change. The layered jar feature explodes the archive into separate layers by change frequency — dependencies, the Spring Boot loader, resources, application classes — each becoming its own Docker layer via separate `COPY` instructions, so Docker's content-addressable layer cache correctly identifies that only the small application-classes layer changed and reuses the cached, unchanged dependency layers. On a service deploying multiple times a day, this turns a multi-minute image transfer into a near-instant one for the common case of a code-only change.

**Why does using environment variables and ConfigMaps/Secrets for configuration work seamlessly with Spring Boot without extra plumbing?** Because it rides directly on Spring's existing property-source precedence order (covered for profiles generally elsewhere in this study set) — environment variables are, by default, resolved at a higher precedence than `application.yml`/`application.properties` bundled in the jar. Kubernetes' `envFrom` with a `configMapRef`/`secretRef` injects values as environment variables into the container process, and Spring's `Environment` abstraction picks those up automatically at startup with zero custom code, silently overriding whatever default is baked into the packaged `application.yml`. This is what lets exactly the same built image — the same jar, the same Docker image tag — run correctly in staging and production without any environment-specific branching baked into the artifact itself; the environment difference lives entirely in Kubernetes-managed config, not in the image.

**A pod keeps getting `OOMKilled` even though the application's logs never show an `OutOfMemoryError`. What's the likely cause and fix?** This is the classic symptom of the JVM heap being allowed to grow larger than the container's cgroup memory limit — typically because of a hardcoded `-Xmx` value that was sized without regard to (or set higher than) the `resources.limits.memory` in the Deployment spec, or an older JVM that isn't cgroup-aware and is instead sizing its default heap off the host machine's total memory rather than the container's actual allocation. The container's kernel-level cgroup OOM killer terminates the process the instant it exceeds the memory limit, which happens below the JVM's own heap-management layer — so the JVM never gets the chance to detect memory pressure and throw a catchable `OutOfMemoryError`; from the application's perspective it just vanishes. The fix is `-XX:MaxRAMPercentage` (typically 70–80%, leaving headroom for non-heap JVM memory like metaspace and thread stacks) instead of a hardcoded `-Xmx`, which sizes the heap as a percentage of whatever memory the container is actually given, so it self-adjusts correctly whenever the deployment's memory limit changes without needing a matching code or image change.

**Why point liveness and readiness probes at two different Actuator paths and give readiness a longer failure-tolerance budget?** This directly operationalizes the liveness/readiness distinction from Topic 12: liveness should reflect whether the process itself is fundamentally broken (justifying a restart), while readiness should reflect whether it's currently able to serve traffic (justifying only removal from the load balancer, not a restart). Giving readiness a longer `initialDelaySeconds`/`failureThreshold` budget than liveness acknowledges that a legitimately healthy startup — warming a cache, establishing downstream connections — can take meaningfully longer than the process simply being "up," and that tolerance should live on the probe that only affects traffic routing, not the one that can trigger a restart. Getting this backwards, or using one endpoint for both probes with a short shared timeout, is exactly the crash-loop failure mode worked through in Topic 12's staff-engineer scenario — a slow-but-healthy startup gets misread as a crash and killed before it ever finishes.

---

\<a id="topic-17">\</a>

## Topic 17 — Common Spring Boot Interview Traps (Synthesis)

### 30-second answer

Most Spring interview traps come from proxy behavior, hidden defaults, transaction boundaries, blocking calls, and production configuration.

### Why interviewers ask this

They want to see whether you can recognize failure patterns quickly.

### Key points

- Know proxy limitations.
- Know transaction and lazy-loading pitfalls.
- Know client timeout/resilience requirements.
- Know config and actuator security risks.
- Know Kubernetes deployment interactions.

### Common traps

- Memorizing annotations without mechanics.
- Ignoring production defaults.
- Assuming framework behavior is magic.
- Missing hidden coupling between services.

### Senior-level answer

Answer Spring questions by explaining the mechanism, the failure mode, and the production-safe design. That is the senior signal.


\<details>
\<summary>\<strong>Deep dive notes\</strong>\</summary>

Everything above is real material, but a Staff-level interview usually isn't testing whether you can
recite what `@Transactional` does — it's testing whether you've been burned by the gap between what
the annotation promises and what actually happens at runtime. That gap is where the recurring traps
live, and they're worth holding in your head as one compact list, because interviewers reuse them
precisely because they separate "has used Spring Boot" from "has debugged Spring Boot in production
at 2am."

The **`@Transactional` self-invocation trap** (Topic 4) is the most classic: `@Transactional` works
via a dynamic proxy Spring wraps around your bean, and that proxy only intercepts calls that come in
from *outside* the bean — a call from one method to another method on `this`, within the same class,
bypasses the proxy entirely and runs with no transaction at all, silently. The tell in an interview
is a candidate who can define the annotation but has never actually watched a "transactional" method
quietly not roll back because it was called internally rather than through the bean's public
interface. The **circular-dependency-via-constructor-injection trap** (Topic 2) is the flip side of
Spring's best practice: constructor injection is universally recommended over field injection
specifically because it fails fast — a circular dependency between two beans throws at context
startup instead of manifesting as a mysterious `null` field discovered at 2am in production, which
is exactly what field injection with `@Autowired` allows to slip through (Spring can sometimes
resolve circularity there via early-reference proxies, hiding a design smell that should have been a
startup failure).

**Liveness-versus-readiness confusion causing crash loops** (Topic 12) and **publishing a Kafka event inside versus after a DB transaction without an outbox** (Topic 15, cross-referencing kafka-deep-dive.md's Lesson 27) are both instances of the same deeper pattern: two systems that don't share a transaction boundary, treated as if they do. Wiring both Kubernetes probes to one endpoint assumes "healthy" and "ready for traffic" are the same fact; publishing inside a `@Transactional` method assumes "about to commit" and "committed" are the same fact. Neither assumption holds, and both failures are invisible in code review — they only show up under real timing conditions in production, which is exactly why interviewers like asking about them: they test whether you think about failure windows, not just happy-path correctness.

**Unauthenticated Actuator endpoints** (Topic 12) is the security-hygiene entry on the list, and it's dangerous precisely because it's not a logic bug — the code works exactly as designed, the design itself just assumed a network boundary that a misconfigured ingress or an internal-network compromise can erase. It's the reminder that "it's on an internal port" is a claim about topology, not a security control, and defense in depth (separate management port *and* authentication) is what actually holds when one layer fails.

The **N+1 query problem** (Topic 4) is the trap most likely to survive code review undetected,
because the code that causes it looks completely idiomatic — a `for` loop over a list of `Payment`
entities calling `payment.getMerchant().getName()`, with lazy-loaded JPA associations quietly firing
one extra `SELECT` per iteration. It passes every unit test against a fixture with three rows and
turns into thousands of round trips against production data, which is why it's such a good interview
probe: it tests whether a candidate thinks about what their ORM is actually doing at the SQL level,
not just whether the Java compiles.

Finally, the **resilience-annotation composition-order gotcha** (Topic 10) — stacking `@Retry`,
`@CircuitBreaker`, and `@RateLimiter` on the same method and getting a materially different (and
often wrong) behavior depending on the order Resilience4j applies them, because retry wrapped
outside a circuit breaker means retries keep hammering an already-open circuit's short-circuit path,
while the reverse ordering means the circuit breaker sees retries as separate calls and never opens
when it should. It's a small configuration detail with an outsized production consequence, and it's
the kind of thing that only becomes obvious once you've watched a "resilient" service make an outage
worse instead of better.

None of these are exotic — every one of them is a mainstream Spring Boot feature used exactly as
documented. What makes them interview-worthy is that the documentation describes the happy path, and
production is where the edge cases live. That's the actual thing a Staff Engineer interview is
probing for: not whether you know the annotations, but whether you've internalized where each one
quietly stops doing what its name implies.

\</details>
