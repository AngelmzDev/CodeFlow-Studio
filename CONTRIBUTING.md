# Contributing

Thanks for helping improve CodeFlow Studio. Contributions should preserve the language-neutral trace contract and clearly distinguish facts reported by a runtime from values derived by the viewer.

## Development setup

Install Node.js 24+, JDK 21+ and Python 3.11+. Then run:

    npm install
    npm run build
    npm start

Use npm run check for the repository's full local check. The Java and Python tools must be available to run their adapter tests. Configure non-default runtimes with CODEFLOW_JAVA_HOME / JAVA_HOME and CODEFLOW_PYTHON.

## Changes to adapters and traces

- Keep the public trace schema language-neutral. Put language-specific facts in adapter metadata or event details.
- Label runtime observations as observed and viewer-computed values, such as variable deltas or graph layouts, as derived.
- Do not infer condition results, loop counts, or memory details that the runtime did not report.
- Preserve the documented before-line stop semantics, immutable snapshots, and capability-aware UI behavior.
- Include focused fixtures for new behavior and state the runtime versions used when reporting validation.
- Document unsupported syntax or values as limitations rather than silently dropping their meaning.

Adapter changes should update [docs/adapters.md](docs/adapters.md) and the relevant architecture decision record. A new adapter is not operational until it has a real runtime integration and meaningful tests.

## Pull requests

Describe the behavior change, compatibility impact, and validation performed. Do not claim a test passed unless it was run. Keep unrelated formatting or generated files out of the change.

## Security reports

Please report vulnerabilities privately to the repository maintainers rather than opening a public issue with exploit details. See [SECURITY.md](SECURITY.md).
