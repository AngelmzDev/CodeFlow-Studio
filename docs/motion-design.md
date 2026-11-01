# Diseño de movimiento para seguir la ejecución

CodeFlow Studio usa movimiento breve para ayudar a ubicar una instrucción y leer el cambio de estado asociado. La interfaz no convierte el diagrama estático en una predicción del programa: el resaltado se deriva de eventos observados en la traza y respeta su orden temporal.

## Decisiones de diseño

- **Separar intención y evidencia.** La tarjeta `#step-guide` presenta la acción pendiente de la instrucción seleccionada y, en una sección aparte, los cambios observados entre el evento anterior y el actual. Así, una asignación que todavía está por ejecutarse no se confunde con el valor que aparecerá después. La lógica está en `web/step-guide.js` y su presentación en `web/app.js`.
- **Dar un foco legible.** Los nodos del diagrama usan texto SVG de 15 px y resaltan la línea activa; las líneas ya recorridas se distinguen como visitadas. El estado del nodo cambia sin sustituir el SVG en cada movimiento por la traza. El renderizado y sus estilos están en `src/visualization/activity.ts`; la sincronización con el depurador está en `web/app.js`.
- **Usar transiciones cortas y discretas.** El cambio de relleno y contorno de nodos dura 220 ms. Las aristas mantienen su función de conexión estructural y no reciben resaltado de ejecución. La preferencia del sistema `prefers-reduced-motion` elimina la transición.
- **Permitir controlar el seguimiento.** `#diagram-follow` activa el desplazamiento del diagrama hacia el nodo activo cuando hace falta. El estudiante puede desactivarlo; navegar por la traza sigue actualizando la línea y los valores.
- **Mantener la experiencia bilingüe.** Los títulos, instrucciones y descripciones del diagrama se localizan en español e inglés junto con el resto de la interfaz.

## Referencias examinadas

Las referencias aportaron gramática de movimiento y organización didáctica; la implementación de CodeFlow Studio es propia y no copia código, assets ni frameworks de esos proyectos.

- [Motion FX Lab](https://github.com/howardc38/motion-fx-lab) tiene licencia 0BSD. Se estudiaron `examples/infographic.html` (revelado de énfasis y escenas vinculadas a datos), `examples/dot-story.html` (continuidad visual entre etapas) y `fx/design/README.md` (estudios de trazo y movimiento). En la copia local: `T:\Angel\GithubInteresantes\repos animaciones\howardc38--motion-fx-lab\`.
- [SaaS Motion Kit](https://github.com/tugrawork-creator/saas-motion-kit) tiene licencia MIT; sus fuentes tipográficas tienen licencia OFL separada. Se estudiaron `examples/acme-suite-loop/STORYBOARD.md` (registro por paso de ritmo, tono, transición y duración) y `creative/tone-matrix.md` (relación entre tono y ritmo). En la copia local: `T:\Angel\GithubInteresantes\repos animaciones\tugrawork-creator--saas-motion-kit\`.
- HyperFrames se evaluó bajo Apache-2.0, pero no se instaló ni se integró. Su modelo de clips y GSAP no se necesita para resaltar SVG y controlar una traza en el navegador.
- Remotion no se integró: se centra en React y composición de vídeo, mientras CodeFlow Studio anima SVG y DOM existentes. No se añadieron dependencias de movimiento.

## Límites semánticos

El paso actual describe la parada registrada por el depurador, que puede ser **antes** de ejecutar la instrucción señalada. Por eso la tarjeta separa la acción pendiente de los cambios ya observados y compara el estado actual con el evento cronológicamente anterior, incluso al retroceder en el visor. El diagrama representa estructura posible: sus flechas indican conexiones y ramas del programa, no el resultado de evaluar una condición. La interfaz debe conservar esta distinción en futuros cambios visuales.

La prueba de interacción asociada está en `tests/e2e/motion.spec.ts`; cubre una traza Python real, navegación hacia atrás y adelante, identidad del SVG, tema, movimiento reducido y ancho móvil.
