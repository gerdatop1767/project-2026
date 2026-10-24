import { useEffect, useRef, useState, type RefObject } from 'react';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
const FINE_POINTER = '(hover: hover) and (pointer: fine)';

function matches(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches
    : false;
}

export type RevealState = 'off' | 'pending' | 'shown';

/**
 * Fade/rise-in when the icon first scrolls into view. The hidden state is
 * only ever used when an IntersectionObserver exists and the user has not
 * asked for reduced motion — otherwise the icon is simply visible, so a
 * missing API can never leave an icon invisible.
 */
export function useRevealOnScroll(ref: RefObject<HTMLElement | null>, enabled: boolean) {
  const [state, setState] = useState<RevealState>(() => {
    if (!enabled) return 'off';
    if (typeof IntersectionObserver === 'undefined' || matches(REDUCED_MOTION)) return 'off';
    return 'pending';
  });

  useEffect(() => {
    if (state !== 'pending') return;
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setState('shown');
          observer.disconnect();
        }
      },
      // Starts a little BEFORE the icon is on screen, so by the time it is
      // seen it is already arriving — part of the page, not something to wait for.
      { threshold: 0, rootMargin: '0px 0px 12% 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [state, ref]);

  return state;
}

/** How far (px) the artwork may drift toward the pointer. */
const PARALLAX_PX = 4;

/**
 * Very light pointer parallax, desktop (fine pointer, hover capable) only and
 * never with reduced motion. Writes two CSS variables from a single rAF per
 * frame; the stylesheet turns them into a `transform`, so nothing but
 * compositing happens while the pointer moves.
 */
export function usePointerParallax(ref: RefObject<HTMLElement | null>, enabled: boolean) {
  const frame = useRef(0);

  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element || !matches(FINE_POINTER) || matches(REDUCED_MOTION)) return;
    // Follow the whole card when the icon sits inside one, else the icon itself.
    const target = element.closest<HTMLElement>('[data-subject-interactive]') ?? element;

    const set = (x: number, y: number) => {
      element.style.setProperty('--px', `${x.toFixed(2)}px`);
      element.style.setProperty('--py', `${y.toFixed(2)}px`);
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        const rect = target.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        const nx = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
        const ny = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
        set(nx * PARALLAX_PX, ny * PARALLAX_PX);
      });
    };
    const onLeave = () => {
      cancelAnimationFrame(frame.current);
      set(0, 0);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerleave', onLeave);
    return () => {
      cancelAnimationFrame(frame.current);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerleave', onLeave);
    };
  }, [ref, enabled]);
}

/**
 * Press feedback driven by pointer events instead of `:active`: iOS Safari
 * (and so Telegram's iOS WebView) only applies `:active` on touch when a touch
 * handler is registered, so a CSS-only press state silently never shows there.
 * `pointerdown` marks the icon pressed; anything that ends the gesture —
 * release, cancel (the browser took over to scroll), leaving the card, losing
 * focus — clears it, so no pressed state can get stuck.
 */
export function usePressFeedback(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const target = element.closest<HTMLElement>('[data-subject-interactive]') ?? element;
    // The card holding the icon is marked too, so it can give its own press
    // feedback (see global.css).
    const press = () => {
      element.dataset.pressed = 'true';
      if (target !== element) target.dataset.pressed = 'true';
    };
    const release = () => {
      delete element.dataset.pressed;
      if (target !== element) delete target.dataset.pressed;
    };
    target.addEventListener('pointerdown', press, { passive: true });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave', 'dragstart', 'blur']) {
      target.addEventListener(type, release, { passive: true });
    }
    return () => {
      target.removeEventListener('pointerdown', press);
      for (const type of ['pointerup', 'pointercancel', 'pointerleave', 'dragstart', 'blur']) {
        target.removeEventListener(type, release);
      }
    };
  }, [ref]);
}
