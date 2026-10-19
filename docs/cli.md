# Command line

The CLI runs on Node.js 24+. Use node src/cli.ts for commands.

## Commands

    node src/cli.ts doctor
    node src/cli.ts serve [--port 4310]
    node src/cli.ts trace FILE --allow-local-execution [options]
    node src/cli.ts export TRACE --format html|svg|json --out PATH

- doctor checks whether Node.js, the JDK/JDI adapter and Python adapter are available.
- serve starts the local studio on loopback.
- trace runs a Java or Python file locally and writes a trace.
- export writes the requested representation from an existing trace.

The trace command requires the explicit --allow-local-execution flag because it executes the selected file with your operating-system permissions.

## Trace options

- --language ID: select a registered adapter (java and python are built in) when file extension detection is not sufficient.
- --entry Main: Java entry class.
- --stdin TEXT: provide standard input to the traced program.
- --stdin-file PATH: read UTF-8 standard input from a file; mutually exclusive with --stdin.
- --arg ARG: pass a program argument; repeat to pass multiple arguments.
- --out PATH: write the resulting JSON trace to a file.
- --timeout 10000: best-effort time limit in milliseconds.
- --max-events 2000: runtime observation budget (2–10,000), followed by up to two termination/control events.
- --adapter PATH: load an explicitly trusted local module whose default export implements LanguageAdapter. Available for doctor, serve and trace; plugin loading executes code with your permissions.
- Export --index N: select the static SVG state or initial HTML playback position.

Quote paths and values with spaces. For example, in PowerShell:

    node src/cli.ts trace ".\examples\java\Main.java" --allow-local-execution --entry Main --out ".\out\trace.json"

Set CODEFLOW_JAVA_HOME or JAVA_HOME to select a JDK and CODEFLOW_PYTHON to select Python. You can also create a local .codeflow.local.json containing javaHome and python paths, for example:

    {
      "javaHome": "C:/Program Files/Java/jdk-21",
      "python": "C:/Users/you/AppData/Local/Programs/Python/Python312/python.exe"
    }

Environment variables take precedence over these local values. The file is per-machine and ignored by Git. The server is intended for local use; see [Security](../SECURITY.md).
