import React from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import styles from './index.module.css';

function HomepageHeader() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <header className={styles.heroBanner}>
      <div className={styles.heroContent}>
        <div className={styles.heroBadge}>
          <span>✨ Senior / Staff System Design Roadmap 2026</span>
        </div>
        <h1 className={styles.heroTitle}>
          Master System Design, Distributed Systems & Low-Level Design
        </h1>
        <p className={styles.heroSubtitle}>
          An enterprise-grade study curriculum tailored for Senior, Staff, and Principal Engineers preparing for Group-1 & high-scale architecture interviews.
        </p>
        <div className={styles.heroActions}>
          <Link className={styles.btnPrimary} to="/roadmap">
            Explore Study Roadmap →
          </Link>
          <Link className={styles.btnSecondary} to="/10-senior-java-architect-quick-revision">
            Quick Revision (17-Yr Lead)
          </Link>
        </div>

        {/* Live Metrics Grid */}
        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <div className={styles.statNumber}>9</div>
            <div className={styles.statLabel}>Core Stages</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statNumber}>19+</div>
            <div className={styles.statLabel}>Comprehensive Modules</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statNumber}>17</div>
            <div className={styles.statLabel}>GoF Patterns & LLD</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statNumber}>Group-1</div>
            <div className={styles.statLabel}>Interview Ready</div>
          </div>
        </div>
      </div>
    </header>
  );
}

function CurriculumSection() {
  const categories = [
    {
      icon: 'I',
      stage: 'Stages 1–3',
      title: 'Foundation & Production',
      desc: 'Master building blocks, consistency models, failure thinking, and high-availability production engineering.',
      topics: [
        { label: '01 — Architecture Building Blocks', path: '/01-architecture-building-blocks' },
        { label: '02 — Distributed Systems Fundamentals', path: '/02-distributed-systems-fundamentals' },
        { label: '03 — Reliability & Production Engineering', path: '/03-reliability-resilience-production-engineering' },
      ],
    },
    {
      icon: 'H',
      stage: 'Stages 4–5',
      title: 'High-Level Design (HLD)',
      desc: 'Capacity estimation, API contracts, notification platforms, webhooks, live location, collaborative editing.',
      topics: [
        { label: '04 — HLD Foundations & Capacity', path: '/04-hld-foundations' },
        { label: '05a — HLD Level 1–2: Foundation & Scale', path: '/05a-hld-mastery-level1-2-foundation-and-scale' },
        { label: '05b — HLD Level 3–4: Async & Realtime', path: '/05b-hld-mastery-level3-4-async-and-realtime' },
        { label: '05d — HLD Level 7: Multi-Region Architecture', path: '/05d-hld-mastery-level7-large-scale-architecture' },
      ],
    },
    {
      icon: 'P',
      stage: 'Stage 5c Special',
      title: 'Marketplace & Fintech HLD',
      desc: 'Essential for PayPal, Visa, and E-commerce interviews: Payment gateways, wallets, ledgers, & fraud pipelines.',
      topics: [
        { label: '05c — Fintech, Ledgers & Payment Systems', path: '/05c-hld-mastery-level5-6-marketplace-and-fintech' },
      ],
    },
    {
      icon: 'L',
      stage: 'Stages 6–7',
      title: 'Software & Low-Level Design (LLD)',
      desc: 'OOP & SOLID with before/after code, all 17 GoF Design Patterns, plus 13 production LLD practice problems.',
      topics: [
        { label: '06 — LLD Foundations & SOLID', path: '/06-lld-foundations' },
        { label: '07a — All 17 GoF Design Patterns', path: '/07a-lld-design-patterns' },
        { label: '07b — LLD Practice Problems (Parking Lot, Cache)', path: '/07b-lld-practice-problems' },
      ],
    },
    {
      icon: 'D',
      stage: 'Deep Dives',
      title: 'Core Technologies & Frameworks',
      desc: 'Deep multi-topic curriculums for Apache Kafka, Spring Boot Microservices, and Core Java/JVM concurrency.',
      topics: [
        { label: 'Kafka Deep Dive (~36k words)', path: '/kafka-deep-dive' },
        { label: 'Spring Boot & Microservices Deep Dive', path: '/spring-boot-microservices-deep-dive' },
        { label: 'Core Java & JVM Deep Dive', path: '/java-core-jvm-deep-dive' },
        { label: 'Simple Explanations for Interviews', path: '/11-java-simple-explanations-for-interviews' },
      ],
    },
    {
      icon: 'S',
      stage: 'Stages 8–9',
      title: 'Seniority & Interview Mastery',
      desc: 'Staff/Principal level trade-off thinking, governance/ADRs, whiteboarding techniques, and mock rubrics.',
      topics: [
        { label: '08 — Staff & Principal Architecture', path: '/08-staff-principal-architecture' },
        { label: '09 — Interview Mastery & Whiteboarding', path: '/09-interview-mastery' },
        { label: '10 — 15-Minute Quick Revision', path: '/10-senior-java-architect-quick-revision' },
      ],
    },
  ];

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionTag}>Curriculum Roadmap</div>
        <h2 className={styles.sectionTitle}>Structured Learning & Revision Path</h2>
        <p className={styles.sectionDesc}>
          Explore the 9-stage system design path designed to take you from core fundamentals to Staff Architect mastery.
        </p>
      </div>

      <div className={styles.cardsGrid}>
        {categories.map((cat, idx) => (
          <div key={idx} className={styles.card}>
            <div className={styles.cardTop}>
              <div className={styles.cardHeaderRow}>
                <div className={styles.cardIcon}>{cat.icon}</div>
                <span className={styles.cardStageBadge}>{cat.stage}</span>
              </div>
              <h3 className={styles.cardTitle}>{cat.title}</h3>
              <p className={styles.cardDescription}>{cat.desc}</p>
              <ul className={styles.topicList}>
                {cat.topics.map((t, tidx) => (
                  <li key={tidx} className={styles.topicItem}>
                    <Link className={styles.topicLink} to={t.path}>
                      ➔ {t.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>

      {/* Specialized Track Banner */}
      <div className={styles.trackBanner}>
        <div className={styles.sectionHeader} style={{ marginBottom: '1rem' }}>
          <div className={styles.sectionTag}>Fast Tracks</div>
          <h2 className={styles.sectionTitle} style={{ fontSize: '1.8rem' }}>Targeted Interview Fast-Lanes</h2>
          <p className={styles.sectionDesc}>Accelerate your preparation based on your upcoming interview format.</p>
        </div>

        <div className={styles.trackGrid}>
          <div className={styles.trackCard}>
            <h4 className={styles.trackCardTitle}>PayPal & Fintech Track</h4>
            <p className={styles.trackCardDesc}>
              Deep focus on Payment Processors, Double-Entry Ledgers, Wallets, Idempotency, Refunds, and Fraud Pipelines.
            </p>
            <Link className={styles.topicLink} to="/05c-hld-mastery-level5-6-marketplace-and-fintech">
              Open Fintech HLD Guide
            </Link>
          </div>

          <div className={styles.trackCard}>
            <h4 className={styles.trackCardTitle}>15-Minute Senior Architect Revision</h4>
            <p className={styles.trackCardDesc}>
              High-signal revision layer for 17-year Java Leads and Architects to quickly review core trade-offs before deep dives.
            </p>
            <Link className={styles.topicLink} to="/10-senior-java-architect-quick-revision">
              Open Quick Revision
            </Link>
          </div>
        </div>
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
      <HomepageHeader />
      <main>
        <CurriculumSection />
      </main>
    </Layout>
  );
}
