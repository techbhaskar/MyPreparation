// @ts-check

const config = {
  title: 'Senior/Staff System Design Study Guide',
  tagline: 'Java, architecture, distributed systems, and interview preparation',
  favicon: 'img/favicon.ico',

  url: 'https://techbhaskar.github.io',
  baseUrl: '/MyPreparation/',
  organizationName: 'techbhaskar',
  projectName: 'MyPreparation',
  trailingSlash: false,

  onBrokenLinks: 'throw',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn'
    }
  },

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
    navbar: {
      title: 'MyPreparation',
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'guideSidebar',
          position: 'left',
          label: 'Study Guide'
        },
        {
          href: 'https://github.com/techbhaskar/MyPreparation',
          label: 'GitHub',
          position: 'right'
        }
      ]
    },
    footer: {
      style: 'light',
      copyright: `Copyright © ${new Date().getFullYear()} @techbhaskar. Built with Docusaurus.`
    },
    prism: {
      additionalLanguages: ['java', 'bash', 'json', 'yaml']
    }
  }
};

module.exports = config;
