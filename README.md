# CodeFlow Studio

CodeFlow Studio es una herramienta local y de código abierto para que estudiantes exploren cómo se organiza un programa y qué ocurre durante su ejecución. La interfaz se organiza en tres apartados: **Código**, **Diagrama** y **Paso a paso**. Analiza programas Java y Python para mostrar diagramas estáticos y, cuando se solicita expresamente, puede registrar y reproducir una ejecución local.

![Código, diagrama y ejecución paso a paso](docs/images/codeflow-cover.png)

## Explora tu programa

En **Código**, escribe o pega una fuente, importa un archivo o carga un ejemplo. En **Diagrama**, crea una vista estática de la actividad; Java también permite consultar clases. En **Paso a paso**, puedes aceptar el consentimiento y observar una ejecución, con sus variables, explicación y consola. Las opciones de entrada, argumentos y clase de entrada están plegadas dentro de ese apartado. La ejecución requiere consentimiento explícito y utiliza los permisos de tu equipo, así que ejecútala solo con código de confianza.

Usa **Ctrl+Enter** para crear el diagrama y **Ctrl+Shift+Enter** para ejecutar. La ejecución conserva su consentimiento previo. Los diagramas estáticos no ejecutan ni evalúan el código. En una traza, cada instantánea se toma **antes** de la instrucción indicada; los efectos de esa instrucción aparecen en la siguiente. La reproducción recorre las instantáneas registradas, no vuelve a ejecutar el programa.

## Funciones disponibles

- Análisis estático de Java y Python para diagramas de actividad; Java también ofrece diagramas de clases.
- En Java, expansión estática de expresiones ternarias y `switch` con flechas (`case ... ->`); las formas `case:` y las expresiones `switch` se muestran como pasos opacos.
- Trazado real de Java mediante Java Debug Interface (JDI) y de Python mediante `sys.settrace`.
- La ejecución Java compila con `--enable-preview` y la versión del JDK detectado.
- Reproducción de eventos y estados observados, con vistas de variables, pila de llamadas, salida, matrices y objetos cuando el adaptador puede observarlos.
- Explicación didáctica determinista en español e inglés, sincronizada con el paso seleccionado. La explicación ampliada y la IA local opcional están bajo los detalles de la explicación.
- Diagramas Dagre con geometría ajustada al contenido. Se conserva el motor de diagramas.
- Las acciones para importar una traza, guardarla o exportar la vista están agrupadas bajo **Guardar o abrir una ejecución**.
- Exportación de diagramas a SVG o JPG y de trazas como JSON, SVG o HTML autocontenido que se abre sin conexión.

## Explicación opcional con Ollama

La explicación adicional por un modelo local de Ollama es opcional y está bajo los detalles de la explicación. La explicación determinista sigue disponible sin IA. Los hechos registrados se identifican como observados y el texto generado por IA se etiqueta aparte; puede contener errores y no constituye evidencia de ejecución. Si Ollama no está disponible, se conserva la explicación determinista.

Añade la configuración local opcional a `.codeflow.local.json`. Sustituye `modelo-local-ejemplo` por el nombre exacto de un modelo que ya tengas instalado. No hace falta descargar un modelo para usar CodeFlow Studio.

```json
{
  "ai": {
    "provider": "ollama",
    "model": "modelo-local-ejemplo",
    "baseUrl": "http://127.0.0.1:11434"
  }
}
```

