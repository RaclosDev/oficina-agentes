# Oficina de agentes

Una oficina pixel para tus sesiones de Claude Code y Codex. Cada sesión es un personaje en su escritorio que teclea cuando está trabajando y se echa una siesta cuando está en pausa. La oficina vive en una ventana flotante que se queda siempre encima.

## Qué hace

Claude Code y Codex comparten la ventana flotante, los filtros por proyecto y los avisos al terminar un turno. En Claude Code, la oficina también se integra con la barra lateral y el panel de la app.

- **Chats activos y recientes** con su título, aplicación, proyecto, PR y tiempo en pausa. Los chats en pausa durante al menos 24 horas aparecen en **Ver anteriores**.
- **Ventana flotante siempre encima** (Windows): una ventana compacta que se ajusta al número de sesiones, se pliega con ▾ y crece al ensancharla. En otros sistemas usa el Picture-in-Picture del navegador.
- **Un clic para ir al chat** en Claude o Codex.
- **Como una barra lateral**: marca la sesión que tienes abierta, pone «Nuevo» en las que han terminado desde la última vez que las viste, y agrupa por tus grupos de la barra lateral con las fijadas arriba. Con muchas sesiones aparece un buscador.
- **Qué está haciendo cada una**: «Editando archivos…», «Ejecutando comandos…» mientras trabaja, o la primera frase de su último mensaje cuando para.
- **Todo lo de la barra lateral en el menú ⋯** de cada tarjeta: abrir, fijar, renombrar, mover a otro grupo, marcar como no leída, detener, archivar y eliminar (detener y eliminar con confirmación; eliminar pide además tu aprobación en la app).
- **Arrastra una tarjeta** a otro grupo, a Fijadas o a Sin grupo: aparece una barra para soltarla, y también vale soltarla sobre una sección o sobre otra tarjeta.
- **＋ Nuevo chat** en la cabecera.
- **Departamentos**: filtra por proyecto; cada uno tiene su propia decoración (suelo y alfombra), que puedes cambiar con 🎨.
- **Aviso cuando una sesión termina** (sonido y notificación del sistema), opcional.
- **20 idiomas**, en la rueda ⚙: español, inglés, chino, hindi, francés, árabe, bengalí, portugués, ruso, urdu, indonesio, alemán, japonés, maratí, telugu, turco, tamil, vietnamita, coreano e italiano.

## Instalación

### Claude Code

En la app de escritorio de Claude: pulsa **+** junto al cuadro de mensaje → **Plugins** → **Add marketplace** con `RaclosDev/oficina-agentes` → **Add plugin** → **oficina-agentes**.

En una sesión de terminal:

```
/plugin install oficina-agentes --marketplace RaclosDev/oficina-agentes
```

Desde una shell:

```bash
claude plugin install oficina-agentes --marketplace RaclosDev/oficina-agentes
```

Necesita **Node.js 18 o superior** en el PATH (el plugin arranca un pequeño servidor local) y, para la ventana flotante fija, Windows con Microsoft Edge.

### Codex

Con una versión de Codex que admita plugins con hooks y **Node.js 18 o superior** en el PATH, instala el plugin desde una terminal:

```bash
codex plugin marketplace add RaclosDev/oficina-agentes
codex plugin add oficina-agentes@oficina-agentes
```

Abre Codex en la terminal, escribe `/hooks` y revisa y habilita los hooks de **oficina-agentes**. Abre o reanuda un chat local y envía un mensaje. La oficina arranca en [127.0.0.1:3210](http://127.0.0.1:3210). Pulsa **Flotar** para abrir la ventana flotante. Cada tarjeta de Codex muestra el proyecto y el estado del turno y permite abrir el chat en la app de escritorio.

Si ya usabas la oficina con Claude, actualiza también su plugin y reinicia el proceso de Node que sirve la oficina para cargar la nueva versión. Ambos plugins comparten el puerto 3210.

Las tarjetas de Codex aparecen al recibir actividad de un chat local y se retiran cuando Codex comunica su cierre. El historial, los grupos y las acciones de gestión descritas arriba corresponden a Claude.

## Uso

- `/oficina` abre la ventana flotante (o la página en tu navegador si no se puede fijar).
- `/oficina-panel` abre la oficina junto al chat, dentro de Claude.
- `/oficina-permisos` te dice si ya tienes los permisos que necesitan las acciones del menú.

La página está en `http://127.0.0.1:3210` cuando el servidor local está en marcha.

## Permisos

Un plugin no puede concederse permisos a sí mismo. Para que las acciones del menú funcionen sin que te pregunte cada vez (y en modo automático), añade estas reglas a `permissions.allow` en `~/.claude/settings.json`:

```json
"mcp__ccd_session_mgmt__stop_session",
"mcp__ccd_session_mgmt__archive_session",
"mcp__ccd_sidebar__set_pinned",
"mcp__ccd_session_mgmt__set_session_title",
"mcp__ccd_sidebar__move_sessions",
"mcp__ccd_sidebar__set_unread"
```

La primera vez que se carga, el plugin te avisa si faltan. Eliminar una sesión siempre pide tu aprobación, tengas las reglas o no.

## Cómo funciona

Cada sesión de Claude con el plugin pide a la app la lista de sesiones cada 15 segundos y la envía a un servidor local sin dependencias (`server/server.mjs`), que solo escucha en `127.0.0.1:3210`. La página recibe los cambios al momento. Las acciones (detener, archivar, eliminar) que pides en la página las ejecuta una sesión de Claude a través de la app, con tus permisos de siempre. Abrir una sesión pasa su enlace `claude://` al sistema.

Los hooks de Codex envían al mismo servidor el tipo de evento, los identificadores del chat y del turno y el nombre de la carpeta. El servidor conserva las tarjetas en memoria, lee los títulos del índice local de Codex (`session_index.jsonl`) y abre sus enlaces `codex://threads/…` en la app. Los mensajes y el historial de Codex se quedan en Codex.

El servidor solo acepta escrituras con una cabecera propia que una web ajena no puede enviar. Los datos de la oficina se quedan en tu ordenador.

## Licencia

MIT
