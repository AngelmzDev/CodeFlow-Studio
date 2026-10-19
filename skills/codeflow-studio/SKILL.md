---
name: codeflow-studio
description: Trace and visualize trusted local programs through available CodeFlow Studio language adapters, its CLI, and offline exports.
---

# CodeFlow Studio

Use this skill when a user asks to visualize or animate real program execution with CodeFlow Studio. Run commands from its repository root; locate the checkout first if this skill was installed elsewhere.

## Supported runtimes

The first release has real adapters for Java through JDK/JDI and Python through sys.settrace. Do not describe other languages as working adapters. DAP is a possible future integration, and Tree-sitter is syntax metadata only.

## Tracing workflow

1. Check runtime availability with node src/cli.ts doctor.
2. Select a file supported by an available adapter and explain that tracing executes it on the local machine. Infer the language from the extension or select it with --language ID; use --adapter PATH only for an explicitly trusted plugin module.
3. Run it only when the user has authorized execution of that trusted source. Use the CLI's explicit --allow-local-execution option.
4. Export a trace or offline HTML only if requested or useful to the task, and save outputs where the user asked.
5. Describe what the trace actually observes. Stops occur before the highlighted line executes; changes become visible in later snapshots. Playback reverses through recorded events, not through program execution.

CodeFlow Studio is not a sandbox. Runtime limits are best-effort, Python's in-process tracer can be bypassed by native code, and traced programs can access operating-system resources available to the current user. Do not present it as suitable for hostile code or remote multi-user execution. See the repository's [Security](../../SECURITY.md) and [adapter contract](../../docs/adapter-contract.md).

## Reporting results

Distinguish runtime-observed values from values derived by the viewer. Do not claim exact condition outcomes, loop iteration events, native memory snapshots, or other unavailable capabilities. Report limitations and unrun checks plainly.
