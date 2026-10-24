import { useState, type ReactNode } from 'react';

export interface ProfileAvatarProps {
  /** The avatar URL (our own /api/v1/me/avatars/… copy, or a provider URL), or null. */
  src: string | null | undefined;
  /** Shown while the picture loads, and instead of it when there is no URL
   * or it fails — never a broken-image icon, never an empty frame. */
  fallback: ReactNode;
  className?: string;
}

/**
 * The signed-in user's picture. While the image is still on its way the
 * neutral `fallback` (initials / mascot) stays visible; the picture
 * replaces it the moment it has loaded (a cached image does so on the
 * first frame). A broken or blocked URL keeps the fallback.
 * `referrerPolicy="no-referrer"` keeps our page URL out of any third-party
 * CDN request.
 */
export function ProfileAvatar({ src, fallback, className }: ProfileAvatarProps) {
  // Remember WHICH url loaded / failed, so a new avatar url starts fresh.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);

  if (!src || failedSrc === src) return <>{fallback}</>;
  const loaded = loadedSrc === src;
  return (
    <>
      {!loaded && fallback}
      <img
        // An already-cached image is complete before React's onLoad would
        // fire in some engines — check once the element exists.
        ref={(img) => {
          if (img?.complete && img.naturalWidth > 0 && loadedSrc !== src) setLoadedSrc(src);
        }}
        src={src}
        alt=""
        className={className}
        decoding="async"
        referrerPolicy="no-referrer"
        style={loaded ? undefined : { display: 'none' }}
        onLoad={() => setLoadedSrc(src)}
        onError={() => setFailedSrc(src)}
      />
    </>
  );
}
