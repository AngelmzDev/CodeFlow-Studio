# Security

CodeFlow Studio is a **trusted-local-code tool**. Tracing runs user-selected programs on the user's machine. It is not a sandbox, container, or security boundary, and it is not designed to safely run hostile code, provide multi-user isolation, or expose an execution service to a network.

The MCP server uses local `stdio` only. Its read-only tools accept source and validated result objects in memory; they do not accept project paths or output paths, and they do not upload data. MCP execution is disabled by default. Enabling the execution mechanism still requires a separate interactive, short-lived, one-use grant bound to the exact source and execution parameters. An agent-supplied boolean or grant-shaped string is not consent. These controls reduce accidental execution; they do not make executed code safe.

The local web server binds to loopback and uses same-origin checks plus a per-session token for trace requests. These measures reduce accidental exposure through browser requests; they do not make untrusted program execution safe. Do not bind the service to a public interface or forward its port.

Execution limits for elapsed time, event count, memory and captured output are best-effort. Process termination is used where available, but limits cannot guarantee immediate termination or prevent resource pressure. In particular, Python's in-process sys.settrace tracer can be bypassed by native extensions, and traced code can access the filesystem, network, environment, subprocesses and other operating-system facilities. A Java program has the same access available to the current user.

Run only code you trust, preferably with operating-system protections configured separately. Avoid secrets in the environment when tracing unfamiliar code. Do not treat an exported trace as trusted HTML if it came from an unknown source.

MCP messages and results are size-limited, errors are sanitized, and `stdout` is reserved for the protocol. Do not add logging of source, paths, input, variables or trace content. Operational logging belongs on `stderr` and should remain minimal.

## Reporting a vulnerability

Please send a private report to the maintainers through the repository's security reporting channel, if enabled. Include the affected version, impact, reproduction steps and any relevant logs. Avoid posting exploit details publicly until maintainers have had a reasonable chance to investigate and coordinate a fix.
