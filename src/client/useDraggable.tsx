import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';

const KEY = 'mesbg-tabletop:cards';
const WIDE = '(min-width: 1100px)';

interface Saved {
  x?: number;
  y?: number;
  locked?: boolean;
}

function read(id: string): Saved {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}')[id] ?? {};
  } catch {
    return {};
  }
}

function write(id: string, v: Saved) {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    all[id] = v;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Storage blocked: the card goes back to its usual place next time.
  }
}

function useWide() {
  const [wide, setWide] = useState(() => typeof matchMedia === 'function' && matchMedia(WIDE).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(WIDE);
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

/**
 * Lets a floating card be dragged by its header and locked where it is, on computer screens.
 * The spot is remembered in this browser, per card.
 */
export function useDraggable(id: string) {
  const wide = useWide();
  const ref = useRef<HTMLElement>(null);
  const [saved, setSaved] = useState<Saved>(() => read(id));
  const [, redraw] = useState(0);

  // Keep the card on screen when the window shrinks.
  useEffect(() => {
    const on = () => redraw(n => n + 1);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);

  const update = (v: Saved) => {
    setSaved(v);
    write(id, v);
  };

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      const el = ref.current;
      const parent = el?.offsetParent as HTMLElement | null;
      if (!wide || saved.locked || !el || !parent || e.button !== 0) return;
      // Buttons, fields and links inside the header keep working.
      if ((e.target as HTMLElement).closest('button, input, select, textarea, a, label')) return;
      e.preventDefault();
      const box = el.getBoundingClientRect();
      const area = parent.getBoundingClientRect();
      const dx = e.clientX - box.left;
      const dy = e.clientY - box.top;
      let last: Saved = saved;
      const move = (ev: PointerEvent) => {
        const x = Math.min(Math.max(0, ev.clientX - area.left - dx), area.width - box.width);
        const y = Math.min(Math.max(0, ev.clientY - area.top - dy), area.height - Math.min(box.height, 60));
        last = { ...saved, x, y };
        setSaved(last);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        write(id, last);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [wide, saved, id],
  );

  let style: CSSProperties | undefined;
  if (wide && saved.x != null && saved.y != null) {
    const parent = ref.current?.offsetParent as HTMLElement | null;
    const w = ref.current?.offsetWidth ?? 0;
    const x = parent ? Math.min(saved.x, Math.max(0, parent.clientWidth - w)) : saved.x;
    const y = parent ? Math.min(saved.y, Math.max(0, parent.clientHeight - 60)) : saved.y;
    style = { left: x, top: y, right: 'auto', bottom: 'auto' };
  }

  const controls = wide ? (
    <span className="card-grip">
      <button
        className={`card-lock ${saved.locked ? 'on' : ''}`}
        onClick={() => update({ ...saved, locked: !saved.locked })}
        title={saved.locked ? 'Unlock: drag the card by its header to move it' : 'Lock the card where it is'}
        aria-label={saved.locked ? 'Unlock card position' : 'Lock card position'}
        aria-pressed={!!saved.locked}
      >
        {saved.locked ? '🔒' : '🔓'}
      </button>
      {saved.x != null && !saved.locked && (
        <button className="card-lock" onClick={() => update({ locked: saved.locked })} title="Put the card back in its usual place" aria-label="Reset card position">
          ↺
        </button>
      )}
    </span>
  ) : null;

  return { ref, style, onPointerDown, draggable: wide && !saved.locked, controls };
}
