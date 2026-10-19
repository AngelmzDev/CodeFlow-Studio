# ADR 0001: Use JDI for Java tracing

**Status:** Accepted

## Context

The initial Java adapter needs real runtime line stops, call frames and inspectable values. Candidate approaches include JDI, source instrumentation, JavaParser-based transformation and bytecode instrumentation with ASM.

## Decision

Use the Java Debug Interface (JDI) supplied by JDK 21+ for the first adapter. JDI exposes debugger events and stack/value inspection without rewriting the user's source or requiring a runtime instrumentation dependency.

## Consequences

The adapter must manage a debuggee process and JDI event requests. JDI exposes values according to runtime and debug information availability; optimized or unavailable values must not be guessed. The first implementation is limited to one source file, including nested classes, and sequential programs.

Source instrumentation could provide tailored events but changes executed source and needs robust source mapping. JavaParser primarily provides syntax structure, not runtime values. ASM could instrument bytecode but adds transformation complexity and still requires careful mapping to source. These remain possible research options, not first-release adapter paths.