La comunicación utiliza el endpoint local de chat de Ollama. Consulta la [documentación oficial de la API de chat](https://docs.ollama.com/api/chat). En esta máquina no hay un modelo local configurado. La integración se ha validado con un servidor simulado; el comportamiento con un modelo real requiere validación con ese modelo.

## Instalación desde el código fuente

El proyecto está en desarrollo y todavía no publica ejecutables. Para iniciarlo, clona el repositorio e instala sus dependencias:

```sh
git clone https://github.com/AngelmzDev/CodeFlow-Studio.git
cd CodeFlow-Studio
npm install
npm run build
npm start
```

Abre la dirección local que indique el CLI. Escribe o pega código Java o Python en **Código**, pulsa **Crear diagrama** o usa Ctrl+Enter. El análisis estático no ejecuta el programa.

## Servidor MCP

CodeFlow Studio incluye un servidor local MCP por `stdio` para Codex, Claude Code, OpenCode y otros clientes compatibles. Reutiliza los mismos adaptadores, diagramas, explicaciones y exportadores de la aplicación; no envía código ni resultados a servicios externos y no necesita claves API.

```sh
npm install
npm run build
npm run mcp
```

El servidor expone `codeflow_analyze`, `codeflow_diagram`, `codeflow_trace`, `codeflow_variables`, `codeflow_explain` y `codeflow_export`. El análisis, los diagramas, la consulta de variables, las explicaciones y las exportaciones no escriben archivos elegidos por el agente. `codeflow_trace` está deshabilitada por defecto y nunca debe usarse con código no confiable: la ejecución ocurre con los permisos del usuario y no está aislada.

La [guía completa de MCP](docs/mcp.md) explica la configuración portable para Codex, Claude Code y OpenCode, la verificación, la autorización de ejecución y la desconexión. Las referencias de configuración se basan en la documentación oficial de [Codex](https://learn.chatgpt.com/docs/extend/mcp), [Claude Code](https://code.claude.com/docs/en/mcp), [OpenCode](https://dev.opencode.ai/v2/docs/mcp-servers/) y el [SDK TypeScript de MCP](https://ts.sdk.modelcontextprotocol.io/v2/).

## Requisitos

- Node.js 24 o posterior y npm.
- JDK 21 o posterior, con `jdk.jdi`, para analizar o ejecutar Java.
- Python 3.11 o posterior para analizar o ejecutar Python.

Comprueba los entornos detectados con `node src/cli.ts doctor`. Puedes seleccionar el JDK con `CODEFLOW_JAVA_HOME` o `JAVA_HOME`, y Python con `CODEFLOW_PYTHON`. También puedes definir las rutas locales `javaHome` y `python` en `.codeflow.local.json`; las variables de entorno tienen prioridad.

## Trazas y exportación desde el CLI

Estos comandos ejecutan código local en tu equipo; ejecútalos solo con fuentes de confianza:

```sh
node src/cli.ts trace examples/java/Main.java --allow-local-execution --entry Main --out trace.json
node src/cli.ts trace examples/java/Input.java --allow-local-execution --entry Input --stdin "5" --out input-trace.json
node src/cli.ts trace examples/python/sum.py --allow-local-execution --out python-trace.json
node src/cli.ts export trace.json --format html --out trace.html
```

Consulta [Seguridad](SECURITY.md) para conocer el modelo y sus límites.

No pegues claves, contraseñas ni código confidencial que no quieras guardar en el navegador o incluir en una traza exportada. El borrador del editor se almacena localmente en el navegador; puedes eliminarlo borrando los datos de este sitio.

## Alcance y documentación

Solo Java y Python tienen adaptadores operativos. La ejecución admite programas secuenciales de un archivo fuente. La actividad estática cubre un subconjunto de `if`, bucles, `return`, `break` y `continue`; las condiciones no se evalúan y las construcciones no compatibles pueden aparecer como opacas. Las instantáneas, vistas de variables y objetos dependen de la información que exponga cada entorno de ejecución. La ejecución usa los permisos del usuario y sus límites son salvaguardas de mejor esfuerzo, no aislamiento.

Consulta la [guía de usuario](docs/user-guide.md), la [guía para estudiantes](docs/guia-estudiantes.md), la [guía MCP](docs/mcp.md), la [arquitectura](docs/architecture.md), la [guía de adaptadores](docs/adapters.md), el [formato de traza](docs/trace-format.md) y la [hoja de ruta](HOJA_DE_RUTA_CODEFLOW.txt). El formato neutral de intercambio no implica soporte para otros lenguajes. La visualización usa `@dagrejs/dagre` como dependencia de ejecución.

## Licencia

CodeFlow Studio se distribuye bajo la licencia MIT. Consulta [LICENSE](LICENSE).
