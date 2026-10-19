# Runtime adapters

The first release supports two real runtime adapters: Java through JDI and Python through sys.settrace. Adapters report the capabilities they can observe so the studio can show useful views without implying unavailable information.

## Runtime selection

codeflow doctor reports whether the required runtimes are available. Java needs JDK 21+ with the jdk.jdi module. Set CODEFLOW_JAVA_HOME or JAVA_HOME to choose its installation. Python needs 3.11+; set CODEFLOW_PYTHON to choose its executable. Quote paths containing spaces in shell commands, especially on Windows.

## Java

The Java adapter launches a debuggee and observes it through the Java Debug Interface. It supports one source file, including nested classes, and sequential programs. It can report line stops, calls and returns, available locals, arrays and object fields, standard streams, stdin, and exceptions, subject to JDI and value-availability constraints.

## Python

The Python adapter uses sys.settrace in the target process. It traces one target file and sequential programs, reporting line stops, calls and returns, available locals and containers, standard streams, input, and exceptions. Because tracing is in-process, native extensions and other mechanisms can bypass it.

## Shared behavior

Line events identify the source line before that line runs. Changes from one immutable snapshot to the next are derived by the core and marked as derived. A runtime may report unavailable or optimized-away values.

The initial adapters do not expose exact condition outcomes or iteration-by-iteration loop events. They do not snapshot native memory or provide general thread tracing. Backward playback replays stored events; it does not reverse program execution. Adapters must report limitations and capabilities accurately rather than fabricate missing details.

## Adding an adapter

Implement the trace contract in [adapter-contract.md](adapter-contract.md), declare capabilities, and add runtime-backed examples and tests. A parser or syntax highlighter alone is not an execution adapter. See [ADR 0001](adr/0001-java-debugger-interface.md) and [ADR 0002](adr/0002-future-adapter-interfaces.md).
