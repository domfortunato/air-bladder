/**
 * One stamp, shared by both icon importers.
 *
 * game-icons.net ships `<svg viewBox="0 0 512 512">` with NO width/height, so
 * the file has no intrinsic size. An SVG without one is rasterised at the
 * browser's fallback (300x150), which Foundry then squares off — a token drew
 * at 150x150 where the PNG it replaced was 512x512, i.e. visibly soft the
 * moment anyone zoomed in. Caught on the canvas during the 0.1.6 upgrade test;
 * nothing that only fetches or decodes the file can see it.
 *
 * Stamp the viewBox's own dimensions in. ~30 bytes, and rasterisation becomes
 * deterministic at the size the art was drawn for.
 *
 * It lives here rather than inside `icons.mjs` because that is where it was,
 * and `game-icons.mjs` — importing four hundred times as many files, 42 of
 * which are pack TOKEN art — never inherited it (review #7 finding 6). Two
 * importers writing the same kind of file from the same upstream must not each
 * decide this separately.
 */
export const withIntrinsicSize = (svg) => {
  if (/<svg[^>]*\swidth=/.test(svg)) return svg;
  const box = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
  if (!box) throw new Error("no viewBox to derive an intrinsic size from");
  return svg.replace(/<svg /, `<svg width="${box[1]}" height="${box[2]}" `);
};
