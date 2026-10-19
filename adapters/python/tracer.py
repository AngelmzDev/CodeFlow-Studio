"""Run one Python source file and emit immutable NDJSON trace snapshots.

CLI: tracer.py TARGET STDIN_FILE MAX_EVENTS [TARGET_ARG ...]
The protocol is written to the original stdout; target output is captured in events.
"""
from __future__ import annotations

import io
import ast
import json
import math
import os
import sys
import threading
import types
from typing import Any

ADAPTER_ID = "codeflow-python"
ADAPTER_VERSION = "1.0.0"
MAX_OUTPUT_BYTES = 16_384
MAX_STRING_BYTES = 4_096
MAX_LOCALS = 100
MAX_DEPTH = 5
MAX_ENTRIES = 50
MAX_HEAP_OBJECTS = 128
UNSUPPORTED_AST_NODES = (
    ast.Yield,
    ast.YieldFrom,
    ast.GeneratorExp,
    ast.AsyncFunctionDef,
    ast.Await,
    ast.AsyncFor,
    ast.AsyncWith,
)


class TraceLimit(BaseException):
    """Private stop signal raised once the event budget is exhausted."""


class OutputLimit(TraceLimit):
    """Private stop signal raised when captured output exceeds its byte budget."""

class UnsupportedThreads(SystemExit):
    """Private stop signal for unsupported target-created Python threads."""


class Capture(io.TextIOBase):
    def __init__(self, stream_name: str, on_overflow: Any) -> None:
        self.stream_name = stream_name
        self._on_overflow = on_overflow
        self._parts: list[str] = []
        self._size = 0
        self._overflowed = False

    @property
    def encoding(self) -> str:
        return "utf-8"

    def writable(self) -> bool:
        return True

    def write(self, text: str) -> int:
        if not isinstance(text, str):
            raise TypeError("write() argument must be str")
        encoded = text.encode("utf-8", "replace")
        remaining = MAX_OUTPUT_BYTES - self._size
        if len(encoded) > remaining:
            if remaining > 0:
                kept = encoded[:remaining].decode("utf-8", "ignore")
                self._parts.append(kept)
                self._size += len(kept.encode("utf-8", "replace"))
            if not self._overflowed:
                self._overflowed = True
                self._on_overflow()
            return len(text)
        if remaining > 0:
            kept = encoded.decode("utf-8", "strict")
            self._parts.append(kept)
            self._size += len(encoded)
        return len(text)

    def flush(self) -> None:
        return None

    def snapshot(self) -> str:
        return "".join(self._parts)


def _typename(value: Any) -> str:
    cls = type(value)
    module = type.__getattribute__(cls, "__module__")
    name = type.__getattribute__(cls, "__qualname__")
    return name if module == "builtins" else module + "." + name


