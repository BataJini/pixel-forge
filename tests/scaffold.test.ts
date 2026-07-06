import { describe, expect, it } from 'vitest';
import { CORE_MODULE, MAX_CANVAS } from '../src/core/index';
import { PLATFORM_MODULE } from '../src/platform/index';
import { STATE_MODULE } from '../src/state/index';
import { UI_MODULE } from '../src/ui/index';

/**
 * Module-boundary contract for U-001. The four folders src/{core,ui,state,platform}
 * must exist and be importable. This suite runs in the Node environment (no DOM),
 * so importing src/core here also proves it is DOM-free — a downstream requirement,
 * since held-out engine tests import from src/core/** in isolation.
 */
describe('module boundary scaffold', () => {
  it('exposes the four module barrels', () => {
    expect(CORE_MODULE).toBe('pixel-forge/core');
    expect(UI_MODULE).toBe('pixel-forge/ui');
    expect(STATE_MODULE).toBe('pixel-forge/state');
    expect(PLATFORM_MODULE).toBe('pixel-forge/platform');
  });

  it('imports the pure core in a DOM-free environment', () => {
    // If src/core reached for the DOM this import would throw under Node env.
    expect(typeof document).toBe('undefined');
    expect(MAX_CANVAS).toBe(512);
  });
});
