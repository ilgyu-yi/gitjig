# Working in gitjig

Audience: coding agents changing this repository. Product users should start with docs/README.md.

The authoritative product requirements are MISSION.md, PRINCIPLES.md, DESIGN.md and CONTRACTS.md. Read the relevant clauses before changing behavior. Task plans and these instructions support those documents; they do not replace them.

- Write working plans, specifications, review records and new repository documentation in English. Communicate with the user in their preferred language. Preserve original requirements alongside their interpretation.
- Use compatible Node >=22.19.0 and locked dependencies; .node-version selects the development reference. Reproducible offline bundles retain their exact runtime pin. Prefer public Pi SDK facilities before introducing another adapter or subsystem.
- Challenge material alternatives, obtain independent review and verify the actual changed boundary. Do not treat an old pass, a test count or an author assertion as current evidence.
- Select focused checks from CONTRIBUTING.md and package.json. Engine, installed and provider checks have explicit prerequisites. Do not expand a small edit into an unrequested paid-model or remote-action suite.
- Keep generated output and local evidence in ignored scratch directories. Keep credentials and private profiles outside this repository and registered projects.
- Keep product-user documentation in docs/. Put contributor setup, tests, release decisions and internal architecture in CONTRIBUTING.md and development/; keep dependency maintenance beside its third-party source. Root requirements remain authoritative runtime inputs, not adopting-project instructions.
- Keep repository documentation limited to maintained requirements, design, contracts, instructions and current support limits. Put concise task decisions, verification and review summaries in issues and PRs. Do not commit iteration logs, transient plans, review rounds or historical acceptance receipts.
- Preserve upstream licenses and matching source/build provenance for the maintained Claude bridge. A provider migration requires its own evidence; Pi catalog support alone is not gitjig qualification.
- Product-governed development of gitjig itself needs its applicable authority and demonstrated end-to-end maturity. The current development baseline does not authorize or establish readiness for dogfooding.

See development/README.md for contributor documentation, development/providers.md for internal provider architecture, and CONTRIBUTING.md for development and verification instructions. User-visible support limits belong in docs/capabilities.md.
