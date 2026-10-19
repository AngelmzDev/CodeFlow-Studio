# Roadmap

The implemented v0.1 increment provides a language-neutral trace/playback platform with two real runtime adapters. The shared schema and plugin contract are not claims that other languages currently work.

## Delivered

- Versioned, validated trace snapshots, explicit capability reporting and deterministic bidirectional playback.
- Java/JDI and Python/sys.settrace for sequential single-file programs.
- Capability-aware local studio, CLI, trusted plugin registration, JSON/SVG export and self-contained interactive HTML.
- Runtime discovery, explicit execution consent, observation budgets, tests, CI configuration and developer documentation.

## Next priorities

1. Implement and verify a shared DAP recorder: launch/initialize/configuration sequencing, capability negotiation, stopped-state snapshot materialization, source mapping and reference lifetimes. Keep debugger-specific launch/I/O details in adapter plugins.
2. Add JavaScript/TypeScript with [vscode-js-debug](https://github.com/microsoft/vscode-js-debug), including source-map tests and explicit async limitations.
3. Evaluate C/C++ and Rust using [lldb-dap](https://lldb.llvm.org/use/lldbdap.html), C# using [netcoredbg](https://github.com/Samsung/netcoredbg), Go using [Delve DAP](https://github.com/go-delve/delve/tree/master/service/dap), and Kotlin/JVM through a validated JVM adapter with Kotlin source mapping. These are candidates, not installed or operational CodeFlow adapters.
4. Add genuine observed branch/iteration probes, mutation provenance, multi-file projects and opt-in isolated execution, each behind honest capability declarations.
5. Add specialized recursion/control-flow views, richer collection support, trace checkpoint compression, PNG export and platform-specific visual-regression baselines. GIF/MP4 remain deferred until reproducible rendering is implemented and tested.

Tree-sitter can add syntax metadata for supported source files. It cannot replace debugger/runtime evidence. Every added language must pass equivalent fixtures, forward/back replay, I/O, exception and resource-boundary tests before it is advertised as compatible.
