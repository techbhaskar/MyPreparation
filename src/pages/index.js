import React from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import styles from './index.module.css';

function HeroSection() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <div className={styles.heroContainer}>
      <div className={styles.heroSplit}>
        {/* Left Column: Hero Headline & Actions */}
        <div className={styles.heroLeft}>
          <div className={styles.heroBadge}>
            <span>✨ Senior / Staff System Design Roadmap</span>
          </div>
          <h1 className={styles.heroTitle}>
            Master System Design & Architecture
          </h1>
          <p className={styles.heroSubtitle}>
            An enterprise-grade study curriculum and interview roadmap tailored for Senior, Staff, and Principal Engineers preparing for Group-1 & high-scale architecture interviews.
          </p>

          <div className={styles.heroActions}>
            <Link className={styles.btnPrimary} to="/roadmap">
              Explore Roadmap →
            </Link>
            <Link className={styles.btnSecondary} to="/10-senior-java-architect-quick-revision">
              ⚡ 15-Min Quick Revision
            </Link>
          </div>

          <div className={styles.heroStatsRow}>
            <div className={styles.statItem}>
              <span className={styles.statNum}>9</span>
              <span className={styles.statText}>Core Stages</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statNum}>19+</span>
              <span className={styles.statText}>Modules</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statNum}>17</span>
              <span className={styles.statText}>GoF Patterns</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statNum}>Group-1</span>
              <span className={styles.statText}>Fintech Ready</span>
            </div>
          </div>
        </div>

        {/* Right Column: Architecture Diagram Interactive Preview Card */}
        <div className={styles.diagramCard}>
          <div className={styles.diagramTitle}>
            <span>Architecture Preview: High Scale Microservices</span>
            <div className={styles.diagramStatus}>
              <span className={styles.statusDot}></span>
              <span>Live System</span>
            </div>
          </div>

          <div className={styles.nodeFlowGrid}>
            <div className={styles.flowRow}>
              <div className={styles.archNode}>
                <span className={styles.archIcon}>🌐</span> Client / CDN
              </div>
              <div className={styles.connectorLine}></div>
              <div className={styles.archNode}>
                <span className={styles.archIcon}>🛡️</span> API Gateway
              </div>
            </div>

            <div className={styles.flowRow}>
              <div className={styles.archNode}>
                <span className={styles.archIcon}>⚡</span> Kafka Bus
              </div>
              <div className={styles.connectorLine}></div>
              <div className={styles.archNode}>
                <span className={styles.archIcon}>⚙️</span> Microservices
              </div>
            </div>

            <div className={styles.flowRow}>
              <div className={styles.archNode}>
                <span className={styles.archIcon}>💳</span> Ledger & DB
              </div>
              <div className={styles.connectorLine}></div>
              <div className={styles.archNode}>
                <span className={styles.archIcon}>🚀</span> Redis Cache
              </div>
            </div>
          </div>

          <div className={styles.heroCodeBox}>
            <div className={styles.codeHeader}>
              <span>// CircuitBreaker & Resiliency Pattern</span>
              <span>Java 21 / Spring Boot</span>
            </div>
            <code>
              {`@CircuitBreaker(name = "paymentService", fallbackMethod = "fallbackPayment")\npublic PaymentResult processTransaction(OrderRequest req) {\n    return paymentGateway.charge(req.getAmount());\n}`}
            </code>
          </div>
        </div>
      </div>
    </div>
  );
}

