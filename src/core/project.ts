/**
 * src/core/project.ts — the native `.forge` project (de)serializer (master-spec
 * §4.3, §5).
 *
 * PURE and deterministic (no DOM). `serialize` writes a human-diffable JSON
 * document whose per-layer pixels are Base64 of the raw RGBA `Uint8ClampedArray`
 * (never a JSON number array — see base64.ts). `deserialize` is a DEFENSIVE
 * boundary parser for untrusted `.forge` files: it NEVER throws for expected
 * failures, validates the schema, canvas cap (1..512), and every field, and
 * returns the client-only result envelope (constitution: security + envelope).
 * A valid document round-trips losslessly: `deserialize(serialize(p)).value`
 * reproduces `p`'s pixels, frames, layers, palette, and metadata exactly.
 */
import { base64ToBytes, bytesToBase64 } from './base64';
import type { Frame, Layer, Palette, PixelBuffer, Project, Result, RGBA } from './types';
import { err, ok } from './types';

/** Current on-disk schema version. Bumped only on a breaking format change. */
export const PROJECT_SCHEMA = 1 as const;
/** Native project file extension and MIME (a plain JSON document). */
export const FORGE_EXTENSION = '.forge' as const;
export const FORGE_MIME = 'application/json' as const;

const MIN_CANVAS = 1;
const MAX_CANVAS = 512;
const CHANNELS = 4;
const MAX_OPACITY = 100;
const CHANNEL_MAX = 255;
const MAX_NAME = 200;
const MAX_ID = 200;
const MAX_FRAMES = 4096;
const MAX_LAYERS_PER_FRAME = 512;
const MAX_PALETTE_COLORS = 4096;

// ─── Wire shape (the JSON actually written to disk) ─────────────────────────

interface WireLayer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blend: string;
  /** Base64 of the raw RGBA bytes; length reconstructs as canvas `w*h*4`. */
  pixels: string;
}

interface WireFrame {
  id: string;
  durationMs: number;
  layers: WireLayer[];
}

interface WirePalette {
  id: string;
  name: string;
  colors: RGBA[];
  source?: string;
}

interface WireProject {
  schema: number;
  id: string;
  name: string;
  w: number;
  h: number;
  frames: WireFrame[];
  palette: WirePalette | null;
  indexed: boolean;
  fps: number;
  createdAt: string;
  updatedAt: string;
  thumbnailDataUrl?: string;
}

// ─── Serialize ───────────────────────────────────────────────────────────────

function serializeLayer(layer: Layer): WireLayer {
  return {
    id: layer.id,
    name: layer.name,
    visible: layer.visible,
    locked: layer.locked,
    opacity: layer.opacity,
    blend: layer.blend,
    pixels: bytesToBase64(layer.buffer.data),
  };
}

function serializePalette(palette: Palette): WirePalette {
  const colors = palette.colors.map((c): RGBA => [c[0], c[1], c[2], c[3]]);
  const wire: WirePalette = { id: palette.id, name: palette.name, colors };
  return palette.source === undefined ? wire : { ...wire, source: palette.source };
}

/**
 * Serialize a project to the `.forge` JSON string. Best-effort: the live app
 * only ever passes valid projects, so this does not itself enforce the canvas
 * cap — `deserialize` is the authoritative validating boundary (a project
 * serialized above the cap deserializes back to a clean error result).
 */
export function serialize(project: Project): string {
  const wire: WireProject = {
    schema: PROJECT_SCHEMA,
    id: project.id,
    name: project.name,
    w: project.w,
    h: project.h,
    frames: project.frames.map((frame) => ({
      id: frame.id,
      durationMs: frame.durationMs,
      layers: frame.layers.map(serializeLayer),
    })),
    palette: project.palette ? serializePalette(project.palette) : null,
    indexed: project.indexed,
    fps: project.fps,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
  if (project.thumbnailDataUrl !== undefined) {
    wire.thumbnailDataUrl = project.thumbnailDataUrl;
  }
  return JSON.stringify(wire);
}

// ─── Deserialize (defensive boundary) ───────────────────────────────────────

/** Internal typed failure; caught at the top of {@link deserialize}. */
class ProjectParseError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ProjectParseError';
  }
}

