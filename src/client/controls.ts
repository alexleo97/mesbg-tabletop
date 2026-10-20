/**
 * Every key, held key and gesture the app answers to, for the Controls list in the settings. Each entry is the keys
 * (or gesture) and what it does; `keys` names the keyboard keys involved so a test can check none is left out.
 */
export interface Control {
  /** What to press or do, e.g. "Shift + mouse wheel". */
  how: string;
  /** What it does. */
  does: string;
  /** The KeyboardEvent.key values involved, if any. */
  keys?: string[];
}

export const CONTROLS: { group: string; items: Control[] }[] = [
  {
    group: 'Looking round the table',
    items: [
      { how: 'Drag the empty table', does: 'Pan the view (with the ✋ Drag tool).' },
      { how: 'Mouse wheel, or pinch', does: 'Zoom in and out where you point.' },
      { how: 'Shift + mouse wheel', does: 'Turn the table freely round the pointer.', keys: ['Shift'] },
      { how: 'Twist two fingers', does: 'Turn the table with them. Let go near square and it settles square.' },
      { how: 'R', does: 'Turn the table a quarter to the right (⟳ button).', keys: ['r'] },
      { how: 'Shift + R', does: 'Turn the table a quarter to the left (⟲ button).', keys: ['R'] },
      { how: 'F', does: 'Fit the whole table on screen (⤢ button). + and − zoom.', keys: ['f'] },
    ],
  },
  {
    group: 'Models',
    items: [
      { how: 'Click or tap a model', does: 'Select it: its card opens and rings show how far it can move.' },
      { how: 'Drag a model', does: 'Move it, or the whole selected group. It stops when its Move runs out; drop it just short of an enemy to finish a charge.' },
      { how: 'Shift, Ctrl or ⌘ + click', does: 'Add a model to the selection, or take it out.', keys: ['Shift', 'Control', 'Meta'] },
      { how: '⬚ Select tool, drag a box', does: 'Select every model in the box. Hold Shift, Ctrl or ⌘ to add to what is already selected.' },
      { how: 'Q / E', does: 'Turn the selected models 45° left / right.', keys: ['q', 'e'] },
      { how: 'Esc', does: 'Deselect everything and clear the ruler.', keys: ['Escape'] },
      { how: 'Tap an enemy while a shooter is selected', does: 'Aim at it (Shoot phase, or a throw in the Move phase).' },
      { how: 'Tap ⚔ on a fight', does: 'Open that fight in the Fight phase.' },
    ],
  },
  {
    group: 'Measuring and marking',
    items: [
      { how: '📏 Measure tool, drag', does: 'Measure in inches. Start on a model to measure from the edge of its base. Tap to clear.' },
      { how: '📍 Mark tool, click', does: 'Ping a spot for your opponent to see.' },
      { how: '📍 Mark tool, drag', does: 'Draw an arrow. Arrows clear at the next turn, or with ✕ Arrows.' },
      { how: 'Hold Alt + click or drag', does: 'Ping or draw an arrow with any tool.', keys: ['Alt'] },
      { how: '👁 Sight', does: 'Shade what the selected model can’t see and show its shooting range.' },
    ],
  },
  {
    group: 'Terrain',
    items: [
      { how: 'Point at terrain (mouse)', does: 'Show its name.' },
      { how: 'Click or tap terrain', does: 'Show what it is and how it plays.' },
      { how: 'Drag terrain', does: 'Move it, unless it is locked. A siege tower is pushed this way in the battle.' },
    ],
  },
  {
    group: 'Cards and the rest',
    items: [
      { how: 'Ctrl + Z or ⌘ + Z', does: 'Undo your last change (↶ button). Not in Learn to play.', keys: ['z', 'Control', 'Meta'] },
      { how: 'Drag a card by its header', does: 'Move the turn guide, battle or model card (wide screens). 🔒 locks it, ↺ puts it back.' },
      { how: '▾ on a card', does: 'Fold the card out of the way; ▸ or ▴ opens it again.' },
      { how: 'Enter', does: 'Join the game whose code you typed on the home page.', keys: ['Enter'] },
    ],
  },
];

/** A note under the list: keys do nothing while you type in a box. */
export const CONTROLS_NOTE = 'Keys do nothing while you are typing in a box. On a Mac, ⌘ works wherever Ctrl does.';
