import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * The admin panel's tiny router: real URLs under /admin (bookmarkable,
 * Back/Forward work), query string for filters. Separate from the main
 * app's navigation on purpose — the admin bundle is its own lazy chunk.
 */
export interface AdminLocation {
  path: string;
  params: URLSearchParams;
}

interface RouterValue {
  location: AdminLocation;
  navigate: (to: string, options?: { replace?: boolean }) => void;
  /** Replace some query params, keeping the path. */
  setParams: (patch: Record<string, string | null | undefined>) => void;
}

const RouterContext = createContext<RouterValue | null>(null);

function read(): AdminLocation {
  return { path: window.location.pathname, params: new URLSearchParams(window.location.search) };
}

export function AdminRouter({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState(read);
  useEffect(() => {
    const onPop = () => setLocation(read());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = useCallback((to: string, options?: { replace?: boolean }) => {
    if (!to.startsWith('/admin')) return;
    if (options?.replace) window.history.replaceState(null, '', to);
    else window.history.pushState(null, '', to);
    setLocation(read());
    if (!options?.replace) window.scrollTo({ top: 0 });
  }, []);
  const setParams = useCallback(
    (patch: Record<string, string | null | undefined>) => {
      const params = new URLSearchParams(window.location.search);
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === undefined || value === '') params.delete(key);
        else params.set(key, value);
      }
      const search = params.toString();
      navigate(`${window.location.pathname}${search ? `?${search}` : ''}`, { replace: true });
    },
    [navigate],
  );
  const value = useMemo(() => ({ location, navigate, setParams }), [location, navigate, setParams]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useAdminRouter(): RouterValue {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error('useAdminRouter outside AdminRouter');
  return ctx;
}

/** Matches `/admin/users/:id`-style patterns; returns params or null. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split('/').filter(Boolean);
  const b = path.replace(/\/+$/, '').split('/').filter(Boolean);
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.startsWith(':')) params[a[i]!.slice(1)] = decodeURIComponent(b[i]!);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

/** An in-admin link: a real <a href> (open in new tab works), routed on click. */
export function AdminLink({
  to,
  children,
  className,
  ...rest
}: { to: string; children: ReactNode; className?: string } & Omit<
  React.AnchorHTMLAttributes<HTMLAnchorElement>,
  'href'
>) {
  const { navigate } = useAdminRouter();
  return (
    <a
      {...rest}
      href={to}
      className={className}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