function fail(code: string, message: string): never {
  throw new ProjectParseError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown, field: string, max = MAX_NAME): string {
  if (typeof value !== 'string') {
    fail('PROJECT_FIELD', `Field "${field}" must be a string.`);
  }
  return value.length > max ? value.slice(0, max) : value;
}

function asBool(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    fail('PROJECT_FIELD', `Field "${field}" must be a boolean.`);
  }
  return value;
}

function asFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail('PROJECT_FIELD', `Field "${field}" must be a finite number.`);
  }
  return value;
}

/** Clamp a channel to an integer 0..255 (defensive against bad color data). */
function clampChannel(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : 0;
  return v < 0 ? 0 : v > CHANNEL_MAX ? CHANNEL_MAX : v;
}

function validateCanvasDim(value: unknown, field: string): number {
  const n = asFiniteNumber(value, field);
  if (!Number.isInteger(n)) {
    fail('PROJECT_BOUNDS', `Canvas ${field} must be an integer.`);
  }
  if (n < MIN_CANVAS || n > MAX_CANVAS) {
    fail('PROJECT_BOUNDS', `Canvas ${field} ${n} is outside 1..${MAX_CANVAS}.`);
  }
  return n;
}

function parseColor(value: unknown): RGBA {
  if (!Array.isArray(value) || value.length !== CHANNELS) {
    fail('PROJECT_PALETTE', 'Palette color must be an [r,g,b,a] tuple.');
  }
  return [
    clampChannel(value[0]),
    clampChannel(value[1]),
    clampChannel(value[2]),
    clampChannel(value[3]),
  ];
}

function parsePalette(value: unknown): Palette | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (!isRecord(value)) {
    fail('PROJECT_PALETTE', 'Palette must be an object or null.');
  }
  const colorsRaw = value.colors;
  if (!Array.isArray(colorsRaw)) {
    fail('PROJECT_PALETTE', 'Palette colors must be an array.');
  }
  if (colorsRaw.length > MAX_PALETTE_COLORS) {
    fail('PROJECT_PALETTE', 'Palette has too many colors.');
  }
  const palette: Palette = {
    id: asString(value.id, 'palette.id', MAX_ID),
    name: asString(value.name, 'palette.name'),
    colors: colorsRaw.map(parseColor),
  };
  if (typeof value.source === 'string') {
    palette.source = value.source.slice(0, MAX_NAME);
  }
  return palette;
}

function parseLayer(value: unknown, w: number, h: number): Layer {
  if (!isRecord(value)) {
    fail('PROJECT_LAYER', 'Layer must be an object.');
  }
  const bytes = base64ToBytes(asString(value.pixels, 'layer.pixels', Number.MAX_SAFE_INTEGER));
  const expected = w * h * CHANNELS;
  if (bytes === null || bytes.length !== expected) {
    fail('PROJECT_PIXELS', `Layer pixel data does not match the ${w}×${h} canvas.`);
  }
  const opacityRaw = asFiniteNumber(value.opacity, 'layer.opacity');
  const opacity = Math.min(MAX_OPACITY, Math.max(0, Math.round(opacityRaw)));
  const buffer: PixelBuffer = { w, h, data: new Uint8ClampedArray(bytes) };
  return {
    id: asString(value.id, 'layer.id', MAX_ID),
    name: asString(value.name, 'layer.name'),
    visible: asBool(value.visible, 'layer.visible'),
    locked: asBool(value.locked, 'layer.locked'),
    opacity,
    blend: typeof value.blend === 'string' ? value.blend.slice(0, MAX_NAME) : 'normal',
    buffer,
  };
}

function parseFrame(value: unknown, w: number, h: number): Frame {
  if (!isRecord(value)) {
    fail('PROJECT_FRAME', 'Frame must be an object.');
  }
  const layersRaw = value.layers;
  if (!Array.isArray(layersRaw) || layersRaw.length < 1) {
    fail('PROJECT_FRAME', 'Frame must have at least one layer.');
  }
  if (layersRaw.length > MAX_LAYERS_PER_FRAME) {
    fail('PROJECT_FRAME', 'Frame has too many layers.');
  }
  const durationMs = Math.max(0, Math.round(asFiniteNumber(value.durationMs, 'frame.durationMs')));
  return {
    id: asString(value.id, 'frame.id', MAX_ID),
    durationMs,
    layers: layersRaw.map((l) => parseLayer(l, w, h)),
  };
}

