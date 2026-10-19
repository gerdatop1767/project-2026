import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { resetPrivateCaches } from '../lib/privateCaches.js';

// Testing Library's auto-cleanup relies on a global `afterEach` hook, which
// Vitest only provides when `test.globals` is enabled. This project keeps
// explicit imports (no globals), so cleanup is wired up here instead —
// otherwise each test's render() output would stack up in the DOM.
afterEach(() => {
  cleanup();
  // Routing now reads/writes real browser history (see lib/navigation.tsx
  // + lib/routes.ts). Without resetting it, one test's pushState/back()
  // calls would leak into the next test's initial location within the
  // same file.
  window.history.replaceState(null, '', '/');
  // Module-level caches (e.g. the resolved task orders in
  // useTaskNavigation) would otherwise carry one test's mocked data into
  // the next — the same reset a sign-out runs.
  resetPrivateCaches();
});

// jsdom doesn't implement matchMedia. Components that check
// `prefers-reduced-motion` (e.g. useReducedMotion) need it defined, so
// tests get a stub that always reports "no preference" unless a test
// overrides it.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

// jsdom doesn't implement scrollIntoView (TaskNumberStrip uses it to
// keep the active task number in view — audit Block 4). A no-op stub
// is enough here; real scroll position isn't something jsdom tracks.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// jsdom has no ResizeObserver at all (MathText's KatexSpan uses one to
// detect an overflowing formula for its scroll-fade cues — EGE
// Fidelity Final Polish, Block 2). A stub that never actually fires is
// enough for tests: they only need the effect to mount/unmount without
// throwing, not real layout measurement (jsdom's scrollWidth/clientWidth
// are always 0).
if (typeof window.ResizeObserver === 'undefined') {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// jsdom doesn't implement the Pointer Events capture API (CanvasBoard's
// drawing uses setPointerCapture/releasePointerCapture — Task Workspace
// block 4). No-op stubs are enough: tests only need the handlers to run
// without throwing, not real capture semantics.
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}

// jsdom has no canvas 2D backend (would need the native `canvas`
// package) — HTMLCanvasElement.getContext() logs a "not implemented"
// warning and returns null. CanvasBoard's own state (strokes/undo/redo)
// is plain data managed outside the canvas element, so tests can still
// exercise the real pointer-event → stroke → onChangeState flow; they
// just never see actual pixels, which they don't assert on anyway.
