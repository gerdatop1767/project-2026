import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clearCanvas,
  commitStroke,
  redoStroke,
  undoStroke,
  type CanvasPoint,
  type CanvasState,
  type CanvasStroke,
  type CanvasTool,
} from '../../lib/canvasEngine.js';
import {
  distanceBetween,
  initialViewport,
  midpointBetween,
  panBy,
  screenToWorld,
  zoomAtPoint,
  type CanvasViewport,
} from '../../lib/canvasViewport.js';
import type { SampleTask } from '../../data/sampleTask.js';
import { Icon } from '../Icon/Icon.js';
import { MathText } from '../MathText/MathText.js';
import { TaskExamIllustration } from '../TaskIllustration/TaskIllustration.js';
import { clsx } from '../../lib/clsx.js';
import styles from './CanvasBoard.module.css';

/** Mirrors the design tokens' accent/status colors (tokens.css) —
 * canvas 2D fillStyle/strokeStyle needs literal color strings, not CSS
 * custom properties, so these are the same hex values by hand rather
 * than a new palette. The white swatch is dropped here: the drawing
 * surface is white paper, so white ink would be invisible; a
 * near-black replaces it as the default "pen" color. */
const PALETTE = ['#14141f', '#8b14f5', '#0a84ff', '#16a34a', '#e11d48', '#d97706'] as const;

const SIZES = [3, 6, 10] as const;

/** Extra blank drawing room below the task card, in world px — a
 * generous scratch area (more than one screenful) so the free-draw
 * area always has real room, not just whatever's left over after the
 * task card. */
const MIN_FREE_SPACE = 700;

/** Caps the canvas backing-store's largest dimension regardless of
 * zoom * devicePixelRatio (QA v2 Block C/D: the old `zoom * dpr` scale
 * was unbounded — at max zoom on a 3x-dpr phone the backing store
 * could reach tens of millions of pixels, which is the real cause of
 * the reported zoom-in lag, not just event frequency). Ink softens
 * slightly past this ceiling instead of the canvas becoming
 * physically enormous. */
const MAX_BACKING_STORE_DIMENSION = 4096;

export interface CanvasBoardProps {
  state: CanvasState;
  onChangeState: (next: CanvasState) => void;
  task: SampleTask;
}

/**
 * The scratchboard's shared drawing core: a single white, zoomable/
 * pannable "world" containing both the current task's condition/
 * illustration (top) and the free-draw canvas layered directly over
 * the whole world, so the user can draw over the task or below it as
 * one continuous surface.
 *
 * Coordinate model: strokes are stored in WORLD coordinates
 * (canvasEngine/canvasSessionStore never knows about zoom/pan).
 * `viewport` (canvasViewport.ts) converts between screen space and
 * world space.
 *
 * Rendering model (QA v2 Block C/D — stylus/performance audit): two
 * stacked canvases, not one:
 * - `baseCanvas` holds every COMMITTED stroke, redrawn only when
 *   `state.strokes` changes (commit/undo/redo/clear) or the world/zoom
 *   settles — never on a bare pointermove.
 * - `activeCanvas` (transparent, on top) holds only the IN-PROGRESS
 *   stroke, redrawn from a mutable ref (never React state) on every
 *   move. Since it only ever draws at most one stroke, this stays
 *   cheap even on fast stylus input, unlike the old single-canvas
 *   design that re-painted every committed stroke on every move.
 * Both pointer-drawing and pinch/pan updates are coalesced to at most
 * one state update per animation frame via a shared `scheduleFrame`
 * helper, so a 120Hz+ pointer stream never forces more than 60
 * React renders/canvas resizes per second.
 */
function midpoint(a: CanvasPoint, b: CanvasPoint): CanvasPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Builds a smoothed path through raw pointer samples — a quadratic
 * curve through each point using the midpoints of its neighbors as
 * anchors, the standard cheap technique for natural-looking freehand
 * lines (QA v2 Block D: "не превращать handwriting в чрезмерно
 * сглаженную кривую" — this only smooths the *joints* between
 * consecutive samples, so short strokes, dots, digits and math symbols
 * keep their real shape instead of being resampled into a generic
 * curve).
 */
