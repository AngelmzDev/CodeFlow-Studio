# Implementation record

The original clean main branch a7504fb and Amzdev MIT license were preserved.

## Completed v0.1 increment

- Phase 1: inspected repository, Git and Windows runtimes; researched JDI, Python tracing, DAP, Tree-sitter and Diagram Design; implemented modular contracts and documented ADRs.
- Phase 2: two complete runtime-backed paths (Java and Python) record normalized evidence, replay code/variables/arrays/stack/output bidirectionally, and export JSON/SVG/offline interactive HTML.
- Phase 3, selected scope: runtime discovery and capability-aware UI, extensible adapter registration, CLI and bundled Agent Skill are implemented. Additional language adapters are future work.
- Phase 4, selected scope: English documentation, real examples, real screenshot, strict typecheck, lint, core/adapter/server/security/export/browser tests, light/dark accessibility and mobile checks, and Windows/Linux CI configuration.

Java and Python are operational within the documented sequential, single-file scope. DAP is a researched common extension route; Tree-sitter is a syntax-metadata option. Neither is advertised as an installed working adapter. PNG/video exports, project support, isolated execution and broader languages remain in the roadmap.

Local validation was performed on Windows with Node 24.16.0, JDK/JBR 21.0.9 and Python 3.12.9. GitHub Actions was configured but not triggered: there has been no commit, push or publication.

## Student-mode increment

Delivered a Basic paste-to-UML path using real Java and Python native syntax parsers without target execution, a language-neutral static analysis contract with validation and optional adapter method, local activity/class SVG layout, explicit ES/EN and light/dark preferences, source invalidation, diagram zoom, and optional runtime animation. Advanced replay and offline exports remain operational. Opaque constructs and bounded omissions are disclosed. See verification.md for the final local checks.