class Snapshot:
    def __init__(self, stable_refs: dict[int, tuple[Any, str]]) -> None:
        self.objects = stable_refs
        self.heap: dict[str, dict[str, Any]] = {}
        self._visiting: set[int] = set()
        self._object_count = 0

    @staticmethod
    def _truncate_string(value: str) -> str:
        data = value.encode("utf-8", "replace")
        if len(data) <= MAX_STRING_BYTES:
            return value
        return data[:MAX_STRING_BYTES].decode("utf-8", "ignore") + "…"

    def value(self, value: Any, depth: int = 0) -> dict[str, Any]:
        cls = type(value)
        if value is None:
            return {"kind": "primitive", "type": "NoneType", "value": None}
        if cls is bool:
            return {"kind": "primitive", "type": "bool", "value": value}
        if cls is int:
            if value.bit_length() > 4096:
                return {"kind": "unavailable", "type": "int", "reason": "integer too large"}
            if abs(value) > 9_007_199_254_740_991:
                return {"kind": "primitive", "type": "int", "value": str(value)}
            return {"kind": "primitive", "type": "int", "value": value}
        if cls is float:
            result: Any = value if math.isfinite(value) else str(value)
            return {"kind": "primitive", "type": "float", "value": result}
        if cls is str:
            return {"kind": "primitive", "type": "str", "value": self._truncate_string(value)}
        if cls is bytes:
            return {"kind": "primitive", "type": "bytes", "value": value[:MAX_STRING_BYTES].hex()}

        if cls in (list, tuple, dict) or self._safe_instance_dict(value) is not None:
            oid = id(value)
            prior = self.objects.get(oid)
            if prior is not None and prior[0] is value:
                ref = prior[1]
            else:
                ref = "o" + str(len(self.objects))
                self.objects[oid] = (value, ref)
            label = _typename(value)
            result = {"kind": "reference", "type": label, "ref": ref}
            if depth <= MAX_DEPTH and oid not in self._visiting:
                self._fill(value, ref, label, depth)
            return result
        return {"kind": "unavailable", "type": _typename(value), "reason": "unsupported value"}

    @staticmethod
    def _safe_instance_dict(value: Any) -> dict[str, Any] | None:
        cls = type(value)
        for base in type.__getattribute__(cls, "__mro__"):
            namespace = type.__getattribute__(base, "__dict__")
            descriptor = namespace.get("__dict__")
            if isinstance(descriptor, types.GetSetDescriptorType):
                try:
                    raw = descriptor.__get__(value, cls)
                except (AttributeError, TypeError):
                    return None
                return raw if type(raw) is dict else None
            if descriptor is not None:
                return None
        return None

    def _fill(self, value: Any, ref: str, label: str, depth: int) -> None:
        if ref in self.heap or self._object_count >= MAX_HEAP_OBJECTS:
            return
        self._object_count += 1
        self._visiting.add(id(value))
        try:
            if type(value) in (list, tuple):
                sequence = value
                items = [self.value(item, depth + 1) for item in sequence[:MAX_ENTRIES]]
                self.heap[ref] = {
                    "id": ref, "type": label, "kind": "array",
                    "elements": items, "length": len(sequence),
                    **({"truncated": True} if len(sequence) > MAX_ENTRIES or depth >= MAX_DEPTH else {}),
                }
                return
            if type(value) is dict:
                fields: dict[str, Any] = {}
                truncated = len(value) > MAX_ENTRIES or depth >= MAX_DEPTH
                for index, (key, item) in enumerate(value.items()):
                    if index >= MAX_ENTRIES:
                        break
                    # Prefix with the insertion ordinal so distinct Python key types
                    # can never collapse to the same serialized field name.
                    safe_key = key if type(key) is str else self._safe_key(key)
                    key_value = f"{index}: {safe_key}"
                    fields[key_value] = self.value(item, depth + 1)
                self.heap[ref] = {
                    "id": ref, "type": label, "kind": "object", "fields": fields,
                    **({"truncated": True} if truncated else {}),
                }
                return
            fields = {}
            raw = self._safe_instance_dict(value)
            truncated = False
            if raw is not None:
                for index, (key, item) in enumerate(raw.items()):
                    if index >= MAX_ENTRIES:
                        truncated = True
                        break
                    if type(key) is str and not key.startswith("__"):
                        fields[key] = self.value(item, depth + 1)
            else:
                truncated = True
            self.heap[ref] = {
                "id": ref, "type": label, "kind": "object", "fields": fields,
                **({"truncated": True} if truncated or depth >= MAX_DEPTH else {}),
            }
        finally:
            self._visiting.discard(id(value))

    @staticmethod
    def _safe_key(value: Any) -> str:
        cls = type(value)
        if cls is str:
            return value[:128]
        if cls in (int, bool, float, bytes, type(None)):
            if cls is int and value.bit_length() > 4096:
                return "int:<large>"
            if cls is bytes:
                return "bytes:" + value[:32].hex()
            if cls is float and not math.isfinite(value):
                return "float:" + str(value)
            return cls.__name__ + ":" + str(value)
        return "<" + _typename(value) + ">"

    def frames(self, stack: list[Any], target_path: str) -> list[dict[str, Any]]:
        output: list[dict[str, Any]] = []
        # Trace contract: active frame first, then callers (same as Java JDI).
        for frame, frame_id in reversed(stack):
            lineno = frame.f_lineno or frame.f_code.co_firstlineno
            local_values: dict[str, Any] = {}
            for index, (name, value) in enumerate(frame.f_locals.items()):
                if index >= MAX_LOCALS:
                    break
                if type(name) is not str or name.startswith("__"):
                    continue
                if isinstance(value, types.ModuleType) or isinstance(value, (types.FunctionType, type)):
                    continue
                local_values[name] = self.value(value)
            output.append({
                "id": frame_id,
                "name": frame.f_code.co_name if frame.f_code.co_name != "<module>" else "<module>",
                "location": {"sourceId": "main", "line": lineno},
                "locals": local_values,
            })
        return output


