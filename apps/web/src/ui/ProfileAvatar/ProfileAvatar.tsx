import { useState, type ReactNode } from 'react';

export interface ProfileAvatarProps {
  /** The VK avatar URL, or null/undefined when the account has none. */
  src: string | null | undefined;
  /** Rendered when there is no URL, or the image fails to load. */
  fallback: ReactNode;
  className?: string;
}

/**
 * The signed-in user's picture. A broken or blocked avatar URL (VK CDN
 * hiccup, content blocker) falls back to `fallback` instead of showing a
 * broken-image icon. `referrerPolicy="no-referrer"` keeps our page URL
 * out of the third-party CDN request.
 */
export function ProfileAvatar({ src, fallback, className }: ProfileAvatarProps) {
  // Remember WHICH url failed, so a new avatar url gets a fresh try.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (!src || failedSrc === src) return <>{fallback}</>;
  return (
    <img
      src={src}
      alt=""
      className={className}
      referrerPolicy="no-referrer"
      onError={() => setFailedSrc(src)}
    />
  );
}
