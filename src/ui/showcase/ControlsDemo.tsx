import { useState } from 'react';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';
import { Slider } from '../components/Slider';
import { useUiSound } from '../hooks/useUiSound';

const TOOLS = ['Chisel', 'Grind', 'Pour', 'Line'] as const;

/** Tool rack — bevelled buttons; the active tool glows the theme accent (Ember). */
function ToolRack() {
  const [tool, setTool] = useState<(typeof TOOLS)[number]>('Chisel');
  const play = useUiSound();
  return (
    <div className="pf-tools" role="toolbar" aria-label="Tools">
      {TOOLS.map((name) => (
        <Button
          key={name}
          size="sm"
          active={tool === name}
          aria-pressed={tool === name}
          onClick={() => {
            setTool(name);
            play('click');
          }}
        >
          {name}
        </Button>
      ))}
    </div>
  );
}

/** Buttons, a slider, and a modal dialog — the interactive chrome primitives. */
export function ControlsDemo() {
  const [brush, setBrush] = useState(4);
  const [open, setOpen] = useState(false);
  const play = useUiSound();

  return (
    <div className="pf-controls">
      <ToolRack />
      <div className="pf-controls__row">
        <Button variant="primary" onClick={() => play('click')}>
          Forge
        </Button>
        <Button onClick={() => play('click')}>Default</Button>
        <Button variant="danger" onClick={() => play('error')}>
          Delete
        </Button>
        <Button variant="ghost" onClick={() => play('hover')}>
          Ghost
        </Button>
        <Button disabled>Disabled</Button>
      </div>
      <Slider
        label="Brush size"
        valueLabel={`${brush}px`}
        min={1}
        max={16}
        step={1}
        value={brush}
        onChange={(event) => setBrush(Number(event.target.value))}
      />
      <Button
        variant="primary"
        onClick={() => {
          setOpen(true);
          play('toggle');
        }}
      >
        Open dialog
      </Button>
      <Dialog
        open={open}
        title="New Canvas"
        onClose={() => setOpen(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setOpen(false);
                play('success');
              }}
            >
              Create
            </Button>
          </>
        }
      >
        <p>
          Heat raw color on the anvil and hammer it into sprites. This modal proves the bevelled
          Dialog: hard frame, dither backdrop, native focus-trap, Esc to close.
        </p>
      </Dialog>
    </div>
  );
}
