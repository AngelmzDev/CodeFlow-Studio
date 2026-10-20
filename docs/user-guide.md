# Guía de usuario

Inicia el estudio con `npm start` y abre la dirección local que imprime el CLI. No necesitas una cuenta en la nube ni un proveedor de IA. La interfaz tiene tres apartados: **Código**, **Diagrama** y **Paso a paso**.

## Código

El editor comienza vacío. Selecciona Java o Python, escribe o pega la fuente, impórtala desde un archivo o pulsa **Cargar ejemplo**. Importar y editar no ejecutan código. La disponibilidad del análisis y la ejecución depende de los entornos detectados. Pulsa **Crear diagrama** o usa Ctrl+Enter para analizar la fuente sin ejecutarla. Usa Ctrl+Shift+Enter para solicitar una ejecución con consentimiento.

## Diagrama

El análisis genera un diagrama de actividad y, para Java con clases, permite consultar también el diagrama de clases. El diagrama estático representa un subconjunto de `if`, bucles, `return`, `break` y `continue`. No calcula condiciones ni predice qué camino se tomará durante la ejecución. Las construcciones no compatibles aparecen como elementos opacos; la interfaz puede mostrar avisos.

La interfaz permite ajustar el zoom y descargar el diagrama como SVG o JPG. Los diagramas usan Dagre y ajustan su geometría al contenido representado.

## Paso a paso

La ejecución requiere aceptar el consentimiento antes de iniciar; el programa se ejecuta localmente con los permisos del sistema operativo. Solo ejecútalo con código de confianza. Los campos de entrada estándar, argumentos y clase de entrada están plegados bajo **Entrada y opciones**. Java admite una fuente de un solo archivo; el nombre del archivo debe coincidir con la clase pública. La clase de entrada, si hace falta, se indica en las opciones. Los argumentos son una matriz JSON de cadenas, por ejemplo `["hola", "42"]`. La entrada estándar se proporciona por adelantado y termina en EOF al consumirse; no hay una terminal interactiva.

Una ubicación de traza se registra **antes** de la instrucción indicada. Sus efectos suelen aparecer en la instantánea siguiente. Siguiente, Anterior, la tira de eventos y el control deslizante recorren instantáneas registradas. Reproducir, pausar y cambiar la velocidad controlan esa reproducción; retroceder no vuelve a ejecutar el programa. Las flechas navegan fuera de los editores y la barra espaciadora activa o pausa.

El apartado agrupa la línea actual, variables y cambios, explicación didáctica y consola. Las variables y referencias son observaciones del tiempo de ejecución. Los cambios y la disposición del diagrama son derivados. Las vistas de matrices y objetos son instantáneas acotadas, no un visor de toda la memoria. La traza no promete resultados exactos de condiciones ni eventos por cada iteración. Una traza limitada se marca como parcial.

La explicación determinista se adapta al paso seleccionado. En sus detalles puedes cambiar el nivel breve o detallado y activar una explicación adicional con IA local. La IA es opcional, puede contener errores y se etiqueta aparte de los hechos observados; si Ollama no está disponible, se conserva la explicación determinista.

Bajo **Guardar o abrir una ejecución** puedes importar una traza y descargarla como JSON, guardar el SVG del estado seleccionado o exportar HTML interactivo autocontenido para abrirlo sin conexión. El HTML incluye fuente, valores y salida; revisa el contenido antes de compartirlo.

La ejecución acota la ventana de eventos, las vistas previas, campos, cadenas, marcos, salida y tamaño total de la traza. No proporciona depuración interactiva con modificación de variables ni una sesión de entrada por terminal. La ejecución local no está aislada; sus límites son salvaguardas de mejor esfuerzo.

## Alcance y solución de problemas

Solo Java y Python tienen adaptadores operativos. La ejecución se limita a programas secuenciales de un archivo fuente. Los diagramas estáticos interpretan un subconjunto de estructuras y no evalúan expresiones. Los directorios de proyecto, la edición de varios archivos, los puntos de interrupción y la modificación de variables en vivo quedan fuera del alcance actual.

- **Falta el entorno de ejecución:** ejecuta `node src/cli.ts doctor`. Configura `CODEFLOW_JAVA_HOME`/`JAVA_HOME` o `CODEFLOW_PYTHON` y reinicia el servicio.
- **Error de sintaxis:** revisa el aviso del analizador y la línea indicada. Para Java, confirma también que el nombre del archivo coincide con la clase pública.
- **Error de entrada:** proporciona todos los tokens necesarios en la entrada estándar. Llegar a EOF es intencional.
- **Traza parcial:** reduce la entrada o ajusta los límites del CLI dentro de los rangos permitidos. El código nativo y las alteraciones hostiles del trazado quedan fuera del modelo admitido.
- **Salida inesperada:** las salidas de Java que evitan el punto de finalización se marcan como anómalas. Las excepciones de Python se registran sin invocar el formato de texto definido por el usuario.
