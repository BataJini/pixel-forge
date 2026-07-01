/**
 * src/core/palettes/nes.ts — the bundled NES color set (source of truth).
 *
 * master-spec §4.4: "NES (~54): stored as a bundled JSON of ~54 RGB entries using
 * a documented decoder profile (FirebrandX/'NES Classic'); the file is the source
 * of truth and is validated to be 52–56 unique colors."
 *
 * The 2C02 PPU addresses 64 palette indices ($00–$3F), but the high-luma "blacks"
 * ($0D–$0F and the $x{D,E,F} greys) collapse to a small set of duplicates, so the
 * distinct, drawable NES color set is 55 entries. These hexes are the canonical
 * decoded NES master palette (FirebrandX "NES Classic" decode, as catalogued by
 * Lospec's "Nintendo Entertainment System" palette) with the redundant blacks
 * removed. Bundled locally — there is NO runtime fetch (constitution: offline).
 *
 * Order follows the master palette's hue/luma ramp so the swatch grid reads as
 * the familiar NES columns. Uniqueness + the 52–56 count are asserted by both the
 * held-out acceptance suite and palette.test.ts; do not hand-edit without re-running.
 */

/** 55 distinct NES colors as `#RRGGBB`. Frozen so callers cannot mutate it. */
export const NES_HEXES: readonly string[] = Object.freeze([
  '#000000',
  '#FCFCFC',
  '#F8F8F8',
  '#BCBCBC',
  '#7C7C7C',
  '#A4E4FC',
  '#3CBCFC',
  '#0078F8',
  '#0000FC',
  '#B8B8F8',
  '#6888FC',
  '#0058F8',
  '#0000BC',
  '#D8B8F8',
  '#9878F8',
  '#6844FC',
  '#4428BC',
  '#F8B8F8',
  '#F878F8',
  '#D800CC',
  '#940084',
  '#F8A4C0',
  '#F85898',
  '#E40058',
  '#A80020',
  '#F0D0B0',
  '#F87858',
  '#F83800',
  '#A81000',
  '#FCE0A8',
  '#FCA044',
  '#E45C10',
  '#881400',
  '#F8D878',
  '#F8B800',
  '#AC7C00',
  '#503000',
  '#D8F878',
  '#B8F818',
  '#00B800',
  '#007800',
  '#B8F8B8',
  '#58D854',
  '#00A800',
  '#006800',
  '#B8F8D8',
  '#58F898',
  '#00A844',
  '#005800',
  '#00FCFC',
  '#00E8D8',
  '#008888',
  '#004058',
  '#F8D8F8',
  '#787878',
]);
