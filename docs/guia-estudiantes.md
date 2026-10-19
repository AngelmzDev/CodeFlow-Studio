# Guía para estudiantes

CodeFlow Studio permite explorar la estructura de un programa y, de forma opcional, observar una ejecución real. Puedes empezar con análisis estático: no ejecuta el código ni requiere aceptar el consentimiento de ejecución.

## Crear y explorar un diagrama

1. Inicia la aplicación siguiendo las instrucciones de [instalación](../README.md#instalación-desde-el-código-fuente).
2. En el modo **Básico**, selecciona Java o Python y escribe o pega el código en el editor. **Cargar ejemplo** inserta una muestra.
3. Pulsa **Crear diagrama**. El análisis genera un diagrama de actividad; si el código Java declara clases, puedes consultar también el diagrama de clases.
4. Usa los controles de zoom o mantén Ctrl mientras giras la rueda del ratón sobre el diagrama. Puedes descargarlo como SVG o JPG.

El diagrama representa estructura sintáctica, como ramas y bucles. No ejecuta instrucciones, no calcula expresiones y no decide qué rama se tomaría con unos datos concretos. En Java se representan las alternativas de expresiones ternarias y de `switch` con flechas (`case ... ->`). El `switch` con etiquetas `case:` y las expresiones `switch` se muestran como pasos opacos. Otras construcciones que quedan fuera del subconjunto compatible también pueden aparecer como opacas o acompañadas de avisos.

## Observar una ejecución

La ejecución es opcional. El modo **Avanzado** permite generar una traza; en el modo Básico también se puede abrir la sección **Ver ejecución real (opcional)**. Lee y acepta el consentimiento antes de iniciar: el código se ejecutará en tu equipo con los permisos de tu usuario. Ejecuta únicamente código de confianza.

Java se traza mediante JDI y Python mediante `sys.settrace`. Una parada registra la ubicación **antes** de la instrucción indicada. Por eso, los cambios que provoca suelen aparecer en la instantánea siguiente. La reproducción permite recorrer instantáneas ya registradas hacia delante y hacia atrás; retroceder no vuelve a ejecutar el programa.

La ejecución Java compila con `--enable-preview` y la versión del JDK detectado.

Al explorar una traza:

- Distingue los datos observados durante la ejecución de los cambios y diagramas derivados por la interfaz.
- Interpreta una línea resaltada como la instrucción que está a punto de ejecutarse, no como prueba de que una condición sea verdadera.
- El diagrama de secuencia se construye solo con llamadas y retornos presentes en la traza hasta el paso seleccionado. Si un evento no se observó, el diagrama no lo deduce del texto fuente.
- Ten en cuenta que la información disponible depende del lenguaje y del entorno: algunas variables, objetos o detalles pueden no estar presentes.
- Si la traza está marcada como parcial, se alcanzó un límite de observación y no se registró toda la ejecución.
- Puedes descargar la traza en JSON o exportar un SVG del estado seleccionado y un HTML autocontenido que se abre sin conexión. Revisa el contenido antes de compartirlo: puede incluir código fuente, valores y salida.

La ejecución local no está aislada. Los límites de tiempo, eventos, memoria y salida son salvaguardas de mejor esfuerzo. Consulta [Seguridad](../SECURITY.md) y la [guía de usuario](user-guide.md) para más información sobre alcance, controles y solución de problemas.

## Explicación y organización del espacio de trabajo

El panel de explicación sigue el paso seleccionado y ofrece una explicación determinista en español o inglés, en modo breve o detallado. Muestra por separado la evidencia observada y las notas que explican sus límites. Una instantánea anterior a una instrucción no demuestra qué resultado tendrá esa instrucción.

Puedes activar la explicación adicional con IA local si añades el bloque `ai` a `.codeflow.local.json`. El siguiente valor de `model` es solo un ejemplo: sustitúyelo por el nombre exacto de un modelo que ya esté instalado. No hace falta descargar ningún modelo para usar CodeFlow Studio.

```json
{
  "ai": {
    "provider": "ollama",
    "model": "modelo-local-ejemplo",
    "baseUrl": "http://127.0.0.1:11434"
  }
}
```

CodeFlow Studio se comunica con el endpoint local de chat de Ollama. Consulta la [documentación oficial de la API de chat](https://docs.ollama.com/api/chat). En esta máquina no hay un modelo local configurado; la integración se ha comprobado con un servidor simulado. La calidad con un modelo real requiere un modelo instalado y validación con ese modelo. El texto generado por IA se etiqueta aparte, puede contener errores y no sustituye a los datos observados. Si Ollama no está disponible, puedes seguir usando la explicación determinista.

Puedes reordenar los paneles de consola, estado, secuencia y explicación; redimensionar todos esos paneles y también el editor y el diagrama estático; y restaurar la disposición predeterminada. Las preferencias de tamaño y orden se guardan localmente.

CodeFlow Studio continúa en desarrollo activo. Se incorporarán nuevas funcionalidades, mejoras de visualización, optimizaciones y herramientas educativas en futuras versiones.
