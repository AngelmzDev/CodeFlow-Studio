# Trace format 1.0

The normative TypeScript model is [types.ts](../src/core/types.ts); [validateTrace](../src/core/trace.ts) validates and projects imported data. It rejects other schema versions, unknown structural fields, invalid source locations and oversized collections. Extension data belongs in bounded event detail or a future schema version. Imported deltas are recomputed from snapshots.

A trace contains a language ID, the adapter/version/capabilities used to record it, source documents, ordered events, a completed/exception/limited status, configured limits and diagnostics. Event IDs are e0, e1, …; sequences are contiguous zero-based integers. Source locations are one-based and reference source IDs, never absolute runtime temporary paths.

## Events

| Type            | Evidence                                                                                                                           |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| line            | Runtime suspended before the indicated source instruction                                                                          |
| call            | Runtime entered a source function/method                                                                                           |
| return          | Runtime is returning; final callee snapshot and optional detail.value                                                              |
| exception       | Runtime raised an exception; it may still be caught                                                                                |
| stdout / stderr | Available schema types for explicit stream observations; built-in adapters instead include cumulative captured output on each stop |
| limit           | Supervisor or tracer stopped at an observation/resource boundary                                                                   |
| terminated      | Program completion or abnormal VM exit; detail.status explains the outcome                                                         |

The schema also accepts observed condition, loop.start/loop.end and variable.create/update/delete records from future adapters. Condition records require conditionValues capability plus a boolean detail.result. Loop records require loopEvents capability, stable detail.loopId and integer detail.iteration. Variable records require detail.frameId and detail.name. These are schema extension points, not claims of built-in language support: neither current adapter emits them or enables those capabilities. Exact condition evaluations and iteration boundaries are never fabricated from line visits.

Each event has provenance observed, a complete frames snapshot (active function first, followed by its callers toward the root), bounded heap objects keyed by stable reference IDs, and cumulative stdout/stderr. Limit/termination records describe supervisor observations and may have no active frames. Python module and function frames differ from Java main/method frames; the core does not require identical frame shapes across languages.

Values are tagged primitive, reference or unavailable. Runtime type names remain language-specific opaque strings. Integers beyond JavaScript's exact numeric range use decimal strings with their original integer type. Heap arrays retain total length and a truncation marker; object fields are read without invoking application getters or toString/repr. Python dict field labels include an insertion ordinal to avoid collisions between distinct key types.

Changes carry frameId, variable name, before/after values and provenance derived. They compare adjacent observed snapshots; a reference staying constant does not imply that its target heap object stayed constant. Heap snapshots, rather than local deltas, are authoritative for mutations.

## Determinism

Playback selects immutable recorded snapshots by sequence. No wall-clock timestamp, random layout or AI-generated event participates in replay. Reusing the same trace and selected index yields identical state and SVG. Repeated executions are equal only when the program and external inputs are deterministic; programs reading the clock, randomness, files or network can differ.

The event budget counts runtime observations; up to two limit/termination control records may follow it. Imports allow at most 10,002 records. Sources are capped at 100,000 characters and 10,000 lines. Supervisor protocol output is capped at 24 MiB; browser/API imports are also bounded. See [Security](../SECURITY.md) for the distinction between bounded observation and isolation.
