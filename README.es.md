<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)"  srcset="lydia-comer/Airbladder06.webp">
    <source media="(prefers-color-scheme: light)" srcset="lydia-comer/Airbladder02.webp">
    <img alt="Air Bladder" src="lydia-comer/Airbladder01.webp" width="520">
  </picture>
</p>

<div align="center">

### [Visita el sitio web de Air Bladder →](https://domfortunato.github.io/air-bladder/)

<sub>(en inglés)</sub>

[English](README.md) · **Español**

<sub>Esta traducción puede estar desactualizada; el README en inglés es la versión de referencia.</sub>

</div>

<!--
  Traducción al español (Latinoamérica).

  MANTENIMIENTO: este archivo lo mantiene el proyecto, NO el traductor del
  sistema. La traducción del juego (lang/es.json, lang/content/es.json) es obra
  de un traductor humano; este README es documentación del proyecto y se
  actualiza junto con README.md, que es la versión de referencia. Al cambiar
  README.md, actualiza también este archivo.

  Términos por confirmar contra la "Guía del jugador" oficial de Cairn 2e, para
  que coincidan con la traducción dentro del sistema:
    Warden  -> "Custodio"    (provisional)
    hireling -> "asalariado"  (provisional)
  Los nombres propios, ediciones (Cairn 2e, Barebones) y licencias no se traducen.
-->

