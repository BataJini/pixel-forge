/**
 * src/core/palettes/builtins.ts — authoritative hex data for the built-in
 * palettes (master-spec §4.4). Data only: no logic, no DOM. `palette.ts` turns
 * these specs into `Palette` objects. Hexes are contractual — the held-out
 * acceptance suite asserts the exact lists/counts for Game Boy, PICO-8, CGA, C64,
 * and the NES range/uniqueness. Do not reorder or edit without updating §4.4.
 */
import { NES_HEXES } from './nes';

/** Stable identifier for each built-in palette (also its `Palette.id`). */
export type BuiltinPaletteId = 'gameboy' | 'pico8' | 'cga' | 'c64' | 'nes' | 'forge' | 'db16';

/** A built-in palette's data spec: identity, display name, and its hex ramp. */
export interface BuiltinPaletteSpec {
  readonly id: BuiltinPaletteId;
  readonly name: string;
  readonly hexes: readonly string[];
  readonly source: string;
}

// Game Boy DMG (4) — master-spec §4.4.
const GAMEBOY_HEXES = ['#0F380F', '#306230', '#8BAC0F', '#9BBC0F'] as const;

// PICO-8 (16) — master-spec §4.4.
const PICO8_HEXES = [
  '#000000',
  '#1D2B53',
  '#7E2553',
  '#008751',
  '#AB5236',
  '#5F574F',
  '#C2C3C7',
  '#FFF1E8',
  '#FF004D',
  '#FFA300',
  '#FFEC27',
  '#00E436',
  '#29ADFF',
  '#83769C',
  '#FF77A8',
  '#FFCCAA',
] as const;

// CGA 16 — master-spec §4.4.
const CGA_HEXES = [
  '#000000',
  '#0000AA',
  '#00AA00',
  '#00AAAA',
  '#AA0000',
  '#AA00AA',
  '#AA5500',
  '#AAAAAA',
  '#555555',
  '#5555FF',
  '#55FF55',
  '#55FFFF',
  '#FF5555',
  '#FF55FF',
  '#FFFF55',
  '#FFFFFF',
] as const;

// Commodore 64 (Pepto 16) — master-spec §4.4.
const C64_HEXES = [
  '#000000',
  '#FFFFFF',
  '#68372B',
  '#70A4B2',
  '#6F3D86',
  '#588D43',
  '#352879',
  '#B8C76F',
  '#6F4F25',
  '#433900',
  '#9A6759',
  '#444444',
  '#6C6C6C',
  '#9AD284',
  '#6C5EB5',
  '#959595',
] as const;

// Forge Ramp (UI default theme) — the 13 named tokens from design-direction.md.
const FORGE_HEXES = [
  '#12100E',
  '#2A2622',
  '#4A423A',
  '#0C0A08',
  '#8A7E70',
  '#E8DFD2',
  '#FF6A1A',
  '#C24A12',
  '#FFB03A',
  '#FFE08A',
  '#2FA8C4',
  '#5F9E5A',
  '#E23B2E',
] as const;

// DawnBringer 16 (DB16) — a modern favorite, offered as an optional bonus per §4.4.
const DB16_HEXES = [
  '#140C1C',
  '#442434',
  '#30346D',
  '#4E4A4E',
  '#854C30',
  '#346524',
  '#D04648',
  '#757161',
  '#597DCE',
  '#D27D2C',
  '#8595A1',
  '#6DAA2C',
  '#D2AA99',
  '#6DC2CA',
  '#DAD45E',
  '#DEEED6',
] as const;

/**
 * All built-in palette specs in menu order. NES pulls its hexes from the bundled
 * source-of-truth file (`nes.ts`). The array order is the order shown in the
 * palette menu.
 */
export const BUILTIN_SPECS: readonly BuiltinPaletteSpec[] = [
  {
    id: 'forge',
    name: 'Forge Ramp',
    hexes: FORGE_HEXES,
    source: 'PixelForge (design-direction.md)',
  },
  {
    id: 'gameboy',
    name: 'Game Boy DMG',
    hexes: GAMEBOY_HEXES,
    source: 'Nintendo Game Boy (DMG-01)',
  },
  { id: 'pico8', name: 'PICO-8', hexes: PICO8_HEXES, source: 'Lexaloffle PICO-8' },
  { id: 'nes', name: 'NES', hexes: NES_HEXES, source: 'Nintendo NES (2C02, FirebrandX decode)' },
  { id: 'cga', name: 'CGA 16', hexes: CGA_HEXES, source: 'IBM CGA' },
  { id: 'c64', name: 'Commodore 64', hexes: C64_HEXES, source: 'Commodore 64 (Pepto)' },
  { id: 'db16', name: 'DawnBringer 16', hexes: DB16_HEXES, source: 'DawnBringer (DB16)' },
];