def main() -> int:
    if len(sys.argv) < 4:
        sys.stderr.write("usage: tracer.py TARGET STDIN_FILE MAX_EVENTS [TARGET_ARG ...]\n")
        return 2
    target = os.path.realpath(sys.argv[1])
    stdin_file = sys.argv[2]
    try:
        max_events = max(1, int(sys.argv[3]))
    except ValueError:
        sys.stderr.write("MAX_EVENTS must be an integer\n")
        return 2
    target_args = sys.argv[4:]
    with open(target, "r", encoding="utf-8") as source_file:
        source = source_file.read()
    protocol = sys.stdout
    try:
        parsed = ast.parse(source, filename=target)
    except SyntaxError:
        # Keep syntax failures on the normal traced-exception path below.
        parsed = None
    if parsed is not None:
        unsupported = next((node for node in ast.walk(parsed) if isinstance(node, UNSUPPORTED_AST_NODES)), None)
        if unsupported is not None:
            construct = type(unsupported).__name__
            line = getattr(unsupported, "lineno", 1)
            sys.stderr.write(
                f"Unsupported Python construct {construct} at line {line}; "
                "generators and asynchronous code cannot be traced faithfully.\n"
            )
            return 3

    target_stdin = open(stdin_file, "r", encoding="utf-8", newline="")
    output_limit_hit = False

    def stop_on_output_limit() -> None:
        nonlocal output_limit_hit
        output_limit_hit = True
        raise OutputLimit()

    stdout_capture = Capture("stdout", stop_on_output_limit)
    stderr_capture = Capture("stderr", stop_on_output_limit)
    old_argv, old_stdin, old_stdout, old_stderr = sys.argv, sys.stdin, sys.stdout, sys.stderr
    sys.argv = [target] + target_args
    sys.stdin, sys.stdout, sys.stderr = target_stdin, stdout_capture, stderr_capture
    namespace: dict[str, Any] = {
        "__name__": "__main__", "__file__": target, "__package__": None,
        "__cached__": None, "__builtins__": __builtins__,
    }
    target_path = os.path.realpath(target)
    main_thread_id = threading.get_ident()
    unsupported_threads = False
    stable_refs: dict[int, tuple[Any, str]] = {}
    frame_ids: dict[int, str] = {}
    next_frame = 1
    stack: list[tuple[Any, str]] = []
    events = 0
    pending_exceptions: set[int] = set()
    last_location = 1

    def emit(kind: str, frame: Any | None = None, detail: dict[str, Any] | None = None) -> None:
        nonlocal events
        if events >= max_events:
            raise TraceLimit()
        snap = Snapshot(stable_refs)
        if detail is not None and "__return__" in detail:
            returned = snap.value(detail.pop("__return__"))
            detail["value"] = returned
        frames = snap.frames(stack, target_path)
        location = None
        if frame is not None:
            line = frame.f_lineno or frame.f_code.co_firstlineno
            location = {"sourceId": "main", "line": line}
        event: dict[str, Any] = {
            "type": kind, "provenance": "observed", "frames": frames,
            "heap": snap.heap,
            "output": {"stdout": stdout_capture.snapshot(), "stderr": stderr_capture.snapshot()},
        }
        if location is not None:
            event["location"] = location
        if detail is not None:
            event["detail"] = detail
        protocol.write(json.dumps(event, ensure_ascii=True, separators=(",", ":"), allow_nan=False) + "\n")
        protocol.flush()
        events += 1

    def trace(frame: Any, event: str, arg: Any):
        nonlocal next_frame, last_location, unsupported_threads
        if threading.get_ident() != main_thread_id:
            unsupported_threads = True
            raise UnsupportedThreads()
        if unsupported_threads:
            raise UnsupportedThreads()
        if os.path.realpath(frame.f_code.co_filename) != target_path:
            return None
        key = id(frame)
        if event == "call":
            frame_id = frame_ids.get(key)
            if frame_id is None:
                frame_id = "f" + str(next_frame)
                frame_ids[key] = frame_id
                next_frame += 1
            if not any(existing is frame for existing, _ in stack):
                stack.append((frame, frame_id))
            last_location = frame.f_code.co_firstlineno
            emit("call", frame)
            return trace
        if key not in frame_ids:
            frame_ids[key] = "f" + str(next_frame)
            next_frame += 1
            stack.append((frame, frame_ids[key]))
        if event == "line":
            pending_exceptions.discard(key)
            last_location = frame.f_lineno
            emit("line", frame)
        elif event == "exception":
            pending_exceptions.add(key)
            exc_type, exc_value, _tb = arg
            if exc_type is OutputLimit:
                return trace
            detail = {"type": _typename(exc_value), "message": _safe_exception_message(exc_type, exc_value)}
            emit("exception", frame, detail)
        elif event == "return":
            if key not in pending_exceptions:
                emit("return", frame, {"__return__": arg})
            stack[:] = [(f, fid) for f, fid in stack if f is not frame]
            frame_ids.pop(key, None)
            pending_exceptions.discard(key)
        return trace

    status = "completed"
    detail: dict[str, Any] = {}
    try:
        code = compile(source, target, "exec")
        threading.settrace(trace)
        sys.settrace(trace)
        exec(code, namespace, namespace)
    except UnsupportedThreads:
        status = "limited"
        detail = {"reason": "unsupportedThreads"}
    except OutputLimit:
        status = "limited"
        detail = {"reason": "outputLimit", "maxOutputBytes": MAX_OUTPUT_BYTES}
    except TraceLimit:
        status = "limited"
        detail = {"reason": "maxEvents", "maxEvents": max_events}
    except BaseException as exc:
        status = "exception"
        detail = {"type": _typename(exc), "message": _safe_exception_message(type(exc), exc)}
    finally:
        sys.settrace(None)
        threading.settrace(None)
        # Ensure protocol events never contain tracer frames and output streams are restored.
        stack.clear()
        sys.argv, sys.stdin, sys.stdout, sys.stderr = old_argv, old_stdin, old_stdout, old_stderr
        target_stdin.close()
    if output_limit_hit:
        status = "limited"
        detail = {"reason": "outputLimit", "maxOutputBytes": MAX_OUTPUT_BYTES}
    if unsupported_threads or threading.active_count() > 1:
        status = "limited"
        detail = {"reason": "unsupportedThreads"}
    if status == "limited":
        emit_final(protocol, "limit", detail, stdout_capture, stderr_capture)
    emit_final(protocol, "terminated", {"status": status, **detail}, stdout_capture, stderr_capture)
    return 0


def _safe_exception_message(exc_type: Any, exc: Any) -> str:
    # Only stringify exact built-in exceptions with primitive args; custom __str__ is user code.
    if type(exc) in (SyntaxError, IndentationError):
        return "SyntaxError"
    try:
        args = BaseException.args.__get__(exc, type(exc))
    except BaseException:
        return "<message unavailable>"
    if type(args) is tuple and all(type(x) in (str, int, float, bool, type(None)) for x in args):
        return " ".join(str(x) for x in args)[:512]
    return "<message unavailable>"



def emit_final(protocol: Any, kind: str, detail: dict[str, Any], stdout_capture: Capture, stderr_capture: Capture) -> None:
    event = {
        "type": kind, "provenance": "observed", "frames": [], "heap": {},
        "output": {"stdout": stdout_capture.snapshot(), "stderr": stderr_capture.snapshot()},
        "detail": detail,
    }
    protocol.write(json.dumps(event, ensure_ascii=True, separators=(",", ":"), allow_nan=False) + "\n")
    protocol.flush()


if __name__ == "__main__":
    raise SystemExit(main())
