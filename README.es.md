<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)"  srcset="art/lydia-comer/Airbladder06.webp">
    <source media="(prefers-color-scheme: light)" srcset="art/lydia-comer/Airbladder02.webp">
    <img alt="Air Bladder" src="art/lydia-comer/Airbladder01.webp" width="520">
  </picture>
</p>

<div align="center">

### [Visita el sitio web de Air Bladder →](https://domfortunato.github.io/air-bladder/)

<sub>(en inglés)</sub>

[English](README.md) · **Español**

<sub>Esta traducción puede estar desactualizada; el README en inglés es la versión de referencia.</sub>

</div>

<!--
  Traducción al español de España (es-ES), para que coincida con la traducción
  del sistema.

  MANTENIMIENTO: este archivo lo mantiene el proyecto, NO el traductor del
  sistema. La traducción del juego (lang/es.json, lang/content/es.json) es obra
  de un traductor humano; este README es documentación del proyecto y se
  actualiza junto con README.md, que es la versión de referencia. Al cambiar
  README.md, actualiza también este archivo.

  ESTE ARCHIVO ES UNA TRADUCCIÓN FIEL DE README.md. No debe contener ninguna
  sección, dato ni crédito que no esté en el original: si algo merece figurar
  aquí, primero se añade a README.md y después se traduce. Una sección que
  existía solo en español (créditos a colaboradores) se eliminó el 2026-07-30
  precisamente por esto -- dejaba a una persona acreditada en un solo idioma y
  las dos versiones divergían sin que nada lo detectara.

  Terminología: usa siempre lo que el jugador VE en el sistema, es decir
  lang/es.json, no una conjetura de este archivo:
    Warden   -> "Guardián"  (CAIRN.Warden)
    Items    -> "Equipo"    (CAIRN.Items, la pestaña de la hoja)
  La fila "Hireling -> Seguidor" se retiró el 2026-08-01: CAIRN.Hireling ya no
  existe en lang/en.json (ser contratable pasó a ser una casilla del PNJ, no una
  clase de persona), así que apuntaba a una clave muerta. El término sobrevive en
  tools/i18n/glossary.tsv, que es donde le corresponde estar.
  Los nombres propios, ediciones (Cairn 2e, Barebones), módulos (Item Piles) y
  licencias no se traducen.
-->

