import type { MouseEvent } from 'react';

/**
 * Navigation items are real links (`<a href>`) so crawlers and the browser
 * see where they lead (open in a new tab, copy link). A plain left click
 * stays in the app: the default is prevented and `go` runs instead.
 */
export function onLinkClick(event: MouseEvent<HTMLAnchorElement>, go: () => void): void {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }
  event.preventDefault();
  go();
}
