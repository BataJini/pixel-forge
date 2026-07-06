# Held-out acceptance — U-011 Project persistence + dialogs + image import

> Authoritative. Builder must NOT edit.

## Machine-checkable
- `project.acceptance.test.ts` passes (lossless multi-layer/multi-frame round-trip,
  compact pixel encoding, malformed-input rejection).

## Manual / review (QA — Playwright with IndexedDB)
- Save to gallery, reload the page, and the exact project restores (autosave +
  explicit save); the debounced autosave never loses work.
- Gallery: list with thumbnails; open / rename / duplicate / delete; New via the
  Welcome dialog (choose palette + size).
- Resize / Crop-to-selection / Trim-transparent dialogs modify canvas correctly and
  are undoable.
- Import PNG into a new canvas or as a new layer; oversize (> 512×512 cap) is
  rejected with a friendly error and NO loss of current work; resize/new dialogs
  clamp/refuse W or H above 512.
- Storage-full is handled with a visible, actionable message (export/free space);
  `navigator.storage.persist()` requested.