function pathForPoints(points: readonly CanvasPoint[]): Path2D {
  const path = new Path2D();
  if (points.length === 0) return path;
  const [first] = points;
  if (points.length === 1) {
    path.moveTo(first!.x, first!.y);
    path.lineTo(first!.x + 0.01, first!.y + 0.01);
    return path;
  }
  if (points.length === 2) {
    path.moveTo(first!.x, first!.y);
    path.lineTo(points[1]!.x, points[1]!.y);
    return path;
  }
  path.moveTo(first!.x, first!.y);
  path.lineTo(midpoint(points[0]!, points[1]!).x, midpoint(points[0]!, points[1]!).y);
  for (let i = 1; i < points.length - 1; i++) {
    const mid = midpoint(points[i]!, points[i + 1]!);
    path.quadraticCurveTo(points[i]!.x, points[i]!.y, mid.x, mid.y);
  }
  const last = points[points.length - 1]!;
  path.lineTo(last.x, last.y);
  return path;
}

function paintStroke(ctx: CanvasRenderingContext2D, stroke: CanvasStroke) {
  if (stroke.points.length === 0) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = stroke.size;
  if (stroke.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = stroke.color;
  }
  ctx.stroke(pathForPoints(stroke.points));
  ctx.restore();
}

/** Sizes a canvas's backing store to `effectiveScale` (already capped
 * — see MAX_BACKING_STORE_DIMENSION) and its own CSS box to the
 * on-screen size, then re-applies the transform every caller needs to
 * draw in WORLD coordinates directly. Shared by both stacked canvases
 * so they always stay pixel-identical. */
function resizeCanvas(
  canvas: HTMLCanvasElement,
  worldWidth: number,
  worldHeight: number,
  cssZoom: number,
  effectiveScale: number,
) {
  canvas.width = Math.max(1, Math.round(worldWidth * effectiveScale));
  canvas.height = Math.max(1, Math.round(worldHeight * effectiveScale));
  canvas.style.width = `${worldWidth * cssZoom}px`;
  canvas.style.height = `${worldHeight * cssZoom}px`;
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.setTransform(effectiveScale, 0, 0, effectiveScale, 0, 0);
}

