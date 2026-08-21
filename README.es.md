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

- Generación aleatoria o manual de personajes a partir de trasfondos de Cairn 2e, **Cairn 2e personalizado** y Cairn Barebones — cada fuente se activa o desactiva
- Generadores de [PNJ y seguidores](https://github.com/domfortunato/air-bladder/blob/master/docs/generating-npcs.md), [monstruos](https://github.com/domfortunato/air-bladder/blob/master/docs/generating-monsters.md) y [facciones](https://github.com/domfortunato/air-bladder/blob/master/docs/generating-factions.md), [tablas de encuentros](https://github.com/domfortunato/air-bladder/blob/master/docs/encounter-tables.md) con añadir a la escena en un clic, y más tablas de tiradas orientadas al Guardián
- Importación de personajes en .json desde la aplicación oficial de Cairn, [Kettlewright](https://kettlewright.com/)
- **Magia GLOG opcional** — el [hack GLOG](https://cairnrpg.com/hacks/glog-magic/) oficial tras un interruptor del Guardián: lanza desde un grimorio encontrado con 1–4 dados de magia, los valores obtenidos se escriben en el texto del conjuro, percances con dobles — los 100 conjuros incluidos; [cómo usarlo](https://github.com/domfortunato/air-bladder/blob/master/docs/glog-magic.md)
- Trasfondos de 2e personalizados — siete se incluyen en el compendio **Backgrounds (Custom)**; [crea y revisa los tuyos](https://github.com/domfortunato/air-bladder/blob/master/docs/creating-custom-backgrounds.md) y [compártelos entre mundos](https://github.com/domfortunato/air-bladder/blob/master/docs/sharing-custom-backgrounds.md)
- Hojas de personaje desacoplables e **imprimibles** — imprime el personaje entero en una o dos páginas
- [Macros incluidas](https://github.com/domfortunato/air-bladder/blob/master/docs/supplied-macros.md) — cuatro interruptores del Guardián para la barra de macros, sin pasar por la configuración del juego
- Tres galerías del selector de retratos: 80 retratos de personaje de [Jon Aspeheim](https://jonaspeheim.itch.io/), 368 tokens de criaturas y PNJ de [tlomdev](https://tlomdev.itch.io/) (un personaje importado de Kettlewright conserva su rostro) y 17 monstruos dibujados para Air Bladder por [Lydia Comer](https://linktr.ee/lydiadidmyink)
- Automatización mínima — botones para descansar, restaurar características, pánico y daño crítico
- Tiradas de daño mermadas y potenciadas — elige una al tirar; un personaje con pánico tira mermado automáticamente

## Capturas de pantalla

<table>
  <tr>
    <td><img src="https://raw.githubusercontent.com/domfortunato/air-bladder/master/docs/images/sheet-items.png" alt="Hoja de personaje — pestaña de Equipo" width="250"></td>
    <td><img src="https://raw.githubusercontent.com/domfortunato/air-bladder/master/docs/images/sheet-description.png" alt="Hoja de personaje — pestaña de Descripción" width="250"></td>
    <td><img src="https://raw.githubusercontent.com/domfortunato/air-bladder/master/docs/images/sheet-background-notes.png" alt="Hoja de personaje — pestaña de Trasfondo y notas" width="250"></td>
  </tr>
</table>

*La hoja de personaje: pestañas de Equipo, Descripción, y Trasfondo y notas. Las hojas siguen el esquema de color de tu Foundry; estas están en modo claro.*

<img src="https://raw.githubusercontent.com/domfortunato/air-bladder/master/docs/images/sheet-print.png" alt="Una hoja de personaje impresa — el personaje entero en una o dos páginas" width="320">

*Imprime una hoja de personaje limpia: características, inventario, trasfondo, vínculos y augurio en una o dos páginas, lista para la mesa.*

También hay Personajes Jugadores pregenerados disponibles en la <a href="https://domfortunato.itch.io/cairn-2e-pre-gens" target="_blank" rel="noopener">página de itch.io de Dom Bosco</a>.

<img src="https://raw.githubusercontent.com/domfortunato/air-bladder/master/docs/images/game-settings.png" alt="La configuración de juego del Guardián" width="480">

*La configuración de juego del Guardián, agrupada por secciones — mostrada aquí en modo oscuro.*

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

- **Texto del juego — CC BY-SA 4.0.** Las reglas y el texto de Cairn (1.ª y 2.ª edición) son de **Yochai Gal**, con licencia [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). El contenido de 2e en este sistema hereda esa licencia; las obras derivadas deben compartirse igual y atribuir a Yochai Gal. Eso incluye el texto de las reglas que se distribuye como páginas legibles: el compendio **Cairn 2e Rules** contiene «Overview & Principles» y «Core Rules for Players», transcritos del texto de 2e.
- **Traducción al español — CC BY-SA 4.0.** La traducción al español de España (es-ES) es de **[Malecho](https://github.com/fsmalecho)**: `lang/es.json` (interfaz) y `lang/content/es.json` (contenido del juego). Como obra derivada del texto del juego con licencia CC BY-SA, la traducción se licencia igualmente bajo [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
- **«Backgrounds for Cairn» — CC BY-SA 4.0 (texto).** Los siete trasfondos de clase del compendio Custom (Fighter, Cleric, Magic-User, Thief, Dwarf, Elf, Halfling) provienen de **Backgrounds for Cairn**, de **Gordon McCormick**, basado en Cairn de Yochai Gal y en el D&D BECMI de Frank Mentzer; el texto está licenciado bajo [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Solo el texto: el arte del folleto (de Perplexing Ruins y Jeff Koch) no se incluye.
- **Magia GLOG — CC BY-SA 4.0.** Los 100 conjuros del compendio GLOG Spellscrolls son la lista de [GLOG Spells](https://cairnrpg.com/hacks/glog-spells/) del hack oficial [GLOG Magic](https://cairnrpg.com/hacks/glog-magic/) de cairnrpg.com, licenciada bajo [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) según consta en esas páginas. La tabla de percances de Tables (GLOG) y los dos diarios de Journals (GLOG) —«GLOG Magic — Player Rules» y «GLOG Magic — Spells»— son texto del mismo hack bajo la misma licencia. El texto se transcribe literalmente; `[dice]` y `[sum]` son las variables de lanzamiento del propio hack y permanecen como prosa. El flujo de lanzamiento del sistema adopta su diseño de texto resuelto —los bloques por potencia y la sustitución de `[dice]`/`[sum]`— de una macro de lanzamiento de **[Malecho](https://github.com/fsmalecho)**, que probó la idea contra esta lista de conjuros antes de que el sistema tuviera un botón de lanzar.
- **Código — MIT.** El código del sistema de Foundry desciende del **Cairn-FoundryVTT** original, de **Yochai Gal y Oskar Świda** (MIT), que a su vez desciende del sistema Electric Bastionland. Consulta `LICENSE.txt`. La misma licencia MIT cubre las cadenas de interfaz de `lang/`: los archivos en alemán, danés, francés, polaco y portugués de Brasil se heredaron de Cairn-FoundryVTT y se distribuyen bajo su licencia. Las cuatro macros del Guardián incluidas (el compendio `macros`) son JavaScript original bajo la misma licencia MIT: la cláusula CC BY-SA cubre el texto de Cairn, del que las macros no contienen nada. Los diarios de **System Docs** también se distribuyen aquí: son las guías del Guardián propias de este proyecto, generadas a partir de `docs/`, y no reproducen ningún texto de Cairn.
- **«For Use With Cairn»** — las marcas de compatibilidad de `logo/` se usan según los términos de [cairnrpg.com/resources/logos](https://cairnrpg.com/resources/logos) (CC BY-SA 4.0, Yochai Gal), sin modificar. La ficha de personaje y la hoja impresa muestran ambas el sello «For Use With Cairn»; la insignia anterior «Compatible with Cairn 2e», a la que sustituye, se conserva junto a él. Los detalles están en `logo/README.md`.
- **Logo y arte de monstruos de Air Bladder — © Lydia Comer, todos los derechos reservados.** Todo el contenido de `art/lydia-comer/` es de **[Lydia Comer](https://linktr.ee/lydiadidmyink)**, con licencia para el sistema Air Bladder para su inclusión y redistribución como parte del sistema y sus bifurcaciones (*forks*), y para su uso en la representación y promoción del proyecto; cualquier uso ajeno al proyecto Air Bladder requiere permiso. Dos funciones bajo una misma licencia: los archivos del logo, en la raíz de la carpeta, y —en `art/lydia-comer/portraits/` y `art/lydia-comer/tokens/`— 17 criaturas dibujadas para este sistema, disponibles en la galería **Lydia Comer** del selector de imágenes en las fichas de PNJ y de monstruo, cada una como un retrato cuadrado emparejado con el token circular recortado a partir de él. **Esta no es una licencia Creative Commons**, a diferencia de todos los demás regímenes de arte aquí: nada puede usarse por separado de Air Bladder. El contenido está listado en `art/lydia-comer/CREDITS.md`; los términos completos están en `art/lydia-comer/license.txt`.
- **Arte de personajes — CC BY 4.0.** Las 80 imágenes emparejadas de retrato/token en `art/jon-aspeheim/portraits/` y `art/jon-aspeheim/tokens/` son de **[Jon Aspeheim](https://jonaspeheim.itch.io/)** (fuente: [Lemur's Portraits](https://jonaspeheim.itch.io/lemurs-portraits)), con licencia [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (consulta `art/jon-aspeheim/license.txt`, que cubre ambas subcarpetas). CC BY simple: la redistribución está permitida y la atribución es obligatoria. El artista indica que estos retratos se crearon sin IA. **Modificado: la fuente incluye retratos PNG de 1000×1000 y ningún token — la mitad `portraits/` se recodifica a WebP al mismo tamaño, y la mitad `tokens/` se recorta y reduce a partir de ellos a 256×256 para el lienzo** — la indicación que exige la cláusula §3(a)(1)(B) de CC BY 4.0. Conserva este crédito si el arte se distribuye.
- **Arte de game-icons.net — CC BY 3.0.** Dos carpetas, una misma licencia, ambas de [game-icons.net](https://game-icons.net) bajo [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). `icons/` contiene los íconos de clase (equipo, grimorios, transportes, contenedores, monstruos) por **Lorc, Delapouite, Skoll y SeregaCthtuf**; `art/game-icons/` contiene la galería **Game-Icons** del selector de imágenes — 2275 íconos en 38 categorías por **Andy Meneely, Aussiesim, Carl Olsen, Caro Asercion, Cathelineau, DarkZaitzev, Delapouite, Faithtoken, GeneralAce135, Guard13007, Irongamer, Lorc, Lord Berandas, Lucas, Quoting, Rihlsul, Sbed, SeregaCthtuf, Skoll, Sparker, Starseeker, Willdabeast** y un ícono acreditado a varios artistas. Los créditos de autor y de la página de origen de cada ícono están en `icons/CREDITS.md` y `art/game-icons/CREDITS.md`; esos archivos **son** la atribución, ya que la ruta publicada solo registra la categoría. El aviso original se distribuye literalmente como `art/game-icons/license.txt`.
- **Tlomdev's Tokens — CC BY-SA 4.0.** Los 368 dibujos de token en blanco y negro de `art/tlomdev/` son de **[tlomdev](https://tlomdev.itch.io/)** (fuente: [Tlomdev's Tokens](https://tlomdev.itch.io/tlomdevs-tokens)), con licencia [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). **Modificados: recodificados de PNG a WebP (calidad 95) y sin ningún otro cambio** — el aviso de modificación completo que exige la cláusula §3(a)(1)(B) de CC BY-SA está en la sección «Modifications» de `art/tlomdev/CREDITS.md`. Aparecen en la galería **Tlomdev** del selector de retratos, bajo las carpetas de categoría del propio artista. La subcarpeta `kettlewright-portraits/` (el selector la muestra como «Kettlewright Portraits») contiene los dibujos del mismo artista tal como los distribuye [Kettlewright](https://github.com/yochaigal/kettlewright), con los nombres de archivo exactos de Kettlewright, de modo que un personaje importado de Kettlewright conserva el retrato que eligió su jugador. ShareAlike: las adaptaciones del arte deben llevar la misma licencia. La atribución y la procedencia están registradas en `art/tlomdev/CREDITS.md`; el aviso se distribuye como `art/tlomdev/license.txt`.
- **Tipografía Alegreya — SIL Open Font License 1.1.** Las tres fuentes web de `fonts/` son **Alegreya**, de Juan Pablo del Peral y los autores del Proyecto Alegreya ([Huerta Tipográfica](https://github.com/huertatipografica/Alegreya)), © 2011, con licencia [OFL 1.1](https://openfontlicense.org/). **Modificadas: convertidas a WOFF2 para su distribución web y sin ningún otro cambio** — la OFL considera un cambio de formato como una «Versión Modificada» (§1), así que no se trata de una redistribución sin modificaciones. Eso no incumple nada: Alegreya no declara ningún «Reserved Font Name», por lo que el nombre sigue siendo utilizable, y la licencia exige que su aviso acompañe a cada copia, por lo que `fonts/OFL.txt` y `fonts/license.txt` se distribuyen junto a ellas.

**Y un agradecimiento, no una licencia: [Kettlewright](https://kettlewright.com/)**, la aplicación oficial de Cairn de Yochai Gal. El diseño de la hoja de personaje imprimible está inspirado en la página de impresión de Kettlewright, y la importación de personajes `.json` existe para que un personaje de Kettlewright pueda entrar directamente. Inspiración e interoperabilidad — aquí no se distribuye código ni material de Kettlewright más allá de lo que recoge la entrada de Tlomdev de más arriba.

---

<p align="center">
  <img src="logo/Cairn-2e-Compatible_white.jpg" alt="Compatible con Cairn 2e" width="200">
</p>
