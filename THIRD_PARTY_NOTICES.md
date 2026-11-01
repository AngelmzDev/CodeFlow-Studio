# Third-party notices

## Architectural inspiration

CodeFlow Studio takes architectural inspiration from [diagram-design](https://github.com/cathrynlavery/diagram-design), an MIT-licensed project. In particular, the project informed thinking about diagram semantics, profiles and deterministic HTML validation. No source code or templates from that project are copied into CodeFlow Studio.

## Runtime and MCP dependencies

CodeFlow Studio uses Node.js built-in modules at runtime and delegates tracing to the installed JDK and Python interpreter. The MCP server uses `@modelcontextprotocol/server`, its `@modelcontextprotocol/core` dependency, and Zod; these projects are licensed under MIT. The official `@modelcontextprotocol/client`, also MIT licensed, is used only for protocol integration tests. The web build uses esbuild as a development/build dependency. Consult the package lockfile and each upstream project's license for the exact versions distributed or installed in a given release.

- MCP TypeScript SDK: <https://github.com/modelcontextprotocol/typescript-sdk>
- Zod: <https://github.com/colinhacks/zod>

## Dagre and Graphlib

The local browser bundle and offline viewer include @dagrejs/dagre 3.1.1 and @dagrejs/graphlib 4.0.5, both licensed under MIT. Their shared license notice is preserved in the generated bundle:

Copyright (c) 2012-2014 Chris Pettitt

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

## Portable Windows runtimes

La distribución portable incorpora Node.js, Python y Eclipse Temurin JDK. Sus versiones y detalles del paquete se registran en [`desktop/runtimes.json`](desktop/runtimes.json); consulta también los avisos entregados dentro del paquete y las fuentes enlazadas en ese manifiesto.

- **Node.js** se distribuye bajo la licencia MIT. El paquete incluye su aviso en `runtime/node/LICENSE`.
- **Python** se distribuye bajo la Python Software Foundation License (PSF). El paquete incluye su aviso en `runtime/python/LICENSE.txt`.
- **Eclipse Temurin JDK** se distribuye bajo GPLv2 con la Classpath Exception. El paquete conserva `runtime/jdk/legal/` y las fuentes correspondientes, incluido `lib/src.zip` cuando está disponible.

Los avisos y licencias de otros componentes redistribuidos se conservan en el manifiesto y dentro del paquete. Consulta las páginas de upstream indicadas allí para el código fuente y las condiciones aplicables. Estos avisos identifican las licencias declaradas por los proyectos; no constituyen asesoramiento legal.

El archivo completo de fuentes de Temurin correspondiente al binario se publica junto al ejecutable como Temurin-JDK21-sources.tar.gz, con su SHA256. Su URL de procedencia y huella están fijadas en desktop/runtimes.json (jdkSources). No es necesario descargarlo para usar la aplicación.
