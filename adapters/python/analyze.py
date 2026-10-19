#!/usr/bin/env python3
"""Static Python activity diagrams. This module parses source; it never executes it."""
import ast
import json
import sys
from pathlib import Path

MAX_DIAGRAMS, MAX_NODES, MAX_EDGES, MAX_CLASSES = 24, 200, 600, 24


def snippet(source, node, limit=160):
    text = ast.get_source_segment(source, node) or ast.dump(node, include_attributes=False)
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


class Builder:
    def __init__(self, source, label, name, body, lines):
        self.source, self.label, self.name, self.body = source, label, name, body
        self.lines = lines
        self.nodes, self.edges, self.warnings = [], [], []
        self.nid = 0
        self.end = self.node("end", "End", lines[1])
        self.start = self.node("start", "Start", lines[0])
        self.loop_stack = []

    def node(self, kind, label, line, end_line=None):
        if len(self.nodes) >= MAX_NODES:
            if "Node limit reached" not in self.warnings:
                self.warnings.append("Node limit reached; remaining statements were omitted.")
            return None
        self.nid += 1
        n = {"id": f"n{self.nid}", "kind": kind, "label": label[:160], "line": line}
        if end_line is not None and end_line != line:
            n["endLine"] = end_line
        self.nodes.append(n)
        return n["id"]

    def edge(self, a, b, label=None):
        if a is None or b is None or len(self.edges) >= MAX_EDGES:
            if len(self.edges) >= MAX_EDGES and "Edge limit reached" not in self.warnings:
                self.warnings.append("Edge limit reached; remaining control flow was omitted.")
            return
        e = {"id": f"e{len(self.edges)+1}", "from": a, "to": b}
        if label:
            e["label"] = label
        self.edges.append(e)

    def connect(self, incoming, target, label=None):
        for a in incoming:
            self.edge(a, target, label)

    def block(self, statements, incoming):
        tails = incoming
        for s in statements:
            if not tails:
                break
            tails = self.stmt(s, tails)
            if len(self.nodes) >= MAX_NODES:
                break
        return tails

    def opaque(self, s, incoming, why):
        msg = f"Unsupported {why} is shown as an opaque static step; internal flow is not modeled."
        if msg not in self.warnings:
            self.warnings.append(msg)
        n = self.node("note", snippet(self.source, s), s.lineno, getattr(s, "end_lineno", s.lineno))
        self.connect(incoming, n)
        return [n] if n else []

    def stmt(self, s, incoming):
        if isinstance(s, (ast.If,)):
            d = self.node("decision", snippet(self.source, s.test), s.lineno)
            self.connect(incoming, d)
            edge_start = len(self.edges)
            then_tails = self.block(s.body, [d])
            if s.body and len(self.edges) > edge_start:
                self.edges[edge_start]["label"] = "true"
            edge_start = len(self.edges)
            else_tails = self.block(s.orelse, [d]) if s.orelse else []
            if s.orelse and len(self.edges) > edge_start:
                self.edges[edge_start]["label"] = "false"
            has_empty_then = not s.body
            has_empty_else = not s.orelse
            if not then_tails and not else_tails and not has_empty_then and not has_empty_else:
                return []
            merge = self.node("merge", "Merge", getattr(s, "end_lineno", s.lineno))
            self.connect(then_tails, merge)
            self.connect(else_tails, merge)
            if has_empty_then: self.edge(d, merge, "true")
            if has_empty_else: self.edge(d, merge, "false")
            return [merge] if merge else []
        if isinstance(s, (ast.For, ast.AsyncFor, ast.While)):
            if isinstance(s, ast.AsyncFor):
                return self.opaque(s, incoming, "async for")
            if s.orelse:
                return self.opaque(s, incoming, "loop with else")
            test = "for " + snippet(self.source, s.target) + " in " + snippet(self.source, s.iter) if isinstance(s, ast.For) else snippet(self.source, s.test)
            d = self.node("decision", test, s.lineno)
            after = self.node("merge", "Loop exit", getattr(s, "end_lineno", s.lineno))
            self.connect(incoming, d)
            ctx = {"break": [], "continue": [], "test": d, "after": after}
            self.loop_stack.append(ctx)
            edge_start = len(self.edges)
            body = self.block(s.body, [d])
            self.loop_stack.pop()
            if s.body and len(self.edges) > edge_start:
                self.edges[edge_start]["label"] = "true"
            elif not s.body:
                self.edge(d, d, "true")
            for t in body: self.edge(t, d, "repeat")
            for b in ctx["continue"]: self.edge(b, d, "repeat")
            for b in ctx["break"]: self.edge(b, after)
            self.edge(d, after, "false")
            return [after]
        if isinstance(s, ast.Break):
            n = self.node("action", "break", s.lineno)
            self.connect(incoming, n)
            if self.loop_stack: self.loop_stack[-1]["break"].append(n)
            else: self.warnings.append("break outside modeled loop encountered; treated as terminal.")
            return []
        if isinstance(s, ast.Continue):
            n = self.node("action", "continue", s.lineno)
            self.connect(incoming, n)
            if self.loop_stack: self.loop_stack[-1]["continue"].append(n)
            else: self.warnings.append("continue outside modeled loop encountered; treated as terminal.")
            return []
        if isinstance(s, ast.Return):
            n = self.node("return", snippet(self.source, s), s.lineno)
            self.connect(incoming, n); self.edge(n, self.end)
            return []
        if isinstance(s, ast.Raise):
            n = self.node("action", snippet(self.source, s), s.lineno)
            self.connect(incoming, n); self.edge(n, self.end)
            return []
        if isinstance(s, (ast.Try, ast.Match, ast.AsyncFunctionDef, ast.With, ast.AsyncWith, ast.AsyncFor)):
            return self.opaque(s, incoming, type(s).__name__)
        # Function/class declarations are not executable steps inside the module graph.
        if isinstance(s, (ast.FunctionDef, ast.ClassDef)):
            return incoming
        n = self.node("call" if isinstance(s, ast.Expr) and isinstance(s.value, ast.Call) else "action", snippet(self.source, s), s.lineno, getattr(s, "end_lineno", s.lineno))
        self.connect(incoming, n)
        return [n] if n else []

    def build(self):
        tails = self.block(self.body, [self.start])
        self.connect(tails, self.end)
        if len(self.nodes) >= MAX_NODES: self.warnings.append("Diagram node limit reached.")
        return {"id": self.name, "label": self.label, "startLine": self.lines[0], "endLine": self.lines[1], "nodes": self.nodes, "edges": self.edges, "warnings": list(dict.fromkeys(self.warnings))}


