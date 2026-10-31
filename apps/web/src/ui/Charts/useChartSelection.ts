import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

/**
 * Picking a day on a chart, by any means: hover (mouse), tap or drag
 * (touch — the nearest day, so even a 2 px bar in a 90-day chart is
 * easy to hit), and the keyboard (←/→, Home/End, Esc). `band` charts
 * (bars) split the width into equal slots; `point` charts (a line)
 * snap to the nearest point.
 */
export function useChartSelection(count: number, mode: 'band' | 'point') {
  const ref = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const active = selected !== null && selected < count ? selected : null;

  const indexAt = useCallback(
    (clientX: number) => {
      const box = ref.current?.getBoundingClientRect();
      if (!box || box.width === 0 || count === 0) return null;
      const f = Math.min(0.9999, Math.max(0, (clientX - box.left) / box.width));
      return mode === 'band' ? Math.floor(f * count) : Math.round(f * (count - 1));
    },
    [count, mode],
  );

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const index = indexAt(event.clientX);
    if (index === null) return;
    // A second tap on the same day closes its tooltip again.
    setSelected((prev) => (event.pointerType !== 'mouse' && prev === index ? null : index));
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    // Mouse: follow the pointer. Touch/pen: only while pressed (a drag scrubs).
    if (event.pointerType !== 'mouse' && event.buttons === 0) return;
    const index = indexAt(event.clientX);
    if (index !== null) setSelected(index);
  };

  const onPointerLeave = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse') setSelected(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (count === 0) return;
    const last = count - 1;
    const step: Record<string, (i: number) => number> = {
      ArrowRight: (i) => Math.min(last, i + 1),
      ArrowLeft: (i) => Math.max(0, i - 1),
      Home: () => 0,
      End: () => last,
    };
    if (event.key === 'Escape') {
      setSelected(null);
      return;
    }
    const move = step[event.key];
    if (!move) return;
    event.preventDefault();
    // First key press starts from the most recent day.
    setSelected((prev) => (prev === null || prev >= count ? last : move(prev)));
  };

  // Keyboard focus without a pick yet: show the most recent day.
  const onFocus = () => {
    if (ref.current?.matches(':focus-visible')) setSelected((prev) => prev ?? count - 1);
  };

  return {
    ref,
    active,
    setActive: setSelected,
    handlers: { onPointerDown, onPointerMove, onPointerLeave, onKeyDown, onFocus },
  };
}
