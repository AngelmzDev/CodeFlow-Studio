# Guía para estudiantes

CodeFlow Studio presenta el trabajo en tres apartados: **Código**, **Diagrama** y **Paso a paso**. Puedes estudiar primero la estructura estática; crear un diagrama no ejecuta el programa ni requiere aceptar el consentimiento de ejecución.

## Código

Escribe o pega código Java o Python, importa un archivo o carga un ejemplo. Importar y editar no ejecuta código. Los lenguajes disponibles dependen de los entornos instalados. Usa **Ctrl+Enter** para crear un diagrama y **Ctrl+Shift+Enter** para iniciar una ejecución; esta última acción mantiene el consentimiento explícito.

## Diagrama

El diagrama de actividad muestra estructura posible, como ramas y bucles. No calcula expresiones ni decide qué rama tomarían unos datos concretos. En Java se representan las alternativas de expresiones ternarias y de `switch` con flechas (`case ... ->`). El `switch` con etiquetas `case:` y las expresiones `switch` se muestran como pasos opacos. Otras construcciones fuera del subconjunto compatible también pueden aparecer como opacas o acompañadas de avisos. Java con clases permite consultar también el diagrama de clases.

Usa los controles de zoom y descarga el diagrama como SVG o JPG.

## Paso a paso

La ejecución es opcional. Lee y acepta el consentimiento antes de iniciar: el programa corre en tu equipo con los permisos de tu usuario. Ejecuta únicamente código de confianza. Los campos de entrada, argumentos y clase de entrada están plegados bajo **Entrada y opciones**; puedes dejarlos cerrados si no los necesitas.

Java se traza mediante JDI y Python mediante `sys.settrace`. La ejecución Java compila con `--enable-preview` y la versión del JDK detectado. Una parada registra la ubicación **antes** de la instrucción indicada. Por eso, los cambios que provoca suelen aparecer en la instantánea siguiente. Los controles de reproducción recorren instantáneas ya registradas; retroceder no vuelve a ejecutar el programa ni permite modificar variables durante la ejecución.

El apartado reúne la línea actual, variables y cambios observados, la explicación didáctica y la salida de consola. Distingue los datos observados de las vistas derivadas por la interfaz. Una línea resaltada es la instrucción a punto de ejecutarse, no prueba de que una condición sea verdadera. Algunas variables, objetos o detalles pueden faltar según el lenguaje y el entorno. Una traza marcada como parcial alcanzó un límite de observación.

La explicación determinista sigue disponible. Puedes abrir sus detalles para cambiar entre nivel breve y detallado o activar una explicación adicional de IA local. El texto generado por IA se etiqueta aparte, puede contener errores y no sustituye los datos observados. Para usar Ollama configura en `.codeflow.local.json` un modelo que ya esté instalado:

```json
{
  "ai": {
    "provider": "ollama",
    "model": "modelo-local-ejemplo",
    "baseUrl": "http://127.0.0.1:11434"
  }
}
```

Sustituye el nombre de ejemplo por el de tu modelo. No necesitas IA para usar la aplicación; si Ollama no está disponible, puedes seguir usando la explicación determinista. La integración se ha comprobado con un servidor simulado; el comportamiento real depende del modelo instalado.

Abre **Guardar o abrir una ejecución** para importar una traza o descargarla como JSON, guardar el estado seleccionado como SVG o exportar HTML autocontenido que se abre sin conexión. Revisa cualquier exportación antes de compartirla: puede incluir código fuente, valores y salida.

La ejecución local no está aislada. Los límites de tiempo, eventos, memoria y salida son salvaguardas de mejor esfuerzo. Consulta [Seguridad](../SECURITY.md) y la [guía de usuario](user-guide.md) para más información sobre alcance y solución de problemas.