/**
 * Parse untrusted `.forge` text into a validated {@link Project}, or a coded
 * error result on any malformed/oversize/wrong-schema input. Never throws.
 * Enforces the 512×512 canvas cap and reconstructs each layer's pixel buffer
 * from Base64, verifying it is exactly `w*h*4` bytes.
 */
export function deserialize(text: string): Result<Project> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return err('PROJECT_JSON', 'This is not a valid PixelForge project file.');
  }
  try {
    if (!isRecord(raw)) {
      fail('PROJECT_SHAPE', 'Project file must be a JSON object.');
    }
    if (raw.schema !== PROJECT_SCHEMA) {
      fail(
        'PROJECT_SCHEMA',
        `Unsupported project schema ${String(raw.schema)} (expected ${PROJECT_SCHEMA}).`,
      );
    }
    const w = validateCanvasDim(raw.w, 'w');
    const h = validateCanvasDim(raw.h, 'h');
    const framesRaw = raw.frames;
    if (!Array.isArray(framesRaw) || framesRaw.length < 1) {
      fail('PROJECT_FRAMES', 'Project must have at least one frame.');
    }
    if (framesRaw.length > MAX_FRAMES) {
      fail('PROJECT_FRAMES', 'Project has too many frames.');
    }
    const fps = Math.max(0, asFiniteNumber(raw.fps, 'fps'));
    const project: Project = {
      schema: PROJECT_SCHEMA,
      id: asString(raw.id, 'id', MAX_ID),
      name: asString(raw.name, 'name'),
      w,
      h,
      frames: framesRaw.map((f) => parseFrame(f, w, h)),
      palette: parsePalette(raw.palette),
      indexed: asBool(raw.indexed, 'indexed'),
      fps,
      createdAt: asString(raw.createdAt, 'createdAt'),
      updatedAt: asString(raw.updatedAt, 'updatedAt'),
    };
    if (typeof raw.thumbnailDataUrl === 'string') {
      project.thumbnailDataUrl = raw.thumbnailDataUrl;
    }
    return ok(project);
  } catch (e) {
    if (e instanceof ProjectParseError) {
      return err(e.code, e.message);
    }
    return err('PROJECT_PARSE', 'Could not read the project file.');
  }
}

// ─── Factory (pure — caller supplies id/timestamps) ─────────────────────────

/** Inputs for {@link createProject}. Timestamps/id come from the caller so the
 * factory stays pure (the state layer injects real values). */
export interface CreateProjectParams {
  w: number;
  h: number;
  id: string;
  createdAt: string;
  updatedAt?: string;
  name?: string;
  palette?: Palette | null;
  indexed?: boolean;
  fps?: number;
  /** The single starting frame's layers (bottom→top). Must be non-empty. */
  layers: Layer[];
  frameId?: string;
  durationMs?: number;
  thumbnailDataUrl?: string;
}

const DEFAULT_FPS = 12;
const DEFAULT_DURATION = 100;

/**
 * Build a single-frame {@link Project} from ready-made layers and caller-supplied
 * id/timestamps. Pure and deterministic; the impure id/clock generation belongs
 * to the state/platform layer.
 */
export function createProject(params: CreateProjectParams): Project {
  const frame: Frame = {
    id: params.frameId ?? 'frame-1',
    durationMs: params.durationMs ?? DEFAULT_DURATION,
    layers: params.layers,
  };
  const project: Project = {
    schema: PROJECT_SCHEMA,
    id: params.id,
    name: params.name ?? 'Untitled',
    w: params.w,
    h: params.h,
    frames: [frame],
    palette: params.palette ?? null,
    indexed: params.indexed ?? false,
    fps: params.fps ?? DEFAULT_FPS,
    createdAt: params.createdAt,
    updatedAt: params.updatedAt ?? params.createdAt,
  };
  if (params.thumbnailDataUrl !== undefined) {
    project.thumbnailDataUrl = params.thumbnailDataUrl;
  }
  return project;
}

/** Total count of pixel bytes across every layer/frame (storage estimates). */
export function projectPixelBytes(project: Project): number {
  let total = 0;
  for (const frame of project.frames) {
    for (const layer of frame.layers) {
      total += layer.buffer.data.length;
    }
  }
  return total;
}