def main():
    path = Path(sys.argv[1])
    source = path.read_text(encoding="utf-8")
    diagnostics, diagrams, classes = [], [], []
    try:
        tree = ast.parse(source, filename=str(path))
    except (SyntaxError, ValueError, UnicodeError) as exc:
        print(json.dumps({"schemaVersion":"1.0","language":"python","provenance":"static","source":{"name":path.name,"content":source},"defaultDiagramId":"","diagrams":[],"classes":[],"diagnostics":[f"Python syntax error: {exc}"]}))
        return
    lines = source.splitlines() or [""]
    maxline = max(1, len(lines))
    for cls in (n for n in ast.walk(tree) if isinstance(n, ast.ClassDef)):
        fields = []
        for n in cls.body:
            if isinstance(n, (ast.Assign, ast.AnnAssign)):
                fields.append(snippet(source, n))
        methods = [n.name for n in cls.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef))]
        if len(fields) > 64 and "Class field limit reached; some declarations were omitted." not in diagnostics:
            diagnostics.append("Class field limit reached; some declarations were omitted.")
        if len(methods) > 64 and "Class method limit reached; some declarations were omitted." not in diagnostics:
            diagnostics.append("Class method limit reached; some declarations were omitted.")
        classes.append({"id":f"class-{len(classes)+1}","name":cls.name,"kind":"class","line":cls.lineno,"fields":fields[:64],"methods":methods[:64],"extends":[snippet(source,b) for b in cls.bases],"implements":[]})
    if len(classes) > MAX_CLASSES:
        diagnostics.append("Class limit reached; additional class declarations were omitted.")
        classes = classes[:MAX_CLASSES]
    top = [s for s in tree.body if not isinstance(s,(ast.FunctionDef,ast.AsyncFunctionDef,ast.ClassDef))]
    module_meaningful = any(not isinstance(s, ast.Pass) for s in top)
    if module_meaningful and len(diagrams) < MAX_DIAGRAMS:
        diagrams.append(Builder(source,"Module","module",top,(1,maxline)).build())
    funcs=[]
    def collect(body, prefix=""):
        for s in body:
            if isinstance(s,(ast.FunctionDef,ast.AsyncFunctionDef)):
                funcs.append((s,(prefix+"." if prefix else "")+s.name))
            elif isinstance(s,ast.ClassDef): collect(s.body,(prefix+"." if prefix else "")+s.name)
    collect(tree.body)
    for f,name in funcs:
        diagram_id = f"{name}@{f.lineno}"
        if len(diagrams)>=MAX_DIAGRAMS: diagnostics.append("Diagram limit reached; additional functions were omitted."); break
        if isinstance(f,ast.AsyncFunctionDef):
            b=Builder(source,name,diagram_id,f.body,(f.lineno,getattr(f,"end_lineno",f.lineno)))
            n=b.node("note","Async function body is not modeled.",f.lineno,getattr(f,"end_lineno",f.lineno)); b.edge(b.start,n); b.edge(n,b.end); b.warnings.append("Async function flow is unsupported and shown as one opaque note."); diagrams.append({"id":diagram_id,"label":name,"startLine":f.lineno,"endLine":getattr(f,"end_lineno",f.lineno),"nodes":b.nodes,"edges":b.edges,"warnings":b.warnings})
        else: diagrams.append(Builder(source,name,diagram_id,f.body,(f.lineno,getattr(f,"end_lineno",f.lineno))).build())
    default = "module" if module_meaningful and any(d["id"]=="module" for d in diagrams) else (diagrams[0]["id"] if diagrams else "")
    print(json.dumps({"schemaVersion":"1.0","language":"python","provenance":"static","source":{"name":path.name,"content":source},"defaultDiagramId":default,"diagrams":diagrams,"classes":classes,"diagnostics":diagnostics},ensure_ascii=False))


if __name__ == "__main__": main()
