import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { subjects } from '../../data/subjects.js';
import { SubjectIcon } from './SubjectIcon.js';
import {
  SUBJECT_ICON_FILES,
  SUBJECT_ICON_GLOW,
  isSubjectIconId,
  subjectIconSrc,
  subjectIconSrcSet,
} from './subjectIcons.js';

const PUBLIC_DIR = resolve(__dirname, '../../../public/branding/v2/subject-icons');

describe('subject icon files', () => {
  it('maps the nine approved file names to the right subjects (file name = source of truth)', () => {
    expect(SUBJECT_ICON_FILES).toEqual({
      math: '01_Mathematics.png',
      russian: '02_Russian_Language.png',
      english: '03_English_Language.png',
      social: '04_Social_Studies.png',
      informatics: '05_Informatics.png',
      physics: '06_Physics.png',
      chemistry: '07_Chemistry.png',
      biology: '08_Biology.png',
      history: '09_History.png',
    });
  });

  it('covers every subject of the app, each with its own glow colour', () => {
    for (const subject of subjects) {
      expect(isSubjectIconId(subject.id)).toBe(true);
    }
    expect(Object.keys(SUBJECT_ICON_FILES).sort()).toEqual(subjects.map((s) => s.id).sort());
    expect(new Set(Object.values(SUBJECT_ICON_GLOW)).size).toBe(9);
  });

  it('ships a real, square, transparent PNG for each of the nine, and nothing else', () => {
    expect(
      readdirSync(PUBLIC_DIR)
        .filter((f) => f !== 'sized')
        .sort(),
    ).toEqual(Object.values(SUBJECT_ICON_FILES).sort());
    for (const file of Object.values(SUBJECT_ICON_FILES)) {
      const bytes = readFileSync(join(PUBLIC_DIR, file));
      expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a'); // PNG signature
      const width = bytes.readUInt32BE(16);
      const height = bytes.readUInt32BE(20);
      expect([width, height]).toEqual([512, 512]);
      expect(bytes[25]).toBe(6); // RGBA colour type: keeps the transparent corners
      expect(statSync(join(PUBLIC_DIR, file)).size).toBeLessThan(600 * 1024);
    }
  });

  it('ships small WebP copies (128/256 px) of each, used through srcset', () => {
    for (const [id, file] of Object.entries(SUBJECT_ICON_FILES)) {
      const base = file.replace(/\.png$/, '');
      for (const w of [128, 256]) {
        const bytes = readFileSync(join(PUBLIC_DIR, 'sized', `${base}-${w}.webp`));
        expect(bytes.subarray(0, 4).toString()).toBe('RIFF');
        expect(bytes.subarray(8, 12).toString()).toBe('WEBP');
        expect(bytes.length).toBeLessThan(40 * 1024);
      }
      expect(subjectIconSrcSet(id as keyof typeof SUBJECT_ICON_FILES)).toContain(
        `sized/${base}-128.webp 128w`,
      );
    }
  });

  it('builds the URL from the approved file name', () => {
    expect(subjectIconSrc('physics')).toBe('/branding/v2/subject-icons/06_Physics.png');
  });
});

describe('SubjectIcon', () => {
  it.each(Object.entries(SUBJECT_ICON_FILES))('%s renders %s', (id, file) => {
    const { container } = render(<SubjectIcon subjectId={id} />);
    const img = container.querySelector('img')!;
    expect(img.getAttribute('src')).toBe(`/branding/v2/subject-icons/${file}`);
    expect(img.getAttribute('alt')).toBe(''); // decorative: the name is always written next to it
  });

  it('renders nothing for an unknown subject instead of a broken image', () => {
    const { container } = render(<SubjectIcon subjectId="astrology" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('marks the selected subject, which also draws the outline element', () => {
    const { container } = render(<SubjectIcon subjectId="math" selected />);
    expect(container.querySelector('[data-selected]')).toBeInTheDocument();
    const plain = render(<SubjectIcon subjectId="math" />);
    expect(plain.container.querySelector('[data-selected]')).toBeNull();
  });

  it("uses the icon's own colour for its glow", () => {
    const { container } = render(<SubjectIcon subjectId="biology" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.getPropertyValue('--glow')).toBe(SUBJECT_ICON_GLOW.biology);
  });
});

describe('SubjectIcon — scroll reveal', () => {
  type Callback = (entries: { isIntersecting: boolean }[]) => void;
  let callbacks: Callback[];
  let disconnects: number;

  beforeEach(() => {
    callbacks = [];
    disconnects = 0;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: Callback) {
          callbacks.push(cb);
        }
        observe() {}
        disconnect() {
          disconnects += 1;
        }
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('stays hidden until it scrolls into view, then shows once and stops observing', () => {
    const { container } = render(<SubjectIcon subjectId="math" reveal={0} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.dataset.reveal).toBe('pending');
    act(() => callbacks[0]!([{ isIntersecting: false }]));
    expect(root.dataset.reveal).toBe('pending');
    act(() => callbacks[0]!([{ isIntersecting: true }]));
    expect(root.dataset.reveal).toBe('shown');
    expect(disconnects).toBeGreaterThan(0);
  });

  it('staggers neighbours only ~30 ms apart, capped low — icons arrive with the page, never trail behind it', () => {
    const delays = [0, 1, 2, 9].map((index) => {
      const { container } = render(<SubjectIcon subjectId="math" reveal={index} />);
      return (container.firstElementChild as HTMLElement).style.getPropertyValue('--reveal-delay');
    });
    expect(delays).toEqual(['0ms', '30ms', '60ms', '90ms']);
  });

  it('is plainly visible (never hidden) when reveal is not requested', () => {
    const { container } = render(<SubjectIcon subjectId="math" />);
    expect((container.firstElementChild as HTMLElement).dataset.reveal).toBe('off');
  });

  it('is plainly visible when the user prefers reduced motion', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      addEventListener() {},
      removeEventListener() {},
    }));
    const { container } = render(<SubjectIcon subjectId="math" reveal={0} />);
    expect((container.firstElementChild as HTMLElement).dataset.reveal).toBe('off');
    expect(callbacks).toHaveLength(0);
  });
});

