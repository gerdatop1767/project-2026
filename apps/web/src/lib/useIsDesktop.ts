import { useEffect, useState } from 'react';

const DESKTOP_QUERY = '(min-width: 1024px)';

/** The same switch, read once outside React (e.g. to start loading the
 * right app tree before the first render). */
export function isDesktopViewport(): boolean {
  return typeof window === 'undefined' || typeof window.matchMedia !== 'function'
    ? true
    : window.matchMedia(DESKTOP_QUERY).matches;
}

/**
 * Desktop and mobile are separate approved compositions (S1 Block 6),
 * not one responsive layout — this is the single switch that decides
 * which component tree mounts. 1024px keeps phones and portrait
 * tablets on the mobile (bottom-tab) experience and only promotes
 * landscape tablets and up to the desktop (sidebar) shell.
 */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window === 'undefined' ? true : window.matchMedia(DESKTOP_QUERY).matches,
  );

  useEffect(() => {
    const query = window.matchMedia(DESKTOP_QUERY);
    const listener = () => setIsDesktop(query.matches);
    listener();
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }, []);

  return isDesktop;
}
