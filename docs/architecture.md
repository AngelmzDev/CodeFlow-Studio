# Arquitectura

CodeFlow Studio separa el análisis estático de la observación de ejecuciones y de la presentación de ambos resultados:

    fuente ── adaptador opcional de análisis ── análisis neutral ── diagramas UML estáticos
       │
       └──── adaptador opcional de ejecución ── traza neutral ── reproducción y exportación

El núcleo define los contratos y formatos neutrales. Un adaptador de trazado puede añadir la capacidad opcional `analyze`. La compatibilidad con un formato compartido no implica soporte para todos los lenguajes. En esta versión, solo Java y Python tienen adaptadores operativos para análisis y trazado.

## Análisis estático

El modo Básico envía el texto fuente al adaptador disponible y recibe una estructura neutral de análisis, que incluye diagramas y diagnósticos. En Python, el adaptador usa `ast.parse`; en Java usa `JavacTask.parse`. Estas operaciones analizan sintaxis y estructura: no compilan ni ejecutan el programa objetivo, no evalúan condiciones y no producen valores de ejecución.

El analizador de actividad genera diagramas estáticos para un subconjunto de `if`, bucles, `return`, `break` y `continue`. Las ramas representan posibilidades estructurales. Las expresiones no se evalúan, por lo que el diagrama no señala qué rama ocurriría con una entrada concreta. Las construcciones fuera del subconjunto se conservan como elementos opacos y se pueden acompañar de avisos.

Cuando Java contiene clases, el análisis también ofrece un diagrama de clases y diagramas de actividad por método. Los gráficos se disponen en el cliente con `@dagrejs/dagre`, que es una dependencia de ejecución.

## Trazas de ejecución

Cada adaptador de ejecución ejecuta el programa objetivo y escribe registros de eventos privados delimitados por línea en su canal de protocolo. El anfitrión Node asigna identificadores estables y números de secuencia, valida los registros, calcula cambios entre instantáneas y produce el objeto de traza versionado. La salida del programa se captura por separado para no corromper el protocolo del adaptador.

Un evento contiene una parada observada, los marcos de llamada y valores disponibles, la salida acumulada y detalles opcionales. Los metadatos de capacidades indican qué vistas son pertinentes. Cuando la interfaz calcula diferencias o grafos, los identifica como derivados.

Una parada de ejecución señala la línea antes de que esta se ejecute; los efectos aparecen en el evento siguiente. Las instantáneas son inmutables. La reproducción permite recorrerlas hacia delante y hacia atrás sin rebobinar ni volver a ejecutar el depurador.

## Aplicación local

El CLI ofrece detección de entornos, servidor del estudio limitado a loopback, trazado y exportación. El cliente web usa el modelo de análisis para los diagramas estáticos y el mismo modelo de traza para ejecuciones locales y HTML autocontenido sin conexión. Las solicitudes de traza de la API requieren control del mismo origen y un token de sesión. No hay un servicio remoto de ejecución.

El modo Básico abre con el editor vacío y ofrece **Cargar ejemplo**. La interfaz admite español e inglés, y conserva las preferencias de idioma y tema claro u oscuro. La descarga SVG produce un archivo del diagrama actual; la exportación de trazas también ofrece HTML y JSON.

## Integración MCP

`src/mcp` añade una capa de transporte y validación sobre los servicios existentes. No contiene analizadores, trazadores ni renderizadores alternativos: delega en `AdapterRegistry`, las visualizaciones, la explicación determinista y el exportador compartidos. El transporte `stdio` limita los mensajes, reserva `stdout` para JSON-RPC y devuelve resultados estructurados con procedencia explícita.

Las herramientas MCP no aceptan rutas de lectura ni escritura. El análisis recibe fuente en memoria y las exportaciones devuelven contenido. La ejecución permanece cerrada salvo que el proceso se configure para aceptar permisos y encuentre un permiso local, breve, de un uso y ligado a la huella de la solicitud exacta. La concesión se crea en otra terminal; no puede sustituirse por un indicador dentro de la propia llamada MCP.

## Límites de ejecución

Java usa Java Debug Interface (JDI) del JDK seleccionado y admite un archivo fuente, incluidas clases anidadas, con ejecución secuencial. Python usa `sys.settrace` para un único archivo objetivo y ejecución secuencial. Ambos adaptadores observan líneas; no prometen memoria a nivel de instrucción, resultados exactos de condiciones ni eventos por cada iteración. El entorno de ejecución determina qué variables locales y detalles de objetos están disponibles.

La ejecución se realiza con los permisos del usuario actual. Los límites de tiempo, eventos, memoria y salida son salvaguardas de mejor esfuerzo, no ofrecen aislamiento. Consulta [Seguridad](../SECURITY.md).

## Extensión

Un cliente futuro del Debug Adapter Protocol (DAP) podría negociar capacidades con depuradores compatibles. CodeFlow Studio no ofrece hoy un adaptador DAP genérico. Tree-sitter podría ayudar a reconocer sintaxis y estructura, pero analizar sintaxis no ejecuta ni traza un programa y no constituye por sí solo un adaptador de ejecución. Consulta [ADR 0002](adr/0002-future-adapter-interfaces.md).

## Agradecimientos de diseño

La arquitectura toma inspiración del enfoque de semántica de diagramas, perfiles y validación determinista de HTML de [diagram-design](https://github.com/cathrynlavery/diagram-design). No se reutilizaron código ni plantillas.
