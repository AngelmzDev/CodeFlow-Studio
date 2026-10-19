# ADR 0002: Keep future adapter interfaces explicit

**Status:** Accepted

## Context

The product needs a shared trace model while avoiding claims that parsing support or protocol familiarity equals a working language runtime.

## Decision

The first release uses native Java/JDI and Python/sys.settrace adapters. A future Debug Adapter Protocol client may be evaluated as a shared integration path, using capability negotiation and respecting reference/value lifetimes. There is no generic DAP adapter in the initial release. Tree-sitter may be evaluated for syntax metadata and source navigation only.

## Consequences

Every runtime must report what it can actually observe. Capability negotiation can guide the UI, but does not itself guarantee compatible stepping semantics or values. Syntax trees cannot report runtime execution. Any future adapter requires a documented scope and tests against the shared trace contract before being advertised as operational.

## References

- [Debug Adapter Protocol overview](https://microsoft.github.io/debug-adapter-protocol/overview.html)
- [Tree-sitter](https://tree-sitter.github.io/tree-sitter/)
