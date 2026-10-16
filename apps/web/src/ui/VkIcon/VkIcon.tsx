export interface VkIconProps {
  size?: number;
  className?: string;
}

/**
 * A plain inline rendering of the VK wordmark (not a traced copy of
 * VK's trademarked logo file — just the two letters in VK's own blue,
 * which is all the "Продолжить через ВКонтакте" button needs to read
 * as a VK button). No brand SVG asset exists in this repo to reuse.
 */
export function VkIcon({ size = 20, className }: VkIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <rect width="20" height="20" rx="5" fill="currentColor" />
      <text
        x="10"
        y="14"
        textAnchor="middle"
        fontSize="10"
        fontWeight="700"
        fontFamily="system-ui, sans-serif"
        fill="#0077ff"
      >
        VK
      </text>
    </svg>
  );
}
