export interface YandexIconProps {
  size?: number;
  className?: string;
}

/**
 * A plain «Я» mark for the «Войти через Яндекс» button — not a traced copy
 * of Yandex's logo file (no brand asset exists in this repo), just the
 * letter on Yandex red.
 */
export function YandexIcon({ size = 20, className }: YandexIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <circle cx="10" cy="10" r="10" fill="#fc3f1d" />
      <text
        x="10"
        y="14.5"
        textAnchor="middle"
        fontSize="12"
        fontWeight="700"
        fontFamily="system-ui, sans-serif"
        fill="#ffffff"
      >
        Я
      </text>
    </svg>
  );
}
