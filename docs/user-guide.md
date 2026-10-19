# Guía de usuario

Inicia el estudio con `npm start` y abre la dirección local que imprime el CLI. No necesitas una cuenta en la nube ni un proveedor de IA.

## Crear un diagrama estático

1. El modo **Básico** está seleccionado al abrir el estudio y el editor empieza vacío. Selecciona Python o Java y pega o escribe el código. También puedes pulsar **Cargar ejemplo** para insertar una muestra.
2. Pulsa **Crear diagrama**. CodeFlow Studio analiza la sintaxis del archivo, sin ejecutar el programa. Para Java que contiene clases, puedes elegir el diagrama de actividad de cada método y consultar el diagrama de clases.
3. Revisa la estructura. El diagrama de actividad representa un subconjunto de `if`, bucles, `return`, `break` y `continue`. No calcula condiciones ni predice qué camino se tomará al ejecutar. Las construcciones no compatibles aparecen como elementos opacos; la interfaz puede mostrar avisos.
4. Pulsa **Descargar SVG** para guardar el diagrama mostrado. La interfaz puede cambiar entre español e inglés y entre tema claro y oscuro; esas preferencias se conservan.

El análisis usa `ast.parse` de Python o `JavacTask.parse` de Java para obtener la estructura sintáctica. La interfaz presenta ramas posibles del código. Una línea destacada en este modo está asociada a la estructura del diagrama, no es evidencia de ejecución.

## Observar una ejecución real

El modo **Avanzado** conserva la vista de trazas. En **Básico**, puedes desplegar **Ver ejecución real (opcional)** para iniciar ese flujo. Antes de ejecutar, lee y acepta el consentimiento: el programa se ejecutará localmente con los permisos de tu sistema operativo.

1. Selecciona un lenguaje instalado. La disponibilidad y las capacidades dependen del adaptador detectado.
2. Importa o edita una fuente de un solo archivo. En Java, el nombre del archivo debe coincidir con la clase pública; la entrada opcional es el nombre completo de la clase. Importar y editar por sí mismos no ejecutan código.
3. Los argumentos se proporcionan como una matriz JSON de cadenas, por ejemplo `["hola", "42"]`. La entrada estándar se suministra por adelantado y termina en EOF al consumirse; no hay terminal interactiva.
4. Revisa la fuente, acepta el consentimiento de ejecución local y pulsa **Animar ejecución**. Los límites de tiempo y tamaño restringen la observación, pero no aíslan el programa.
5. Usa Siguiente/Anterior, la tira de eventos o el control deslizante para recorrer la traza. Una línea resaltada marca la instrucción a punto de ejecutarse. Sus efectos suelen aparecer en la instantánea siguiente. Una salida de método incluye su estado final y, si está disponible, el valor devuelto.
6. Reproducir, pausar y cambiar la velocidad solo controlan la reproducción de eventos ya grabados. Ir hacia atrás no vuelve a ejecutar el programa. Las flechas navegan fuera de los editores y la barra espaciadora activa o pausa la reproducción.
7. Las variables y referencias son observaciones del tiempo de ejecución. Los cambios y la disposición del diagrama son derivados. Las vistas de matrices y objetos son instantáneas acotadas, no un visor de toda la memoria. La traza no promete resultados exactos de condiciones ni eventos por cada iteración.
8. Puedes exportar HTML interactivo y autocontenido para abrirlo sin conexión, SVG del estado seleccionado o JSON para conservar e importar la traza. El HTML incluye fuente, valores y salida; revísalo antes de compartirlo.

Una traza limitada se marca como parcial. La interfaz acota la ventana de eventos, las vistas previas, los campos, las cadenas, los marcos, la salida y el tamaño total de la traza. Una traza parcial no representa una ejecución completa.

## Alcance

Solo Java y Python tienen adaptadores operativos. La ejecución se limita a programas secuenciales de un archivo fuente. Los diagramas estáticos interpretan un subconjunto de estructuras; no ejecutan ni evalúan expresiones. Los directorios de proyecto, la edición de varios archivos, los puntos de interrupción y la modificación de variables en vivo quedan fuera del alcance actual.

## Solución de problemas

- **Falta el entorno de ejecución:** ejecuta `node src/cli.ts doctor`. Configura `CODEFLOW_JAVA_HOME`/`JAVA_HOME` o `CODEFLOW_PYTHON` y reinicia el servicio.
- **Error de sintaxis:** revisa el aviso del analizador y la línea indicada. Para Java, confirma también que el nombre del archivo coincide con la clase pública.
- **Error de entrada:** proporciona todos los tokens necesarios en la entrada estándar. Llegar a EOF es intencional.
- **Traza parcial:** reduce la entrada o ajusta los límites del CLI dentro de los rangos permitidos. El código nativo y las alteraciones hostiles del trazado quedan fuera del modelo admitido.
- **Salida inesperada:** las salidas de Java que evitan el punto de finalización se marcan como anómalas. Las excepciones de Python se registran sin invocar el formato de texto definido por el usuario.
