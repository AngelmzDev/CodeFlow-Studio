# Servidor MCP de CodeFlow Studio

El servidor MCP permite que un agente compatible use las funciones locales de CodeFlow Studio a través del transporte `stdio`. El cliente inicia un proceso hijo y se comunica con él por entrada y salida estándar. No se abre ningún puerto, no hay telemetría y el servidor no llama a servicios externos. Ollama no participa en el servidor MCP y sigue siendo opcional en la aplicación web.

El servidor usa el SDK TypeScript oficial de MCP v2. `stdout` está reservado al protocolo; los únicos mensajes operativos se escriben de forma mínima en `stderr` y no incluyen código, rutas, trazas ni variables.

## Requisitos e instalación

- Node.js 24 o posterior y npm.
- Python 3.11 o posterior para Python.
- JDK 21 o posterior con `jdk.jdi` para Java.

```sh
git clone https://github.com/AngelmzDev/CodeFlow-Studio.git
cd CodeFlow-Studio
npm install
npm run build
npm test
```

Prueba manualmente el proceso:

```sh
npm run mcp
```

La línea de disponibilidad aparece en `stderr`; el proceso queda esperando mensajes MCP. Detenlo con Ctrl+C. No envíes texto manual a `stdin`.

## Herramientas

| Herramienta          | Procedencia                   | Comportamiento                                                                 |
| -------------------- | ----------------------------- | ------------------------------------------------------------------------------ |
| `codeflow_analyze`   | `static`                      | Analiza fuente Java o Python sin ejecutarla.                                   |
| `codeflow_diagram`   | `static`                      | Devuelve SVG de actividad o clases a partir del análisis estático.             |
| `codeflow_trace`     | `observed`                    | Ejecuta fuente confiable solo con un permiso local exacto, breve y de un uso.  |
| `codeflow_variables` | `observed`                    | Consulta marcos, variables, objetos, cambios y salida de un evento de traza.   |
| `codeflow_explain`   | `derived-from-observed-trace` | Produce una explicación didáctica determinista; no se presenta como evidencia. |
| `codeflow_export`    | `derived-from-observed-trace` | Devuelve JSON, SVG o HTML autocontenido; no escribe una ruta del sistema.      |

Todas las entradas se validan de forma estricta. El transporte y las entradas estructuradas tienen un límite de 2 MiB; cada resultado tiene un límite de 900 KiB para poder enviarse de forma compatible tanto como texto como contenido estructurado. La fuente admite como máximo 100 000 caracteres y 10 000 líneas. Las trazas MCP admiten entre 2 y 2 000 eventos y tiempos de 250 a 30 000 ms. Si una traza excede el límite de salida, autoriza otra ejecución con un presupuesto menor.

El MCP no acepta rutas de proyecto ni rutas de exportación. Recibe fuente y estructuras en memoria, y devuelve contenido. Esto evita traversal, seguimiento de enlaces simbólicos y sobrescritura arbitraria desde una llamada del agente.

## Conectar Codex

Codex CLI, la extensión IDE y la aplicación de escritorio comparten la configuración MCP. La opción más predecible es añadir una entrada a `~/.codex/config.toml` o a `.codex/config.toml` dentro de un proyecto confiable:

```toml
[mcp_servers.codeflow]
command = "node"
args = ["src/mcp/server.ts"]
cwd = "/ruta/al/clone/CodeFlow-Studio"
enabled = true
```

En Windows puedes usar una cadena TOML literal para no duplicar barras:

```toml
cwd = 'C:\ruta\al\clone\CodeFlow-Studio'
```

Sustituye únicamente el marcador por la ruta local de tu clon; no confirmes al repositorio una ruta personal. Reinicia el cliente y verifica con:

```sh
codex mcp list
```

