# Oficina de agentes

Una oficina pixel con todas tus sesiones de Claude Code. Cada sesión es un personaje en su escritorio: teclea cuando la sesión está trabajando y se echa una siesta cuando está en pausa. La oficina vive en una ventana flotante que se queda siempre encima, para que veas de un vistazo qué está haciendo cada agente mientras trabajas en otra cosa.

## Qué hace

- **Todas tus sesiones de un vistazo**: título, proyecto (carpeta), grupo de la barra lateral, PR y cuánto lleva en pausa.
- **Ventana flotante siempre encima** (Windows): una ventana compacta que se ajusta al número de sesiones, se pliega con ▾ y crece al ensancharla. En otros sistemas usa el Picture-in-Picture del navegador.
- **Un clic para ir a la sesión** en la app de Claude.
- **Como una barra lateral**: marca la sesión que tienes abierta, pone «Nuevo» en las que han terminado desde la última vez que las viste, y agrupa por tus grupos de la barra lateral con las fijadas arriba. Con muchas sesiones aparece un buscador.
- **Qué está haciendo cada una**: «Editando archivos…», «Ejecutando comandos…» mientras trabaja, o la primera frase de su último mensaje cuando para.
- **Todo lo de la barra lateral en el menú ⋯** de cada tarjeta: abrir, fijar, renombrar, mover a otro grupo, marcar como no leída, detener, archivar y eliminar (estas tres con confirmación; eliminar pide además tu aprobación en la app).
- **Arrastra una tarjeta** a otro grupo, a Fijadas o a Sin grupo: aparece una barra para soltarla, y también vale soltarla sobre una sección o sobre otra tarjeta.
- **＋ Nuevo chat** en la cabecera.
- **Departamentos**: filtra por proyecto; cada uno tiene su propia decoración (suelo y alfombra), que puedes cambiar con 🎨.
- **Aviso cuando una sesión termina** (sonido y notificación del sistema), opcional.
- **20 idiomas**, en la rueda ⚙: español, inglés, chino, hindi, francés, árabe, bengalí, portugués, ruso, urdu, indonesio, alemán, japonés, maratí, telugu, turco, tamil, vietnamita, coreano e italiano.

## Instalación

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

## Uso

- `/oficina` abre la ventana flotante (o la página en tu navegador si no se puede fijar).
- `/oficina-panel` abre la oficina junto al chat, dentro de Claude.
- `/oficina-permisos` te dice si ya tienes los permisos que necesitan las acciones del menú.

La página también está en `http://127.0.0.1:3210` mientras haya una sesión de Claude abierta.

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

El servidor solo acepta escrituras con una cabecera propia que una web ajena no puede enviar, y solo abre enlaces de sesiones de Claude. No envía nada fuera de tu ordenador.

## Licencia

MIT
