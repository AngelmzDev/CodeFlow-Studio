# Modo de estudiantes y UML estático

El modo Básico muestra un editor vacío, lenguaje, creación de diagrama, actividad o clases, selección de método, ampliación y descarga SVG. Español/inglés, tema claro/oscuro y modo se conservan localmente. Avanzado mantiene los controles de depuración y las trazas reales. La animación es opcional y requiere consentimiento de ejecución local.

## Contrato independiente del lenguaje

Los tipos están en `src/core/analysis-types.ts` y se validan mediante `validateAnalysis` en `src/core/analysis.ts`.

`Analysis` contiene versión 1.0, lenguaje, `provenance: "static"`, fuente, entrada principal opcional, actividad predeterminada, actividades, clases y diagnósticos. Cada actividad tiene nodos, aristas, ubicaciones y avisos. Las clases contienen declaraciones de campos, firmas de métodos y relaciones declaradas.

Los límites son 100.000 caracteres y 10.000 líneas de fuente, 24 actividades, 200 nodos y 600 aristas por actividad, 24 clases y 64 campos/métodos por clase. La validación comprueba coincidencia de fuente y lenguaje, ubicaciones, identificadores únicos y extremos de aristas. Las omisiones se comunican.

## Análisis y API

Un adaptador de trazado puede añadir `analyze` y declarar `analysis: true` cuando está disponible. Los adaptadores sin análisis siguen pudiendo producir trazas.

`POST /api/analyze` recibe `{language, source, filename?, entry?}` y devuelve un análisis o un error. Usa el mismo origen y token local, sin requerir consentimiento de ejecución.

Python usa `ast.parse`; Java usa `JavacTask.parse` con procesadores desactivados. Ninguno ejecuta, importa ni evalúa el programa objetivo. Los analizadores modelan un subconjunto de bloques, ramas, bucles y transferencias; los casos no modelados aparecen como notas opacas con avisos. Las clases representan declaraciones, no objetos observados.

## Visualización y reproducción

El SVG se genera localmente con Dagre y etiquetas escapadas. La actividad usa inicio/final, acciones, decisiones/uniones y aristas. La generalización de clases usa triángulos vacíos; la realización utiliza línea discontinua. Solo se enlazan tipos resolubles sin ambigüedad.

La reproducción destaca líneas observadas; no afirma resultados de condiciones ni caminos ejecutados. Editar la fuente invalida el diagrama y su descarga.

Los HTML de trazas admiten un bloque opcional `embedded-analysis`, validado contra la misma fuente y lenguaje. Conservan diagramas y reproducción sin peticiones de red. Los HTML anteriores siguen reproduciendo la traza y muestran un estado vacío para UML.

Las pruebas cubren ambos lenguajes, ausencia de efectos laterales al analizar, Unicode/CRLF, sintaxis inválida, límites, construcciones opacas, clases, edición, idiomas, temas, móvil, animación real y exportación sin conexión. Solo Java y Python se anuncian como operativos.