Dentro de Codex también puedes usar `/mcp`. Consulta la [documentación oficial de MCP en Codex](https://learn.chatgpt.com/docs/extend/mcp).

Para desconectar:

```sh
codex mcp remove codeflow
```

También puedes eliminar la tabla `mcp_servers.codeflow` del archivo donde la añadiste.

## Conectar Claude Code

Desde la raíz del clon:

```sh
claude mcp add --transport stdio codeflow --scope project -- node src/mcp/server.ts
claude mcp list
```

Inicia Claude Code en el proyecto y usa `/mcp` para revisar o aprobar el servidor de ámbito de proyecto. La [documentación oficial de Claude Code](https://code.claude.com/docs/en/mcp) describe los ámbitos y comandos de administración.

Para desconectar:

```sh
claude mcp remove codeflow --scope project
```

## Conectar OpenCode

Desde la raíz del clon:

```sh
opencode mcp add codeflow -- node src/mcp/server.ts
opencode mcp list
```

Como alternativa, añade esta entrada portable al `opencode.jsonc` del proyecto:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "codeflow": {
        "type": "local",
        "command": ["node", "src/mcp/server.ts"],
        "cwd": ".",
      },
    },
  },
}
```

OpenCode usa MCP heredado de forma predeterminada; el servidor admite tanto clientes heredados como la revisión moderna negociada por el SDK. Consulta la [documentación oficial de MCP de OpenCode](https://dev.opencode.ai/v2/docs/mcp-servers/).

Para desconectar, elimina la entrada `mcp.servers.codeflow` del archivo de configuración donde se creó.

## Verificar la integración

1. Ejecuta `npm test`; la suite inicia un cliente MCP real por `stdio`, enumera las seis herramientas y confirma que la ejecución está cerrada por defecto.
2. En el agente, abre el listado MCP y comprueba que aparece `codeflow` conectado.
3. Pide: “Analiza estáticamente este programa Python con CodeFlow; no lo ejecutes: `value = 1`”.
4. Comprueba que el resultado declara `provenance: static`.
5. Pide un diagrama de actividad y confirma que el resultado tiene `format: svg`.

Si el proceso se cierra, ejecuta `npm run mcp` desde la raíz y revisa `stderr`. Si el cliente indica protocolo corrupto, verifica que ninguna modificación haya añadido `console.log` al servidor MCP: cualquier salida ajena al protocolo en `stdout` rompe `stdio`.

## Ejecución autorizada

La ejecución está deshabilitada incluso si el agente envía `allowLocalExecution: true`. Para habilitar el mecanismo de permisos, añade esta variable solo al proceso MCP:

- Codex: `env = { CODEFLOW_MCP_EXECUTION = "authorized" }` en la tabla del servidor.
- Claude Code: vuelve a añadir el servidor con `--env CODEFLOW_MCP_EXECUTION=authorized` antes de `--transport stdio`.
- OpenCode: añade `"environment": { "CODEFLOW_MCP_EXECUTION": "authorized" }` al servidor local.

La variable no autoriza por sí sola ninguna ejecución. Para cada ejecución:

1. Revisa el archivo y decide que confías en él.
2. En una terminal interactiva distinta del MCP, desde la raíz del clon, crea un permiso exacto:

   ```sh
   npm run mcp:authorize -- examples/python/sum.py
   ```

3. Para parámetros adicionales, autorízalos exactamente como se enviarán:

   ```sh
   npm run mcp:authorize -- examples/java/Input.java --entry Input --stdin "5" --max-events 250 --timeout 10000
   ```

4. Lee la advertencia y escribe `AUTORIZAR`. Comparte con el agente únicamente el identificador de permiso generado.

El permiso contiene solo una huella SHA-256 y tiempos, no el código ni su ruta. Caduca a los cinco minutos, se consume atómicamente una vez y coincide con lenguaje, nombre, fuente, entrada, argumentos, entrada estándar y límites. Un parámetro enviado por el agente no puede crear el permiso.

La ejecución sigue sin estar aislada. Python o Java pueden acceder a archivos, red, procesos y variables de entorno con los permisos del usuario. Los límites de tiempo, eventos y salida reducen accidentes, pero no forman un sandbox. Para desactivar de nuevo la ejecución, elimina `CODEFLOW_MCP_EXECUTION` de la configuración y reinicia el cliente.

## Privacidad y distribución

- Todo el procesamiento principal es local.
- No hay cuentas, API keys, telemetría ni subidas automáticas.
- El servidor no lee proyectos por ruta ni escribe exportaciones.
- No incluyas secretos en el código, `stdin` o trazas: el agente que recibe el resultado puede verlos.
- Los archivos `.env`, configuraciones locales, credenciales, logs y trazas comunes están ignorados por Git, pero `.gitignore` no protege archivos ya versionados.
- El paquete continúa marcado como privado. No se ha publicado en npm.

Para desinstalar completamente, desconecta el servidor en cada cliente y elimina el clon. Los permisos de ejecución caducados no contienen fuente y pueden borrarse de la carpeta local de datos de CodeFlow Studio.

## Compatibilidad comprobada

La implementación y las pruebas automáticas se ejecutan en Windows. El servidor y sus rutas usan APIs portables de Node.js, y las configuraciones documentadas siguen los formatos oficiales de Codex, Claude Code y OpenCode. En esta revisión no se ejecutaron pruebas manuales en Linux ni macOS; deben validarse allí antes de afirmar compatibilidad completa de plataforma.