Un sistema de juego para [Foundry VTT](https://foundryvtt.com) para jugar contenido de **Cairn 2e** y de la **Edición Barebones de Cairn**: trasfondos detallados, algunas opciones que añaden funciones de 2e a las hojas Barebones, y tablas del Custodio de 2e. **Compatible con [Cairn](https://cairnrpg.com) de Yochai Gal.**

## Resumen

Air Bladder es un sistema complementario amigable, no el sistema oficial de Cairn. Desciende de [yochaigal/Cairn-FoundryVTT](https://github.com/yochaigal/Cairn-FoundryVTT) (de Yochai Gal y Oskar Świda), que a su vez desciende del sistema Electric Bastionland y de Into the Odd. *Air Bladder* es el primer objeto de la tabla de Equipo en la p. 17 de la Guía del jugador de Cairn 2e.

## Características principales

- Generación aleatoria o manual de personajes tanto de Cairn 2e como de Cairn Barebones; cada estilo se puede activar o desactivar.
- Las hojas Barebones admiten funciones caseras (homebrew) opcionales.
- Trasfondos personalizados de 2e creados por el Custodio: créalos, previsualízalos, revísalos y [compártelos entre mundos](https://github.com/domfortunato/air-bladder/blob/master/docs/sharing-custom-backgrounds.md).
- Generación aleatoria o manual de hojas de asalariados.
- Ayudas contextuales para jugadores.
- Mercado y contenedores.
- Tablas orientadas al Custodio.
- Una galería de 80 retratos de personaje con licencia CC BY 4.0, de [Jon Aspeheim](https://jonaspeheim.itch.io/).
- Automatización mínima.

## Capturas de pantalla

<table>
  <tr>
    <td><img src="https://raw.githubusercontent.com/domfortunato/air-bladder/master/docs/images/sheet-items.png" alt="Hoja de personaje — pestaña de Objetos" width="250"></td>
    <td><img src="https://raw.githubusercontent.com/domfortunato/air-bladder/master/docs/images/sheet-description.png" alt="Hoja de personaje — pestaña de Descripción" width="250"></td>
    <td><img src="https://raw.githubusercontent.com/domfortunato/air-bladder/master/docs/images/sheet-background-notes.png" alt="Hoja de personaje — pestaña de Trasfondo y notas" width="250"></td>
  </tr>
</table>

*La hoja de personaje: pestañas de Objetos, Descripción, y Trasfondo y notas. La franja roja es la condición automática de **Daño Crítico**, que aparece cuando la FUE recibe daño.*

<img src="https://raw.githubusercontent.com/domfortunato/air-bladder/master/docs/images/game-settings.png" alt="La configuración de juego del Custodio" width="480">

*La configuración de juego del Custodio, agrupada por secciones.*

## Estado

Desarrollo temprano y activo. ¡Envía comentarios y arte! El sistema se está reconstruyendo sobre la arquitectura de **compendios editables** del original: el equipo vive en compendios de objetos que el Custodio puede editar en un solo lugar, y la generación de personajes y el mercado hacen referencia a esos compendios por su nombre.

## Idiomas

La interfaz está traducida al **español** (el 82 % de las cadenas actuales, por [Malecho](https://github.com/fsmalecho)), y el *contenido* del juego —trasfondos, objetos, hechizos, tablas— está traducido únicamente al español.

Los archivos de interfaz en alemán, danés, francés, polaco y portugués de Brasil se heredaron del sistema original de Cairn. Cubren entre el **15 % y el 30 %** de la interfaz actual, son anteriores a la mayoría de las funciones de este sistema y **no reciben mantenimiento**: en la práctica, una partida en esos idiomas está mayormente en inglés. Todo lo que no esté traducido recae en el inglés cadena por cadena, así que una traducción parcial siempre se puede usar en lugar de quedar rota.

Las herramientas son independientes del idioma (`--lang <código>` en todas), así que un idioma nuevo no requiere ningún cambio de código: solo un traductor.

**Traductores bienvenidos** — consulta [docs/TRANSLATING.md](https://github.com/domfortunato/air-bladder/blob/master/docs/TRANSLATING.md) (en inglés) para el flujo sin programación, o [docs/translating-self-service.md](https://github.com/domfortunato/air-bladder/blob/master/docs/translating-self-service.md) si prefieres trabajar con git.

## Instalación (manual)

**Requiere Foundry VTT v14.**

1. En el menú **Sistemas de juego** de Foundry, haz clic en **Instalar sistema**.
2. Ingresa la URL del manifiesto: `https://github.com/domfortunato/air-bladder/releases/latest/download/system.json`

Para desarrollo, clona este repositorio en `Data/systems/air-bladder` (una unión de directorios / *junction* funciona), ejecuta `npm install` y luego `npm run build:packs` antes de iniciar Foundry. `npm run dev:smoke` realiza una carga sin interfaz (*headless*) como verificación básica.

## Divulgación sobre IA

**El arte generado por IA nunca aparecerá en este repositorio, jamás.** El código, en cambio, se escribió por completo con [Claude Code](https://www.anthropic.com/claude-code), usando como base el repositorio original de Cairn de Yochai Gal.

## Créditos y licencias

Air Bladder combina varios regímenes de licencia; por favor, conserva la atribución intacta:

- **Texto del juego — CC BY-SA 4.0.** Las reglas y el texto de Cairn (1.ª y 2.ª edición) son de **Yochai Gal**, con licencia [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). El contenido de 2e en este sistema hereda esa licencia; las obras derivadas deben compartirse igual y atribuir a Yochai Gal.
- **Traducción al español — CC BY-SA 4.0.** La traducción al español de España (es-ES) es de **[Malecho](https://github.com/fsmalecho)**. Como obra derivada del texto del juego con licencia CC BY-SA, la traducción se licencia igualmente bajo [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
- **Código — MIT.** El código del sistema de Foundry desciende del **Cairn-FoundryVTT** original, de **Yochai Gal y Oskar Świda** (MIT), que a su vez desciende del sistema Electric Bastionland. Consulta `LICENSE.txt`.
- **«Compatible con Cairn»** — la insignia de compatibilidad se usa según los términos de [cairnrpg.com/resources/logos](https://cairnrpg.com/resources/logos) (CC BY-SA 4.0, Yochai Gal).
- **Logo de Air Bladder — © Lydia Comer, todos los derechos reservados.** El logo y el material gráfico relacionado en `lydia-comer/` son de **[Lydia Comer](https://linktr.ee/lydiadidmyink)**, con licencia para el sistema Air Bladder para su inclusión y redistribución sin modificaciones como parte del sistema y sus bifurcaciones (*forks*), y para su uso sin modificaciones en la representación del proyecto; cualquier otro uso requiere permiso. Consulta `lydia-comer/license.txt`.
- **Arte de personajes — CC BY 4.0.** Las 80 imágenes emparejadas de retrato/token en `character_portraits/` y `character_tokens/` son de **[Jon Aspeheim](https://jonaspeheim.itch.io/)** (fuente: [Lemur's Portraits](https://jonaspeheim.itch.io/lemurs-portraits)), con licencia [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (consulta el `license.txt` en cada carpeta). CC BY simple: la redistribución está permitida y la atribución es obligatoria. El artista indica que estos retratos se crearon sin IA. Conserva este crédito si el arte se distribuye.
- **Íconos de objetos y contenedores — CC BY 3.0.** Los íconos de clase en `icons/` (equipo, grimorios, transportes, contenedores, monstruos) provienen de [game-icons.net](https://game-icons.net) por **Lorc, Delapouite y Skoll**, con licencia [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). Los créditos de autor y de la página de origen de cada ícono están en `icons/CREDITS.md`.

### Colaboradores

Con agradecimiento a **somewhatcyclops**, por correcciones a la documentación de trasfondos personalizados.

---

<p align="center">
  <img src="logo/Cairn-2e-Compatible_white.jpg" alt="Compatible con Cairn 2e" width="200">
</p>
