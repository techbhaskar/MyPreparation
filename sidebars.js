// @ts-check

const sidebars = {
  guideSidebar: [
    {
      type: 'category',
      label: 'Start Here',
      collapsed: false,
      items: [
        'INDEX',
        'senior-java-architect-quick-revision',
        'java-simple-explanations-for-interviews'
      ]
    },
    {
      type: 'category',
      label: 'Foundation',
      collapsed: false,
      items: [
        'architecture-building-blocks',
        'distributed-systems-fundamentals',
        'reliability-resilience-production-engineering'
      ]
    },
    {
      type: 'category',
      label: 'Architecture',
      collapsed: false,
      items: [
        'hld-foundations',
        '05a-hld-mastery-level1-2-foundation-and-scale',
        '05b-hld-mastery-level3-4-async-and-realtime',
        '05c-hld-mastery-level5-6-marketplace-and-fintech',
        '05d-hld-mastery-level7-large-scale-architecture',
        'staff-principal-architecture'
      ]
    },
    {
      type: 'category',
      label: 'Low-Level Design',
      collapsed: false,
      items: [
        'lld-foundations',
        '07a-lld-design-patterns',
        '07b-lld-practice-problems'
      ]
    },
    {
      type: 'category',
      label: 'Deep Dives',
      collapsed: false,
      items: [
        'java-core-jvm-deep-dive',
        'spring-boot-microservices-deep-dive',
        'kafka-deep-dive'
      ]
    },
    {
      type: 'category',
      label: 'Interview',
      collapsed: false,
      items: ['interview-mastery']
    }
  ]
};

module.exports = sidebars;
