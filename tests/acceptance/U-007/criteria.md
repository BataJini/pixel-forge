# Held-out acceptance — U-007 Layers panel & management

> Authoritative. Builder must NOT edit.

## Machine-checkable (Vitest, via `composite`)
- Hiding a layer removes its pixels from the composite; showing restores them.
- Reordering two layers changes which opaque pixel wins in the composite.
- `merge-down` of layer B onto A yields a composite equal to compositing [A,B].
- `flatten` reduces to a single layer whose buffer equals the full composite.
- Layer opacity scales its contribution (0% invisible, 100% full).

## Manual / review (QA)
- Add / duplicate / delete / rename / reorder-by-drag / lock work; active layer
  highlighted; thumbnails update live.
- Cannot delete the last remaining layer; flatten warns before collapsing.
- Every layer op is undoable (with U-006).
