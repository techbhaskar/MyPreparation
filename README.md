# MyPreparation

Senior/Staff system design, Java, Spring Boot, Kafka, LLD, and interview-preparation notes published as a Docusaurus site.

Live site:

https://techbhaskar.github.io/MyPreparation/

## Prerequisites

- Node.js 18 or later
- npm
- GitHub Pages enabled for this repository with **Source: GitHub Actions**

## Install Dependencies

Run this once after cloning the repository:

```bash
npm install
```

For CI or a clean reproducible install, use:

```bash
npm ci
```

## Run Locally

Start the Docusaurus development server:

```bash
npm start
```

Open the local URL printed by Docusaurus. By default it is usually:

```text
http://localhost:3000/MyPreparation/
```

## Build Production Site

Generate the static production site:

```bash
npm run build
```

The generated site is written to:

```text
build/
```

## Preview Production Build Locally

After building, serve the generated static site:

```bash
npm run serve -- --host 0.0.0.0 --port 3000
```

Then open:

```text
http://localhost:3000/MyPreparation/
```

## Deploy To GitHub Pages

Deployment is handled by GitHub Actions in:

```text
.github/workflows/static.yml
```

The workflow runs automatically when changes are pushed to `master`.

Deployment steps performed by GitHub Actions:

1. Checkout repository
2. Setup Node.js 20
3. Install dependencies with `npm ci`
4. Build Docusaurus with `npm run build`
5. Upload the `build/` directory as the Pages artifact
6. Deploy to GitHub Pages

To deploy manually:

1. Open the repository on GitHub
2. Go to **Actions**
3. Select **Deploy Docusaurus site to Pages**
4. Click **Run workflow**

## Repository Structure

```text
docs/                    Study-guide Markdown files rendered by Docusaurus
src/css/custom.css        Site-level Docusaurus styling
docusaurus.config.js      Docusaurus site configuration
sidebars.js               Docs sidebar structure
package.json              npm scripts and dependencies
package-lock.json         Locked dependency versions for reproducible builds
.github/workflows/        GitHub Pages deployment workflow
```

## Study Guide Index

Start with the rendered Docusaurus homepage or the source index:

- [Full Study Index](docs/00-INDEX.md)
- [Quick Revision](docs/10-senior-java-architect-quick-revision.md)
- [Interview Mastery](docs/09-interview-mastery.md)

## Main Curriculum

| Stage | Source |
|---|---|
| 1 — Architecture Building Blocks | [docs/01-architecture-building-blocks.md](docs/01-architecture-building-blocks.md) |
| 2 — Distributed Systems Fundamentals | [docs/02-distributed-systems-fundamentals.md](docs/02-distributed-systems-fundamentals.md) |
| 3 — Reliability, Resilience & Production Engineering | [docs/03-reliability-resilience-production-engineering.md](docs/03-reliability-resilience-production-engineering.md) |
| 4 — HLD Foundations | [docs/04-hld-foundations.md](docs/04-hld-foundations.md) |
| 5 — HLD Mastery Level 1-2 | [docs/05a-hld-mastery-level1-2-foundation-and-scale.md](docs/05a-hld-mastery-level1-2-foundation-and-scale.md) |
| 5 — HLD Mastery Level 3-4 | [docs/05b-hld-mastery-level3-4-async-and-realtime.md](docs/05b-hld-mastery-level3-4-async-and-realtime.md) |
| 5 — HLD Mastery Level 5-6 | [docs/05c-hld-mastery-level5-6-marketplace-and-fintech.md](docs/05c-hld-mastery-level5-6-marketplace-and-fintech.md) |
| 5 — HLD Mastery Level 7 | [docs/05d-hld-mastery-level7-large-scale-architecture.md](docs/05d-hld-mastery-level7-large-scale-architecture.md) |
| 6 — LLD Foundations | [docs/06-lld-foundations.md](docs/06-lld-foundations.md) |
| 7 — LLD Design Patterns | [docs/07a-lld-design-patterns.md](docs/07a-lld-design-patterns.md) |
| 7 — LLD Practice Problems | [docs/07b-lld-practice-problems.md](docs/07b-lld-practice-problems.md) |
| 8 — Staff/Principal Architecture | [docs/08-staff-principal-architecture.md](docs/08-staff-principal-architecture.md) |
| 9 — Interview Mastery | [docs/09-interview-mastery.md](docs/09-interview-mastery.md) |
| 10 — Quick Revision | [docs/10-senior-java-architect-quick-revision.md](docs/10-senior-java-architect-quick-revision.md) |
| 11 — Java/Spring/Architecture Simple Explanations | [docs/11-java-simple-explanations-for-interviews.md](docs/11-java-simple-explanations-for-interviews.md) |

## Supplementary Deep Dives

- [Kafka Deep Dive](docs/kafka-deep-dive.md)
- [Spring Boot Microservices Deep Dive](docs/spring-boot-microservices-deep-dive.md)
- [Core Java & JVM Deep Dive](docs/java-core-jvm-deep-dive.md)

## Notes

- `build/`, `.docusaurus/`, and `node_modules/` are generated locally and should not be committed.
- Docusaurus may warn about old internal anchors during build. The site still builds and deploys successfully.

## License

This study guide is licensed under the Creative Commons Attribution 4.0 International License.

See [LICENSE](LICENSE).
