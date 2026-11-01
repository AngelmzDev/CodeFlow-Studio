# CodeFlow Studio para Windows

La versión portable para Windows 10 y 11 (64 bits) es un único archivo `.exe`. Descarga [CodeFlow-Studio-Windows-x64.exe desde la última versión](https://github.com/AngelmzDev/CodeFlow-Studio/releases/latest). El archivo `.sha256` publicado junto al ejecutable permite comprobar su integridad.

Al abrir el ejecutable por primera vez, este prepara sus componentes en `%LOCALAPPDATA%\CodeFlowStudio`. La extracción puede tardar un poco y ocupar varios cientos de megabytes. Después, se abre la interfaz en el navegador predeterminado y aparece una ventana de CodeFlow Studio. Usa **Abrir** para mostrar la interfaz o **Cerrar** para detener el servicio local.

No hacen falta permisos de administrador, Node.js, Python ni Java instalados por separado. La aplicación incluye los entornos necesarios y los usa sin depender del `PATH` del sistema.

## Seguridad de Windows

El ejecutable no está firmado actualmente. Windows SmartScreen puede mostrar que el editor es desconocido al descargarlo o abrirlo. Comprueba que lo has obtenido de la página oficial de Releases y, si lo deseas, contrasta el archivo con el `.sha256`. No desactives el antivirus ni omitas las políticas de seguridad del equipo; si una política bloquea el archivo, consulta con el administrador.

## Licencias

El paquete conserva los avisos y licencias de los componentes incluidos. Consulta `LICENSE` para CodeFlow Studio y `THIRD_PARTY_NOTICES.md` para los entornos incluidos. El código fuente del repositorio, incluido su archivo ZIP, no es el ejecutable portable: utiliza el artefacto `.exe` de Releases.
