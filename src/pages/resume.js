import React from 'react';
import Layout from '@theme/Layout';
import styles from './resume.module.css';

const skills = [
  'Java 8/11/17/21',
  'Spring Boot',
  'Spring',
  'REST APIs',
  'Microservices',
  'Distributed Systems',
  'FinTech',
  'Platform Engineering',
  'MongoDB',
  'Oracle',
  'MySQL',
  'AWS',
  'Azure',
  'GCP',
  'Git',
  'Jenkins',
  'Maven',
  'Splunk',
  'Kibana',
  'Datadog',
  'Grafana',
  'Looker',
  'Angular',
  'React',
  'HTML5',
  'CSS3',
  'JUnit',
  'Mockito',
];

const highlights = [
  '17+ years in Enterprise Java and FinTech.',
  'Technical Lead at Toucan Payments; former Staff Engineer at PayPal through Altimetrik.',
  'Led cross-functional engineering teams of 25+ members.',
  'Expertise in Java 21, Spring Boot, Microservices, REST APIs, and platform modernization.',
  'Strong experience with Splunk, Kibana, Grafana, Looker, and production observability.',
  'Top 5 winner in Altimetrik Ideathon 2023.',
];

const experience = [
  {
    role: 'Technical Lead',
    company: 'Toucan Payments',
    period: 'Mar 2026 - Present',
    points: [
      'Leading development of enterprise payment platform modernization initiatives.',
      'Designing scalable Java 21 and Spring Boot microservices for merchant onboarding, transaction processing, and IAM/UAM.',
      'Driving architecture discussions, API design, secure integrations, and reusable platform components.',
      'Leading sprint execution, code reviews, mentoring developers, and stakeholder collaboration.',
      'Working on API Gateway patterns, centralized authentication, RBAC, and MFA.',
      'Driving production stability through observability, RCA, and engineering best practices.',
    ],
  },
  {
    role: 'Staff Engineer',
    company: 'Altimetrik - PayPal Commerce Platform',
    period: 'Jul 2021 - Dec 2024',
    points: [
      'Owned partner pricing platform enhancements and end-to-end feature delivery.',
      'Designed scalable REST APIs and backend services for the payment partner ecosystem.',
      'Led observability initiatives using Splunk, Kibana, and Looker dashboards.',
      'Performed architecture reviews, mentoring, production support, and incident leadership.',
      'Collaborated with global engineering teams to improve reliability and delivery quality.',
    ],
  },
  {
    role: 'Technical Lead',
    company: 'Break-through Software Solutions',
    period: 'Sep 2014 - Jul 2021',
    points: [
      'Led banking compliance platform delivery for Wells Fargo, Citi, and Deutsche Bank client programs.',
      'Modernized legacy applications to Spring Boot and REST-based services.',
      'Built reusable backend components and modernized UI using Angular and React.',
      'Managed technical design, client discussions, mentoring, and code quality.',
    ],
  },
  {
    role: 'Technical Lead',
    company: 'Tata Consultancy Services',
    period: 'Mar 2011 - Sep 2014',
    points: [
      'Led enterprise ITSM application development and Agile delivery.',
      'Owned technical design, releases, and production support.',
    ],
  },
  {
    role: 'Software Engineer',
    company: 'Cognizant',
    period: 'Feb 2007 - Mar 2011',
    points: [
      'Developed enterprise financial applications for American Express UK.',
    ],
  },
];

const leadership = [
  'Microservices and API-first architecture.',
  'High-level and low-level design.',
  'Platform modernization.',
  'Engineering governance and architecture reviews.',
  'Production incident leadership.',
  'Observability strategy.',
  'Mentoring and technical interviews.',
  'Agile delivery and stakeholder management.',
];

