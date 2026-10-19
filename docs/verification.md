# Verification — 2026-10-18

Executed locally on Windows with Node.js 24.16.0, JDK/JBR 21.0.9 and Python 3.12.9.

- `npm run check`: passed strict TypeScript, ESLint, Prettier, browser build, and **67/67** core/adapter/analysis/server/security/export tests. No tests skipped.
- `npm run test:e2e`: **9/9** passed with Chromium. Basic mode starts blank, static generation does not request execution, Java pasting preserves source, class UML renders, language/theme persist, optional real tracing highlights observed lines, and the offline viewer includes static diagrams without subresource requests. Advanced tracing/import/export and 390px layout remain covered.
- Axe accessibility checks passed for Basic and Advanced in light and dark themes.
- Native analysis tests cover non-execution, branches/loops/transfers, opaque constructs, unique IDs, node/class/member caps, Java control-character JSON escaping and CRLF/Unicode.
- Static exports validate source/language and escape embedded data. UML relationships use generalization and realization symbols and resolve only declared unambiguous types.
- `git diff --check`: no whitespace errors.
- Dependency install audit: zero reported vulnerabilities at installation.
- Existing real runtime examples remain operational: Java Main produces 17, Python sum produces 20, recursion produces 120, and Java Scanner with input 5 produces 15.

GitHub Actions is configured for Windows and Linux. It has not run remotely because no commit or push was made. Linux/macOS were not tested locally. Only Java and Python are operational. Static analysis models a documented subset and does not establish runtime branch outcomes. PNG/video exports, project support and additional languages remain future work.