function BentoCurriculumSection() {
  const bentoItems = [
    {
      icon: '🏛️',
      stage: 'STAGE 1–3',
      title: 'Foundation & Production Engineering',
      desc: 'Master networking flow, consistency models, failure thinking, and high-availability production engineering.',
      progress: 100,
      tags: ['CAP Theorem', 'Load Balancers', 'SLI/SLO/SLA', 'Resilience'],
      links: [
        { label: '01 — Architecture Building Blocks', path: '/01-architecture-building-blocks' },
        { label: '02 — Distributed Systems Fundamentals', path: '/02-distributed-systems-fundamentals' },
        { label: '03 — Reliability & Production Engineering', path: '/03-reliability-resilience-production-engineering' },
      ],
    },
    {
      icon: '📐',
      stage: 'STAGE 4–5',
      title: 'High-Level Design (HLD) Mastery',
      desc: 'Capacity estimation, API contracts, notification platforms, webhooks, live location, and collaborative editing.',
      progress: 90,
      tags: ['Rate Limiter', 'URL Shortener', 'Distributed Cache', 'Metrics'],
      links: [
        { label: '04 — HLD Foundations & Capacity', path: '/04-hld-foundations' },
        { label: '05a — HLD Level 1–2: Foundation & Scale', path: '/05a-hld-mastery-level1-2-foundation-and-scale' },
        { label: '05b — HLD Level 3–4: Async & Realtime', path: '/05b-hld-mastery-level3-4-async-and-realtime' },
        { label: '05d — HLD Level 7: Multi-Region Architecture', path: '/05d-hld-mastery-level7-large-scale-architecture' },
      ],
    },
    {
      icon: '💳',
      stage: 'STAGE 5c SPECIAL',
      title: 'Marketplace & Fintech Infrastructure',
      desc: 'Crucial for PayPal, Visa, and E-commerce interviews: Payment gateways, wallets, ledgers, & fraud pipelines.',
      progress: 100,
      tags: ['Double-Entry Ledger', 'Idempotency', 'Payment Gateway', 'Fraud'],
      links: [
        { label: '05c — Fintech, Ledgers & Payment Systems', path: '/05c-hld-mastery-level5-6-marketplace-and-fintech' },
      ],
    },
    {
      icon: '🧱',
      stage: 'STAGE 6–7',
      title: 'Software & Low-Level Design (LLD)',
      desc: 'OOP & SOLID with before/after code, all 17 GoF Design Patterns, plus 13 production LLD practice problems.',
      progress: 85,
      tags: ['SOLID Principles', '17 GoF Patterns', 'Parking Lot', 'Elevator'],
      links: [
        { label: '06 — LLD Foundations & SOLID', path: '/06-lld-foundations' },
        { label: '07a — All 17 GoF Design Patterns', path: '/07a-lld-design-patterns' },
        { label: '07b — LLD Practice Problems', path: '/07b-lld-practice-problems' },
      ],
    },
    {
      icon: '⚡',
      stage: 'DEEP DIVES',
      title: 'Core Technologies & Enterprise Frameworks',
      desc: 'Deep multi-topic curriculums for Apache Kafka (~36k words), Spring Boot Microservices, and Core Java/JVM concurrency.',
      progress: 95,
      tags: ['Kafka Internals', 'Spring Microservices', 'JVM Tuning', 'Virtual Threads'],
      links: [
        { label: 'Apache Kafka Deep Dive', path: '/kafka-deep-dive' },
        { label: 'Spring Boot & Microservices Deep Dive', path: '/spring-boot-microservices-deep-dive' },
        { label: 'Core Java & JVM Deep Dive', path: '/java-core-jvm-deep-dive' },
        { label: 'Simple Explanations for Interviews', path: '/11-java-simple-explanations-for-interviews' },
      ],
    },
    {
      icon: '🎯',
      stage: 'STAGE 8–9',
      title: 'Staff Architecture & Interview Mastery',
      desc: 'Staff/Principal level trade-off thinking, governance/ADRs, whiteboarding techniques, and mock rubrics.',
      progress: 90,
      tags: ['Trade-offs', 'ADR Governance', 'Whiteboarding', 'Mock Rubrics'],
      links: [
        { label: '08 — Staff & Principal Architecture', path: '/08-staff-principal-architecture' },
        { label: '09 — Interview Mastery & Whiteboarding', path: '/09-interview-mastery' },
        { label: '10 — 15-Minute Quick Revision', path: '/10-senior-java-architect-quick-revision' },
      ],
    },
  ];

  return (
    <section className={styles.bentoSection}>
      <div className={styles.bentoHeader}>
        <div className={styles.bentoTag}>Curriculum Bento Grid</div>
        <h2 className={styles.bentoTitle}>Structured Architectural Learning Path</h2>
        <p className={styles.bentoDesc}>
          Explore the 9 core stages designed to take you from foundational building blocks to Staff Architect mastery.
        </p>
      </div>

      <div className={styles.bentoGrid}>
        {bentoItems.map((item, idx) => (
          <div key={idx} className={styles.bentoCard}>
            <div>
              <div className={styles.cardHead}>
                <div className={styles.cardIcon}>{item.icon}</div>
                <span className={styles.stageBadge}>{item.stage}</span>
              </div>
              <h3 className={styles.cardTitle}>{item.title}</h3>
              <p className={styles.cardText}>{item.desc}</p>

              {/* Progress bar */}
              <div className={styles.progressWidget}>
                <div className={styles.progressLabelRow}>
                  <span>Completion Coverage</span>
                  <span>{item.progress}%</span>
                </div>
                <div className={styles.progressBarBg}>
                  <div className={styles.progressBarFill} style={{ width: `${item.progress}%` }}></div>
                </div>
              </div>

              {/* Topic tags */}
              <div className={styles.topicTagGrid}>
                {item.tags.map((tag, tidx) => (
                  <span key={tidx} className={styles.topicTag}>
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            {/* Links column */}
            <div className={styles.topicLinksColumn}>
              {item.links.map((link, lidx) => (
                <Link key={lidx} className={styles.docLink} to={link.path}>
                  ➔ {link.label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function Home() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout
      title={`${siteConfig.title}`}
      description="Enterprise System Design, Distributed Systems, LLD, and Architecture Interview Preparation">
      <HeroSection />
      <main>
        <BentoCurriculumSection />
      </main>
    </Layout>
  );
}