describe('SubjectIcon — reveal without IntersectionObserver', () => {
  it('shows the icon immediately instead of leaving it invisible', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const { container } = render(<SubjectIcon subjectId="math" reveal={0} />);
    expect((container.firstElementChild as HTMLElement).dataset.reveal).toBe('off');
    vi.unstubAllGlobals();
  });
});

describe('SubjectIcon — pointer parallax', () => {
  const stubMedia = (fine: boolean, reduced: boolean) =>
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('prefers-reduced-motion') ? reduced : fine,
      addEventListener() {},
      removeEventListener() {},
    }));
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });
  afterEach(() => vi.unstubAllGlobals());

  function renderCard() {
    const view = render(
      <button type="button" data-subject-interactive>
        <SubjectIcon subjectId="math" parallax />
      </button>,
    );
    const card = view.container.querySelector('button') as HTMLElement;
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 200,
      height: 100,
      right: 200,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON() {},
    });
    return { card, root: card.firstElementChild as HTMLElement, unmount: view.unmount };
  }

  it('drifts a few pixels toward the mouse on desktop, and settles back on leave', () => {
    stubMedia(true, false);
    const { card, root } = renderCard();
    fireEvent.pointerMove(card, { clientX: 200, clientY: 100, pointerType: 'mouse' });
    expect(root.style.getPropertyValue('--px')).toBe('4.00px');
    expect(root.style.getPropertyValue('--py')).toBe('4.00px');
    fireEvent.pointerLeave(card);
    expect(root.style.getPropertyValue('--px')).toBe('0.00px');
  });

  it('does nothing on touch devices or with reduced motion', () => {
    stubMedia(false, false);
    let view = renderCard();
    fireEvent.pointerMove(view.card, { clientX: 200, clientY: 100, pointerType: 'mouse' });
    expect(view.root.style.getPropertyValue('--px')).toBe('');
    view.unmount();

    stubMedia(true, true);
    view = renderCard();
    fireEvent.pointerMove(view.card, { clientX: 200, clientY: 100, pointerType: 'mouse' });
    expect(view.root.style.getPropertyValue('--px')).toBe('');
  });

  it('ignores touch/pen pointers even on a fine-pointer device', () => {
    stubMedia(true, false);
    const { card, root } = renderCard();
    fireEvent.pointerMove(card, { clientX: 200, clientY: 100, pointerType: 'touch' });
    expect(root.style.getPropertyValue('--px')).toBe('');
  });
});

describe('SubjectIcon — press feedback (pointer events, works on touch)', () => {
  function renderCard() {
    const view = render(
      <button type="button" data-subject-interactive>
        <SubjectIcon subjectId="math" />
      </button>,
    );
    const card = view.container.querySelector('button') as HTMLElement;
    return { card, root: card.firstElementChild as HTMLElement };
  }

  it('marks the icon pressed on pointerdown, for touch as well as mouse', () => {
    for (const pointerType of ['touch', 'mouse', 'pen']) {
      const { card, root } = renderCard();
      fireEvent.pointerDown(card, { pointerType });
      expect(root.dataset.pressed).toBe('true');
    }
  });

  it.each(['pointerUp', 'pointerCancel', 'pointerLeave', 'blur'] as const)(
    'clears the pressed state on %s, so it can never get stuck',
    (event) => {
      const { card, root } = renderCard();
      fireEvent.pointerDown(card, { pointerType: 'touch' });
      fireEvent[event](card);
      expect(root.dataset.pressed).toBeUndefined();
    },
  );

  it('works on a bare icon too (no card around it)', () => {
    const { container } = render(<SubjectIcon subjectId="math" />);
    const root = container.firstElementChild as HTMLElement;
    fireEvent.pointerDown(root, { pointerType: 'touch' });
    expect(root.dataset.pressed).toBe('true');
    fireEvent.pointerUp(root);
    expect(root.dataset.pressed).toBeUndefined();
  });

  it('stops listening after unmount', () => {
    const view = render(
      <button type="button" data-subject-interactive>
        <SubjectIcon subjectId="math" />
      </button>,
    );
    const card = view.container.querySelector('button') as HTMLElement;
    const root = card.firstElementChild as HTMLElement;
    view.unmount();
    fireEvent.pointerDown(card, { pointerType: 'touch' });
    expect(root.dataset.pressed).toBeUndefined();
  });
});