const innovation = [
  {
    name: 'NullGuard',
    description:
      'Open-source Java static analysis engine for null-safety, CFG, call graph analysis, and stability scoring.',
  },
  {
    name: 'SochDB',
    description:
      'AI-native database concept combining SQL, vector search, and contextual memory for LLM applications.',
  },
  {
    name: 'Coverage Analyzer',
    description:
      'Platform for visualizing UI automation coverage and engineering quality metrics.',
  },
  {
    name: 'AI Engineering',
    description:
      'Experiments with RAG, local LLMs, AI agents, and enterprise AI architecture.',
  },
];

function Section({ title, children }) {
  return (
    <section className={styles.section}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export default function Resume() {
  return (
    <Layout
      title="Resume"
      description="Bhaskararao Arani resume - Principal Software Engineer, Solution Architect, Staff Engineer, Technical Lead">
      <main className={styles.page}>
        <section className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>Resume</p>
            <h1>Bhaskararao Arani</h1>
            <p className={styles.subtitle}>
              Principal Software Engineer | Solution Architect | Staff Engineer | Technical Lead
            </p>
            <p className={styles.stackLine}>
              Java · Distributed Systems · FinTech · Platform Engineering
            </p>
          </div>
          <div className={styles.contactCard}>
            <a href="mailto:bhaskara.ee@gmail.com">bhaskara.ee@gmail.com</a>
            <a href="tel:+919550888357">+91 95508 88357</a>
            <a href="https://github.com/techbhaskar">github.com/techbhaskar</a>
            <span>Hyderabad, India</span>
          </div>
        </section>

        <Section title="Executive Summary">
          <p>
            Technical Leader with 17+ years of experience designing, modernizing, and delivering
            enterprise banking and fintech platforms. Currently working as Technical Lead at Toucan
            Payments, leading enterprise payment platform development using Java 21 and Spring Boot.
            Extensive experience across PayPal, American Express, and banking client programs for
            Wells Fargo, Citi, and Deutsche Bank through Break-through Software Solutions. Strong in
            platform engineering, distributed systems, microservices, API design, observability, and
            engineering leadership. Proven ability to mentor teams, drive architecture discussions,
            lead production incident management, and deliver highly available business-critical systems.
          </p>
        </Section>

        <Section title="Career Highlights">
          <ul className={styles.focusList}>
            {highlights.map((highlight) => (
              <li key={highlight}>{highlight}</li>
            ))}
          </ul>
        </Section>

        <Section title="Core Technologies">
          <div className={styles.skillGrid}>
            {skills.map((skill) => (
              <span key={skill}>{skill}</span>
            ))}
          </div>
        </Section>

        <Section title="Professional Experience">
          <div className={styles.timeline}>
            {experience.map((item) => (
              <article key={`${item.role}-${item.company}`} className={styles.timelineItem}>
                <div>
                  <h3>{item.role}</h3>
                  <p className={styles.meta}>{item.company} · {item.period}</p>
                </div>
                <ul>
                  {item.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </Section>

        <Section title="Architecture & Leadership">
          <div className={styles.skillGrid}>
            {leadership.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        </Section>

        <Section title="Open Source & Technical Innovation">
          <div className={styles.projectGrid}>
            {innovation.map((project) => (
              <article key={project.name} className={styles.projectCard}>
                <h3>{project.name}</h3>
                <p>{project.description}</p>
              </article>
            ))}
          </div>
        </Section>

        <Section title="Awards">
          <ul className={styles.focusList}>
            <li>Altimetrik Ideathon 2023 - Top 5 Winner, awarded INR 1,00,000.</li>
            <li>Altimetrik Ideathon 2024 - Innovation Idea Selected.</li>
          </ul>
        </Section>

        <Section title="Certifications">
          <ul className={styles.focusList}>
            <li>Sun Certified Java Programmer (SCJP 1.5).</li>
            <li>Cognizant BFS Domain Level 0 and Level 1.</li>
          </ul>
        </Section>

        <Section title="Education">
          <p>
            Bachelor of Technology in Electrical & Electronics Engineering,
            KM College of Engineering & Technology.
          </p>
        </Section>
      </main>
    </Layout>
  );
}
