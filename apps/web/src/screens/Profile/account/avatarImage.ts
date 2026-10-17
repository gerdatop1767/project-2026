import { AVATAR_MIN_SIDE } from '@zybrilka/shared';

/** What the picker offers and the server accepts. */
export const AVATAR_ACCEPT = 'image/jpeg,image/png,image/webp';
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
/** Source files above this are refused before decoding (phone photos are ~3–8 MB). */
export const AVATAR_SOURCE_MAX_BYTES = 15 * 1024 * 1024;
/** The picture is resized so its longer edge is at most this — never enlarged. */
export const AVATAR_OUTPUT_SIDE = 512;

export type AvatarFileProblem = 'unsupported_type' | 'too_big' | 'unreadable' | 'too_small';

export const avatarProblemText: Record<AvatarFileProblem, string> = {
  unsupported_type: 'Подойдёт фото в формате JPG, PNG или WebP.',
  too_big: 'Файл слишком большой. Выберите фото до 15 МБ.',
  unreadable: 'Не удалось открыть это изображение. Попробуйте другое фото.',
  too_small: `Фото слишком маленькое: нужно не меньше ${AVATAR_MIN_SIDE}×${AVATAR_MIN_SIDE} пикселей.`,
};

export class AvatarFileError extends Error {
  constructor(readonly problem: AvatarFileProblem) {
    super(problem);
  }
}

/** Cheap checks before any decoding. The server repeats and enforces all of
 * them on the real bytes; this only saves a pointless upload. */
export function checkAvatarFile(file: File): AvatarFileProblem | null {
  if (!ALLOWED_TYPES.has(file.type)) return 'unsupported_type';
  if (file.size > AVATAR_SOURCE_MAX_BYTES) return 'too_big';
  return null;
}

function loadImage(file: File): Promise<{ image: HTMLImageElement; release: () => void }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve({ image, release: () => URL.revokeObjectURL(url) });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new AvatarFileError('unreadable'));
    };
    image.src = url;
  });
}

/**
 * Center-crops to a square and re-encodes as JPEG, at most 512×512. A small
 * source stays at its own size (no artificial upscaling). Re-encoding also
 * drops EXIF/location metadata. Browser-only (canvas).
 */
export async function prepareAvatar(file: File): Promise<Blob> {
  const problem = checkAvatarFile(file);
  if (problem) throw new AvatarFileError(problem);

  const { image, release } = await loadImage(file);
  try {
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    if (side < AVATAR_MIN_SIDE) throw new AvatarFileError('too_small');
    const output = Math.min(side, AVATAR_OUTPUT_SIDE);

    const canvas = document.createElement('canvas');
    canvas.width = output;
    canvas.height = output;
    const context = canvas.getContext('2d');
    if (!context) throw new AvatarFileError('unreadable');
    context.fillStyle = '#ffffff'; // JPEG has no transparency
    context.fillRect(0, 0, output, output);
    context.drawImage(
      image,
      (image.naturalWidth - side) / 2,
      (image.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      output,
      output,
    );
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.9),
    );
    if (!blob) throw new AvatarFileError('unreadable');
    return blob;
  } finally {
    release();
  }
}
