import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { metrikaGoal, metrikaHit, METRIKA_ID, noteVisitDay, resetMetrikaUrl } from './metrika.js';
import { resetConsent, setConsent } from './consent.js';

const WEB = resolve(__dirname, '../..');

type W = typeof window & {
  ym?: ReturnType<typeof vi.fn>;
  __zybrilkaMetrika?: () => void;
  __zybrilkaMetrikaStarted?: boolean;
};
const win = window as W;

function runIndexHtmlCounterScript() {
  // The inline script from index.html, run as the browser would.
  const html = readFileSync(resolve(WEB, 'index.html'), 'utf8');
  const start = html.indexOf('<!-- Yandex.Metrika counter -->');
  const script = html
    .slice(html.indexOf('<script type="text/javascript">', start))
    .split('</script>')[0]!;
  new Function(script.replace('<script type="text/javascript">', ''))();
}

beforeEach(() => {
  delete win.ym;
  delete win.__zybrilkaMetrika;
  delete win.__zybrilkaMetrikaStarted;
  document.head.querySelectorAll('script[src*="mc.yandex.ru"]').forEach((s) => s.remove());
  resetConsent();
  window.localStorage.clear();
});
afterEach(() => resetConsent());

describe('Yandex.Metrika counter in index.html', () => {
  it('carries the counter code exactly as issued, with the counter id', () => {
    const html = readFileSync(resolve(WEB, 'index.html'), 'utf8');
    for (const line of [
      'm[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};',
      'm[i].l=1*new Date();',
      'for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}',
      'k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)',
      "})(window, document,'script','https://mc.yandex.ru/metrika/tag.js?id=114059780', 'ym');",
      'ym(114059780, \'init\', {ssr:true, webvisor:true, clickmap:true, ecommerce:"dataLayer", referrer: document.referrer, url: location.href, accurateTrackBounce:true, trackLinks:true});',
    ]) {
      expect(html).toContain(line);
    }
    expect(html.match(/<!-- Yandex\.Metrika counter -->/g)).toHaveLength(1);
  });

  it('does not start without consent to analytics', () => {
    runIndexHtmlCounterScript();
    expect(win.__zybrilkaMetrikaStarted).toBeUndefined();
    expect(document.querySelectorAll('script[src*="mc.yandex.ru"]')).toHaveLength(0);
  });

  it('starts on load when consent was given, and only once however often it is asked', () => {
    window.localStorage.setItem('zybrilka-cookie-consent', 'a1');
    document.head.appendChild(document.createElement('script'));
    runIndexHtmlCounterScript();
    win.__zybrilkaMetrika!();
    win.__zybrilkaMetrika!();
    expect(win.__zybrilkaMetrikaStarted).toBe(true);
    expect(document.querySelectorAll('script[src*="mc.yandex.ru"]')).toHaveLength(1);
    const ym = win.ym as unknown as { a: unknown[][] };
    expect(ym.a.filter((args) => args[1] === 'init')).toHaveLength(1);
  });

  it('accepting the cookie banner starts it in the same page view', () => {
    document.head.appendChild(document.createElement('script'));
    runIndexHtmlCounterScript();
    expect(win.__zybrilkaMetrikaStarted).toBeUndefined();
    setConsent({ analytics: true });
    expect(win.__zybrilkaMetrikaStarted).toBe(true);
  });
});

describe('SPA hits and goals', () => {
  beforeEach(() => {
    win.__zybrilkaMetrikaStarted = true;
    win.ym = vi.fn();
    resetMetrikaUrl(window.location.href);
  });

  it('sends one hit per new URL with the previous URL as referrer, none for the same URL', () => {
    const before = window.location.href;
    window.history.pushState({}, '', '/subjects/math');
    metrikaHit();
    metrikaHit();
    expect(win.ym).toHaveBeenCalledTimes(1);
    expect(win.ym).toHaveBeenCalledWith(
      METRIKA_ID,
      'hit',
      window.location.href,
      expect.objectContaining({ referer: before }),
    );
  });

  it('sends nothing while the counter is not running', () => {
    win.__zybrilkaMetrikaStarted = false;
    window.history.pushState({}, '', '/statistics');
    metrikaHit();
    metrikaGoal('task_solved');
    expect(win.ym).not.toHaveBeenCalled();
  });

  it('reaches goals; «once per page» goals only once', () => {
    metrikaGoal('task_solved');
    metrikaGoal('task_solved');
    metrikaGoal('registration', { oncePerPage: true });
    metrikaGoal('registration', { oncePerPage: true });
    const goals = win.ym!.mock.calls.filter((c) => c[1] === 'reachGoal').map((c) => c[2]);
    expect(goals).toEqual(['task_solved', 'task_solved', 'registration']);
  });

  it('«return_visit» only when the previous visit was on an earlier day', () => {
    expect(noteVisitDay('2026-11-01')).toBe(false); // first visit ever
    expect(noteVisitDay('2026-11-01')).toBe(false); // same day
    expect(noteVisitDay('2026-11-03')).toBe(true);
    expect(win.ym).toHaveBeenCalledWith(METRIKA_ID, 'reachGoal', 'return_visit');
  });
});

describe('Yandex.Webmaster verification file', () => {
  it('is in public/ unchanged (byte for byte), so it is copied to the build root', () => {
    const bytes = readFileSync(resolve(WEB, 'public/yandex_d514299f65b97010.html'));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      '661b8a7525a7cdbadc2d76b19353f67c123bb8659b1ca953ee76ab1538455d49',
    );
    expect(bytes.toString('utf8')).toContain('Verification: d514299f65b97010');
  });
});