export function CanvasBoard({ state, onChangeState, task }: CanvasBoardProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const taskCardRef = useRef<HTMLDivElement>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement>(null);
  const activeCanvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<CanvasTool>('brush');
  const [color, setColor] = useState<string>(PALETTE[0]);
  const [size, setSize] = useState<number>(SIZES[1]);
  const [rulerMode, setRulerMode] = useState(false);
  const [viewport, setViewport] = useState<CanvasViewport>(initialViewport);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [taskCardHeight, setTaskCardHeight] = useState(0);

  // Everything below is a ref, not state — none of it should ever
  // trigger a React render on its own. High-frequency pointer input
  // (stylus especially) mutates these directly; React only finds out
  // about the *result* (a committed stroke, or a batched viewport
  // update) once per animation frame at most.
  const activePointers = useRef(new Map<number, CanvasPoint>());
  const drawingPointerId = useRef<number | null>(null);
  const gestureRef = useRef<{ distance: number; midpoint: CanvasPoint } | null>(null);
  const activeStrokeRef = useRef<{
    points: CanvasPoint[];
    tool: CanvasTool;
    color: string;
    size: number;
  } | null>(null);
  const viewportLiveRef = useRef(viewport);
  const viewportDirtyRef = useRef(false);
  const frameRef = useRef<number | null>(null);

  const worldWidth = viewportSize.width;
  const worldHeight = taskCardHeight + Math.max(MIN_FREE_SPACE, viewportSize.height);

  useEffect(() => {
    viewportLiveRef.current = viewport;
  }, [viewport]);

  const drawBase = useCallback(() => {
    const canvas = baseCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || worldWidth === 0) return;
    ctx.clearRect(0, 0, worldWidth, worldHeight);
    for (const stroke of state.strokes) paintStroke(ctx, stroke);
  }, [state.strokes, worldWidth, worldHeight]);

  const drawActive = useCallback(() => {
    const canvas = activeCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || worldWidth === 0) return;
    ctx.clearRect(0, 0, worldWidth, worldHeight);
    const active = activeStrokeRef.current;
    if (active && active.points.length > 0) {
      paintStroke(ctx, active);
    }
  }, [worldWidth, worldHeight]);

  // A single per-frame flush, scheduled by every high-frequency source
  // (drawing a stroke, pinch-zoom, wheel pan/zoom) via `scheduleFrame`
  // below. Earlier this coalesced by keeping only the FIRST caller's
  // closure per frame — which silently dropped every other caller's
  // work whenever two different kinds of updates (e.g. a stroke
  // starting to draw, then a 2nd finger landing to pinch) raced for the
  // same frame slot. Routing everything through one flush that always
  // applies a pending viewport commit *and* redraws the active stroke
  // means no caller's update is ever lost, no matter which one
  // scheduled the frame.
  const flushFrame = useCallback(() => {
    if (viewportDirtyRef.current) {
      viewportDirtyRef.current = false;
      setViewport(viewportLiveRef.current);
    }
    drawActive();
  }, [drawActive]);

  const scheduleFrame = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      flushFrame();
    });
  }, [flushFrame]);

  // Tracks the viewport's own box size (independent of zoom — a CSS
  // transform never changes an ancestor's layout size) so `worldWidth`
  // always matches the panel's real available width.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setViewportSize({ width: el.clientWidth, height: el.clientHeight });
    });
    observer.observe(el);
    setViewportSize({ width: el.clientWidth, height: el.clientHeight });
    return () => observer.disconnect();
  }, []);

  // Tracks the task card's natural (zoom-1) height — KaTeX/illustration
  // content can change size after their own async layout — so the
  // free-draw area below always starts right after the real card.
  useEffect(() => {
    const el = taskCardRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setTaskCardHeight(el.offsetHeight));
    observer.observe(el);
    setTaskCardHeight(el.offsetHeight);
    return () => observer.disconnect();
  }, [task.id]);

  // Resizes both canvases together and repaints the base layer
  // whenever the world size or the *committed* zoom changes (this
  // effect fires at most once per animation frame even during a fast
  // pinch, thanks to scheduleFrame above).
  useEffect(() => {
    const base = baseCanvasRef.current;
    const active = activeCanvasRef.current;
    if (!base || !active || worldWidth === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const rawScale = viewport.zoom * dpr;
    const largestDimension = Math.max(worldWidth, worldHeight, 1);
    const scale = Math.min(rawScale, MAX_BACKING_STORE_DIMENSION / largestDimension);
    resizeCanvas(base, worldWidth, worldHeight, viewport.zoom, scale);
    resizeCanvas(active, worldWidth, worldHeight, viewport.zoom, scale);
    drawBase();
    drawActive();
  }, [worldWidth, worldHeight, viewport.zoom, drawBase, drawActive]);

  useEffect(() => {
    drawBase();
  }, [drawBase]);

  function getViewportPoint(event: { clientX: number; clientY: number }): CanvasPoint {
    const rect = viewportRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function beginStroke(worldPoint: CanvasPoint) {
    activeStrokeRef.current = { points: [worldPoint], tool, color, size };
    scheduleFrame();
  }

  function extendStroke(worldPoints: readonly CanvasPoint[]) {
    const active = activeStrokeRef.current;
    if (!active) return;
    if (rulerMode) {
      // A real scratchboard "ruler" without simulating a physical
      // ruler graphic: a straight-line snap from the stroke's start to
      // the current pointer position.
      active.points = [active.points[0]!, worldPoints[worldPoints.length - 1]!];
    } else {
      active.points.push(...worldPoints);
    }
    scheduleFrame();
  }

  function endStroke() {
    const active = activeStrokeRef.current;
    activeStrokeRef.current = null;
    if (active && active.points.length > 0) {
      onChangeState(commitStroke(state, active));
    }
    scheduleFrame();
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    // setPointerCapture can throw (InvalidPointerId) if the browser no
    // longer considers this pointer active by the time this handler
    // runs — a real, if rare, cross-browser edge case (notably Safari/
    // iOS with a very fast tap or stylus hover-lift), not just a test
    // artifact. Uncaught, it would abort the rest of this handler and
    // silently break drawing/pinch tracking for that gesture with no
    // user-visible error. Capture is a nice-to-have (keeps receiving
    // events if the pointer strays outside the canvas mid-stroke); the
    // pointer tracking below is what actually matters and must still run.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer already gone — the pointerup/pointercancel that follows
      // will clean it up via releasePointer.
    }
    const screenPoint = getViewportPoint(event);
    activePointers.current.set(event.pointerId, screenPoint);

    if (activePointers.current.size === 2) {
      // A 2nd finger just landed — this is now a pinch/pan gesture, not
      // a stroke. Drop any in-progress single-finger mark rather than
      // committing a stray line from the instant before the pinch
      // started.
      drawingPointerId.current = null;
      activeStrokeRef.current = null;
      scheduleFrame();
      const points = [...activePointers.current.values()];
      gestureRef.current = {
        distance: distanceBetween(points[0]!, points[1]!),
        midpoint: midpointBetween(points[0]!, points[1]!),
      };
    } else if (activePointers.current.size === 1) {
      drawingPointerId.current = event.pointerId;
      beginStroke(screenToWorld(viewportLiveRef.current, screenPoint));
    }
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!activePointers.current.has(event.pointerId)) return;

    if (activePointers.current.size >= 2) {
      const screenPoint = getViewportPoint(event);
      activePointers.current.set(event.pointerId, screenPoint);
      const points = [...activePointers.current.values()].slice(0, 2);
      const newDistance = distanceBetween(points[0]!, points[1]!);
      const newMidpoint = midpointBetween(points[0]!, points[1]!);
      const gesture = gestureRef.current;
      if (gesture && gesture.distance > 0) {
        const factor = newDistance / gesture.distance;
        const zoomed = zoomAtPoint(viewportLiveRef.current, gesture.midpoint, factor);
        viewportLiveRef.current = panBy(
          zoomed,
          newMidpoint.x - gesture.midpoint.x,
          newMidpoint.y - gesture.midpoint.y,
        );
        viewportDirtyRef.current = true;
        scheduleFrame();
      }
      gestureRef.current = { distance: newDistance, midpoint: newMidpoint };
      return;
    }

    if (drawingPointerId.current === event.pointerId) {
      // Coalesced events recover the finer-grained samples the OS
      // actually captured between the last two dispatched pointermove
      // events (real on iOS/Android for touch and pen) — without this,
      // a fast stylus stroke visibly loses points, showing up as a
      // slightly polygonal or "chased" line (QA v2 Block D).
      const nativeEvent = event.nativeEvent;
      const coalesced =
        typeof nativeEvent.getCoalescedEvents === 'function'
          ? nativeEvent.getCoalescedEvents()
          : [nativeEvent];
      const samples = coalesced.length > 0 ? coalesced : [nativeEvent];
      const worldPoints = samples.map((sample) =>
        screenToWorld(viewportLiveRef.current, getViewportPoint(sample)),
      );
      extendStroke(worldPoints);
    }
  }

  function releasePointer(event: React.PointerEvent<HTMLCanvasElement>) {
    activePointers.current.delete(event.pointerId);
    if (activePointers.current.size < 2) gestureRef.current = null;
    if (drawingPointerId.current === event.pointerId) {
      endStroke();
      drawingPointerId.current = null;
    }
  }

  // React attaches onWheel/onTouchMove as passive listeners by
  // default, which can't call preventDefault(). Desktop ctrl+wheel
  // zoom needs to stop the browser's own page-zoom, and — QA v2 Block
  // B — a scoped, non-passive touchmove listener on just this element
  // is the reliable cross-WebView way to guarantee a vertical drawing
  // gesture never turns into a page swipe/scroll, on top of
  // `touch-action: none` (which some embedded WebViews honor
  // inconsistently). Neither listener touches anything outside this
  // canvas, so normal page scroll everywhere else is untouched.
  useEffect(() => {
    const canvas = activeCanvasRef.current;
    if (!canvas) return;

    function handleWheel(event: WheelEvent) {
      event.preventDefault();
      const rect = viewportRef.current!.getBoundingClientRect();
      const screenPoint = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      if (event.ctrlKey || event.metaKey) {
        const factor = Math.exp(-event.deltaY * 0.01);
        viewportLiveRef.current = zoomAtPoint(viewportLiveRef.current, screenPoint, factor);
      } else {
        viewportLiveRef.current = panBy(viewportLiveRef.current, -event.deltaX, -event.deltaY);
      }
      viewportDirtyRef.current = true;
      scheduleFrame();
    }
    function preventTouchScroll(event: TouchEvent) {
      event.preventDefault();
    }

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('touchmove', preventTouchScroll, { passive: false });
    canvas.addEventListener('touchstart', preventTouchScroll, { passive: false });
    return () => {
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('touchmove', preventTouchScroll);
      canvas.removeEventListener('touchstart', preventTouchScroll);
    };
  }, [scheduleFrame]);

  const zoomPercent = Math.round(viewport.zoom * 100);

  return (
    <div className={styles.board}>
      <div className={styles.toolbar}>
        <div className={styles.toolGroup}>
          <button
            type="button"
            className={clsx(styles.toolButton, tool === 'brush' && styles.toolButtonActive)}
            aria-label="Кисть"
            aria-pressed={tool === 'brush'}
            onClick={() => setTool('brush')}
          >
            <Icon name="brush" size={18} />
          </button>
          <button
            type="button"
            className={clsx(styles.toolButton, tool === 'eraser' && styles.toolButtonActive)}
            aria-label="Ластик"
            aria-pressed={tool === 'eraser'}
            onClick={() => setTool('eraser')}
          >
            <Icon name="eraser" size={18} />
          </button>
          <button
            type="button"
            className={clsx(styles.toolButton, rulerMode && styles.toolButtonActive)}
            aria-label="Линейка"
            aria-pressed={rulerMode}
            onClick={() => setRulerMode((v) => !v)}
          >
            <Icon name="ruler" size={18} />
          </button>
        </div>

        <div className={styles.divider} aria-hidden="true" />

        <div className={styles.swatches}>
          {PALETTE.map((swatch) => (
            <button
              key={swatch}
              type="button"
              className={clsx(styles.swatch, color === swatch && styles.swatchActive)}
              style={{ background: swatch }}
              aria-label={`Цвет ${swatch}`}
              aria-pressed={color === swatch}
              onClick={() => setColor(swatch)}
            />
          ))}
        </div>

        <div className={styles.divider} aria-hidden="true" />

        <div className={styles.sizes}>
          {SIZES.map((s) => (
            <button
              key={s}
              type="button"
              className={clsx(styles.sizeButton, size === s && styles.sizeButtonActive)}
              aria-label={`Толщина ${s}`}
              aria-pressed={size === s}
              onClick={() => setSize(s)}
            >
              <span className={styles.sizeDot} style={{ width: s + 4, height: s + 4 }} />
            </button>
          ))}
        </div>

        <div className={styles.toolGroup} style={{ marginLeft: 'auto' }}>
          {viewport.zoom !== 1 && (
            <button
              type="button"
              className={styles.zoomReset}
              onClick={() => {
                viewportLiveRef.current = initialViewport();
                setViewport(viewportLiveRef.current);
              }}
            >
              {zoomPercent}%
            </button>
          )}
          <button
            type="button"
            className={styles.toolButton}
            aria-label="Отменить"
            disabled={state.strokes.length === 0}
            onClick={() => onChangeState(undoStroke(state))}
          >
            <Icon name="undo" size={18} />
          </button>
          <button
            type="button"
            className={styles.toolButton}
            aria-label="Повторить"
            disabled={state.redoStack.length === 0}
            onClick={() => onChangeState(redoStroke(state))}
          >
            <Icon name="redo" size={18} />
          </button>
          <button
            type="button"
            className={styles.toolButton}
            aria-label="Очистить полотно"
            disabled={state.strokes.length === 0}
            onClick={() => onChangeState(clearCanvas())}
          >
            <Icon name="clear" size={18} />
          </button>
        </div>
      </div>

      <div className={styles.viewport} ref={viewportRef}>
        <div
          className={styles.world}
          style={{ transform: `translate(${viewport.panX}px, ${viewport.panY}px)` }}
        >
          <div
            ref={taskCardRef}
            className={styles.taskCard}
            style={{
              width: worldWidth || undefined,
              transform: `scale(${viewport.zoom})`,
              transformOrigin: '0 0',
            }}
          >
            <div className={styles.taskCardInner}>
              <p className={styles.taskLabel}>Задание №{task.number}</p>
              <div className={clsx('text-body-sm', styles.taskCondition)}>
                <MathText text={task.condition} />
              </div>
              {/* TaskSolutionIllustration is deliberately never rendered
               * here (QA v2 Block H/final audit): the canvas dialog opens
               * from both the Task (solving) and Result screens with no
               * way for CanvasBoard to tell which, and a solution-only
               * SVG like task 14's pyramid must never appear while still
               * solving. Real source diagrams (TaskExamIllustration) are
               * fine either way, matching the Task screen's own condition
               * card. */}
              <TaskExamIllustration
                subjectId={task.subjectId}
                taskNumber={task.number}
                tags={task.tags}
                imageUrl={task.imageUrl}
                conditionMd={task.condition}
                className={styles.taskImage}
              />
            </div>
          </div>

          <canvas ref={baseCanvasRef} className={styles.canvas} style={{ pointerEvents: 'none' }} />
          <canvas
            ref={activeCanvasRef}
            className={styles.canvas}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={releasePointer}
            onPointerLeave={releasePointer}
            onPointerCancel={releasePointer}
            role="img"
            aria-label="Рабочее полотно для рисования"
          />
        </div>
      </div>
    </div>
  );
}
