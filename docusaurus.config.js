// @ts-check

const config = {
  title: 'MyPreparation — Senior & Staff System Design',
  tagline: 'Enterprise System Design, Distributed Systems, LLD, and Architecture Interview Preparation',
  favicon: 'img/favicon.ico',

  url: 'https://techbhaskar.github.io',
  baseUrl: '/MyPreparation/',
  organizationName: 'techbhaskar',
  projectName: 'MyPreparation',
  trailingSlash: false,

  onBrokenLinks: 'warn',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn'
    }
  },

  stylesheets: [
    {
      href: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,400..700;1,400..700&family=Plus+Jakarta+Sans:ital,wght@0,400..800;1,400..800&display=swap',
      type: 'text/css',
    },
  ],

  i18n: {
    defaultLocale: 'en',
    locales: ['en']
  },

  presets: [
    [
      'classic',
      {
        docs: {
          routeBasePath: '/',
          sidebarPath: require.resolve('./sidebars.js')
        },
        blog: false,
        theme: {
          customCss: require.resolve('./src/css/custom.css')
        }
      }
    ]
  ],

  themeConfig: {
    colorMode: {
      defaultMode: 'dark',
      disableSwitch: false,
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'MyPreparation',
      logo: {
        alt: 'MyPreparation Logo',
        src: 'img/logo.svg',
        srcDark: 'img/logo.svg',
      },
      items: [
        {
          to: '/roadmap',
          position: 'left',
          label: 'Study Roadmap',
        },
        {
          to: '/04-hld-foundations',
          position: 'left',
          label: 'HLD',
        },
        {
          to: '/06-lld-foundations',
          position: 'left',
          label: 'LLD',
        },
        {
          to: '/kafka-deep-dive',
          position: 'left',
          label: 'Deep Dives',
        },
        {
          to: '/10-senior-java-architect-quick-revision',
          position: 'left',
          label: '⚡ Quick Revision',
        },
        {
          to: '/resume',
          position: 'right',
          label: 'Resume',
        },
        {
          href: 'https://github.com/techbhaskar/MyPreparation',
          label: 'GitHub',
          position: 'right',
          className: 'header-github-link',
        }
      ]
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Roadmap Stages',
          items: [
            { label: 'Foundation & Building Blocks', to: '/01-architecture-building-blocks' },
            { label: 'Distributed Systems', to: '/02-distributed-systems-fundamentals' },
            { label: 'High-Level Design (HLD)', to: '/04-hld-foundations' },
            { label: 'Low-Level Design (LLD)', to: '/06-lld-foundations' },
          ],
        },
        {
          title: 'Deep Dives',
          items: [
            { label: 'Core Java & JVM', to: '/java-core-jvm-deep-dive' },
            { label: 'Spring Boot Microservices', to: '/spring-boot-microservices-deep-dive' },
            { label: 'Apache Kafka Mastery', to: '/kafka-deep-dive' },
            { label: 'Fintech & Payment Systems', to: '/05c-hld-mastery-level5-6-marketplace-and-fintech' },
          ],
        },
        {
          title: 'Community & Source',
          items: [
            { label: 'GitHub Repository', href: 'https://github.com/techbhaskar/MyPreparation' },
            { label: 'Interview Mastery Guide', to: '/09-interview-mastery' },
            { label: 'Staff Architect Track', to: '/08-staff-principal-architecture' },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} @techbhaskar. Built with Docusaurus for Senior & Staff Engineers.`
    },
    prism: {
      additionalLanguages: ['java', 'bash', 'json', 'yaml', 'docker', 'sql', 'mermaid']
    }
  }
};

module.exports = config;