Un sistema de juego para [Foundry VTT](https://foundryvtt.com) para jugar contenido de **Cairn 2e** y de la **Edición Barebones de Cairn**: trasfondos detallados, algunas opciones que añaden funciones de 2e a las hojas Barebones, y tablas del Guardián de 2e. **Compatible con [Cairn](https://cairnrpg.com) de Yochai Gal.**

## Resumen

Air Bladder es un sistema complementario amigable, no el sistema oficial de Cairn. Desciende de [yochaigal/Cairn-FoundryVTT](https://github.com/yochaigal/Cairn-FoundryVTT) (de Yochai Gal y Oskar Świda), que a su vez desciende del sistema Electric Bastionland y de Into the Odd. *Air Bladder* es el primer objeto de la tabla de Equipo en la p. 17 de la Guía del jugador de Cairn 2e.

## Características principales

- Generación aleatoria o manual de personajes a partir de trasfondos de Cairn 2e, **Cairn 2e personalizado** y Cairn Barebones — el Guardián puede activar o desactivar cada fuente
- [Generador de monstruos](https://github.com/domfortunato/air-bladder/blob/master/docs/generating-monsters.md)
- [Generador de facciones](https://github.com/domfortunato/air-bladder/blob/master/docs/generating-factions.md)
- Importación de personajes en `.json` desde la aplicación oficial de Cairn, ¡[Kettlewright!](https://kettlewright.com/)
- Funciones caseras (*homebrew*) opcionales que mezclan características de 2e con Barebones
- Trasfondos de 2e personalizados, creados por el Guardián — [créalos y revísalos](https://github.com/domfortunato/air-bladder/blob/master/docs/creating-custom-backgrounds.md) y después [compártelos entre mundos](https://github.com/domfortunato/air-bladder/blob/master/docs/sharing-custom-backgrounds.md)
- Generación aleatoria o manual de PNJ, contratados o no
- Conexiones entre PJ y PNJ que transfieren la propiedad a los jugadores
- Ayudas contextuales en la hoja de personaje para los jugadores
- ¡Hojas de personaje desacoplables! Sí, ya estamos completamente en AppV2: listos para la v16, cuando Foundry retire el marco de trabajo V1
- Mercado y contenedores; caballos, carros, carretas, cofres y ¡PILAS DE OBJETOS!
- ¡Tablas de tiradas orientadas al Guardián!
- Una galería de 80 retratos de personaje con sus iconos a juego, con licencia CC BY 4.0, de [Jon Aspeheim](https://jonaspeheim.itch.io/)
- Una galería de 368 tokens de criaturas y PNJ en blanco y negro, con licencia CC BY-SA 4.0, de [tlomdev](https://tlomdev.itch.io/), que incluye el juego de retratos de Kettlewright: un personaje importado de Kettlewright conserva su rostro
- Una galería de 17 monstruos dibujados para Air Bladder por [Lydia Comer](https://linktr.ee/lydiadidmyink), cada uno con un retrato emparejado con su propio token
- Automatización mínima; con botones para descansar, restaurar características, pánico y daño crítico

## Funciones en el horizonte
- Generador de encuentros
- Magia GLOG (opcional)

## Capturas de pantalla

<table>
  <tr>
    <td><img src="https://raw.githubusercontent.com/domfortunato/air-bladder/master/docs/images/sheet-items.png" alt="Hoja de personaje — pestaña de Equipo" width="250"></td>
    <td><img src="https://raw.githubusercontent.com/domfortunato/air-bladder/master/docs/images/sheet-description.png" alt="Hoja de personaje — pestaña de Descripción" width="250"></td>
    <td><img src="https://raw.githubusercontent.com/domfortunato/air-bladder/master/docs/images/sheet-background-notes.png" alt="Hoja de personaje — pestaña de Trasfondo y notas" width="250"></td>
  </tr>
</table>

*La hoja de personaje: pestañas de Equipo, Descripción, y Trasfondo y notas. La franja roja es la condición automática de **Daño Crítico**, que aparece cuando la FUE recibe daño.*

<img src="https://raw.githubusercontent.com/domfortunato/air-bladder/master/docs/images/game-settings.png" alt="La configuración de juego del Guardián" width="480">

*La configuración de juego del Guardián, agrupada por secciones.*

## Estado

Desarrollo temprano y activo. ¡Envía comentarios y arte! El sistema se está reconstruyendo sobre la arquitectura de **compendios editables** del original: el equipo vive en compendios de objetos que el Guardián puede editar en un solo lugar, y la generación de personajes y el mercado hacen referencia a esos compendios por su nombre.

## Idiomas

La interfaz está traducida al **español** (el 72 % de las cadenas actuales, por [Malecho](https://github.com/fsmalecho)), y el *contenido* del juego —trasfondos, objetos, hechizos, tablas— está traducido únicamente al español.

Los archivos de interfaz en alemán, danés, francés, polaco y portugués de Brasil se heredaron del sistema original de Cairn. Cubren entre el **15 % y el 30 %** de la interfaz actual, son anteriores a la mayoría de las funciones de este sistema y **no reciben mantenimiento**: en la práctica, una partida en esos idiomas está mayormente en inglés. Todo lo que no esté traducido recae en el inglés cadena por cadena, así que una traducción parcial siempre se puede usar en lugar de quedar rota.

Las herramientas son independientes del idioma (`--lang <código>` en todas), así que un idioma nuevo no requiere ningún cambio de código: solo un traductor.

**¡Se busca ayuda con las traducciones!** — consulta [docs/TRANSLATING.md](https://github.com/domfortunato/air-bladder/blob/master/docs/TRANSLATING.md) (en inglés) para el flujo sin programación, o [docs/translating-self-service.md](https://github.com/domfortunato/air-bladder/blob/master/docs/translating-self-service.md) si prefieres trabajar con git.

## Instalación (manual)

**Requiere Foundry VTT v14.365 o superior.**

1. En el menú **Sistemas de juego** de Foundry, haz clic en **Instalar sistema**.
2. Introduce la URL del manifiesto: `https://github.com/domfortunato/air-bladder/releases/latest/download/system.json`

Para desarrollo, clona este repositorio en `Data/systems/air-bladder` (una unión de directorios / *junction* funciona), ejecuta `npm install` y luego `npm run build:packs` antes de iniciar Foundry. `npm run dev:smoke` realiza una carga sin interfaz (*headless*) como verificación básica.

Para probar el trabajo **aún no publicado**, clona la rama `dev`: ahí vive todo lo que está en curso. El paso `npm run build:packs` hace falta en ambos casos: los compendios se generan a partir de `src/packs/` y no se guardan en git, así que un clon sin compilar carga con todos los compendios vacíos.

## Cómo contribuir

Las *pull requests* son bienvenidas: ábrelas contra **`dev`**, no contra `master`. Consulta [CONTRIBUTING.md](https://github.com/domfortunato/air-bladder/blob/master/CONTRIBUTING.md) (en inglés) para los detalles, y [docs/git-flow.md](https://github.com/domfortunato/air-bladder/blob/master/docs/git-flow.md) para saber cómo funcionan aquí las ramas y las versiones.

## Divulgación sobre IA

**El arte generado por IA nunca aparecerá en este repositorio, jamás.** El código, en cambio, se escribió con [Claude Code](https://www.anthropic.com/claude-code), usando como base el repositorio original de Cairn de Yochai Gal.

## Créditos y licencias

Air Bladder combina varios regímenes de licencia; por favor, conserva la atribución intacta:

- **Texto del juego — CC BY-SA 4.0.** Las reglas y el texto de Cairn (1.ª y 2.ª edición) son de **Yochai Gal**, con licencia [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). El contenido de 2e en este sistema hereda esa licencia; las obras derivadas deben compartirse igual y atribuir a Yochai Gal.
- **Traducción al español — CC BY-SA 4.0.** La traducción al español de España (es-ES) es de **[Malecho](https://github.com/fsmalecho)**: `lang/es.json` (interfaz) y `lang/content/es.json` (contenido del juego). Como obra derivada del texto del juego con licencia CC BY-SA, la traducción se licencia igualmente bajo [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
- **«Backgrounds for Cairn» — CC BY-SA 4.0 (texto).** Los siete trasfondos de clase del compendio Custom (Fighter, Cleric, Magic-User, Thief, Dwarf, Elf, Halfling) provienen de **Backgrounds for Cairn**, de **Gordon McCormick**, basado en Cairn de Yochai Gal y en el D&D BECMI de Frank Mentzer; el texto está licenciado bajo [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Solo el texto: el arte del folleto (de Perplexing Ruins y Jeff Koch) no se incluye.
- **Código — MIT.** El código del sistema de Foundry desciende del **Cairn-FoundryVTT** original, de **Yochai Gal y Oskar Świda** (MIT), que a su vez desciende del sistema Electric Bastionland. Consulta `LICENSE.txt`. La misma licencia MIT cubre las cadenas de interfaz de `lang/`: los archivos en alemán, danés, francés, polaco y portugués de Brasil se heredaron de Cairn-FoundryVTT y se distribuyen bajo su licencia.
- **«Compatible con Cairn»** — la insignia de compatibilidad se usa según los términos de [cairnrpg.com/resources/logos](https://cairnrpg.com/resources/logos) (CC BY-SA 4.0, Yochai Gal).
- **Logo y arte de monstruos de Air Bladder — © Lydia Comer, todos los derechos reservados.** Todo el contenido de `art/lydia-comer/` es de **[Lydia Comer](https://linktr.ee/lydiadidmyink)**, con licencia para el sistema Air Bladder para su inclusión y redistribución como parte del sistema y sus bifurcaciones (*forks*), y para su uso en la representación y promoción del proyecto; cualquier uso ajeno al proyecto Air Bladder requiere permiso. Dos funciones bajo una misma licencia: los archivos del logo, en la raíz de la carpeta, y —en `art/lydia-comer/portraits/` y `art/lydia-comer/tokens/`— 17 criaturas dibujadas para este sistema, disponibles en la galería **Lydia Comer** del selector de imágenes en las fichas de PNJ y de monstruo, cada una como un retrato cuadrado emparejado con el token circular recortado a partir de él. **Esta no es una licencia Creative Commons**, a diferencia de todos los demás regímenes de arte aquí: nada puede usarse por separado de Air Bladder. El contenido está listado en `art/lydia-comer/CREDITS.md`; los términos completos están en `art/lydia-comer/license.txt`.
- **Arte de personajes — CC BY 4.0.** Las 80 imágenes emparejadas de retrato/token en `art/jon-aspeheim/portraits/` y `art/jon-aspeheim/tokens/` son de **[Jon Aspeheim](https://jonaspeheim.itch.io/)** (fuente: [Lemur's Portraits](https://jonaspeheim.itch.io/lemurs-portraits)), con licencia [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (consulta `art/jon-aspeheim/license.txt`, que cubre ambas subcarpetas). CC BY simple: la redistribución está permitida y la atribución es obligatoria. El artista indica que estos retratos se crearon sin IA. Conserva este crédito si el arte se distribuye.
- **Arte de game-icons.net — CC BY 3.0.** Dos carpetas, una misma licencia, ambas de [game-icons.net](https://game-icons.net) bajo [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). `icons/` contiene los íconos de clase (equipo, grimorios, transportes, contenedores, monstruos) por **Lorc, Delapouite y Skoll**; `art/game-icons/` contiene la galería **Game-Icons** del selector de imágenes — 1643 íconos en 28 categorías por **Andy Meneely, Carl Olsen, Caro Asercion, Cathelineau, DarkZaitzev, Delapouite, Faithtoken, GeneralAce135, Guard13007, Irongamer, Lorc, Lord Berandas, Lucas, Sbed, SeregaCthtuf, Skoll, Sparker, Starseeker, Willdabeast** y un ícono acreditado a varios artistas. Los créditos de autor y de la página de origen de cada ícono están en `icons/CREDITS.md` y `art/game-icons/CREDITS.md`; esos archivos **son** la atribución, ya que la ruta publicada solo registra la categoría. El aviso original se distribuye literalmente como `art/game-icons/license.txt`.
- **Tlomdev's Tokens — CC BY-SA 4.0.** Los 368 dibujos de token en blanco y negro de `art/tlomdev/` son de **[tlomdev](https://tlomdev.itch.io/)** (fuente: [Tlomdev's Tokens](https://tlomdev.itch.io/tlomdevs-tokens)), con licencia [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). **Modificados: recodificados de PNG a WebP (calidad 95) y sin ningún otro cambio** — el aviso de modificación completo que exige la cláusula §3(a)(1)(B) de CC BY-SA está en la sección «Modifications» de `art/tlomdev/CREDITS.md`. Aparecen en la galería **Tlomdev** del selector de retratos, bajo las carpetas de categoría del propio artista. La subcarpeta `kettlewright-portraits/` (el selector la muestra como «Kettlewright Portraits») contiene los dibujos del mismo artista tal como los distribuye [Kettlewright](https://github.com/yochaigal/kettlewright), con los nombres de archivo exactos de Kettlewright, de modo que un personaje importado de Kettlewright conserva el retrato que eligió su jugador. ShareAlike: las adaptaciones del arte deben llevar la misma licencia. La atribución y la procedencia están registradas en `art/tlomdev/CREDITS.md`; el aviso se distribuye como `art/tlomdev/license.txt`.
- **Tipografía Alegreya — SIL Open Font License 1.1.** Las tres fuentes web de `fonts/` son **Alegreya**, de Juan Pablo del Peral y los autores del Proyecto Alegreya ([Huerta Tipográfica](https://github.com/huertatipografica/Alegreya)), © 2011, con licencia [OFL 1.1](https://openfontlicense.org/). Se redistribuyen sin modificaciones; la licencia exige que su aviso acompañe a cada copia, por lo que `fonts/OFL.txt` y `fonts/license.txt` se distribuyen junto a ellas.

---

<p align="center">
  <img src="logo/Cairn-2e-Compatible_white.jpg" alt="Compatible con Cairn 2e" width="200">
</p>
