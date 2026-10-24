import {
  Atom,
  Bird,
  Cat,
  Cloud,
  Dog,
  Feather,
  Fish,
  Gem,
  Leaf,
  Moon,
  Mountain,
  Orbit,
  Origami,
  Panda,
  PawPrint,
  Rabbit,
  Rocket,
  Shell,
  Snail,
  Snowflake,
  Sprout,
  Squirrel,
  Sun,
  Turtle,
  type LucideIcon,
} from 'lucide-react';
import { LEADERBOARD_AVATAR_VARIANTS } from '@zybrilka/shared';
import styles from './GeneratedAvatar.module.css';

/** One picture per variant — friendly symbols, never a face or a photo.
 * Exactly LEADERBOARD_AVATAR_VARIANTS of them (checked in a test). */
export const AVATAR_GLYPHS: readonly LucideIcon[] = [
  Cat,
  Dog,
  Bird,
  Fish,
  Rabbit,
  Squirrel,
  Turtle,
  Snail,
  Panda,
  PawPrint,
  Feather,
  Shell,
  Leaf,
  Sprout,
  Mountain,
  Sun,
  Moon,
  Cloud,
  Snowflake,
  Atom,
  Orbit,
  Rocket,
  Gem,
  Origami,
];

export interface GeneratedAvatarProps {
  /** 0–359, from the server (a hash — stable, reveals nothing). */
  hue: number;
  /** 0 … LEADERBOARD_AVATAR_VARIANTS−1, from the server. */
  variant: number;
  size?: number;
}

/**
 * A participant's avatar in the rating when no photo may be shown (other
 * users' photos are private): a picture and a two-tone gradient chosen by
 * the server from a hash of the account, so the same person always looks
 * the same and different people look different. Decorative — the name is
 * written next to it.
 */
export function GeneratedAvatar({ hue, variant, size = 40 }: GeneratedAvatarProps) {
  // An older API (mid-deploy) may send no variant: fall back to the hue.
  const raw = Number.isInteger(variant) ? variant : Math.floor((Number(hue) || 0) / 15);
  const index =
    ((raw % LEADERBOARD_AVATAR_VARIANTS) + LEADERBOARD_AVATAR_VARIANTS) %
    LEADERBOARD_AVATAR_VARIANTS;
  const Glyph = AVATAR_GLYPHS[index]!;
  // The second colour turns with the picture, so equal hues still differ.
  const hue2 = (hue + 40 + index * 7) % 360;
  return (
    <span
      className={styles.avatar}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, hsl(${hue} 70% 58%), hsl(${hue2} 70% 42%))`,
      }}
      aria-hidden="true"
      data-avatar-variant={index}
    >
      <Glyph size={Math.round(size * 0.52)} strokeWidth={2} />
    </span>
  );
}
