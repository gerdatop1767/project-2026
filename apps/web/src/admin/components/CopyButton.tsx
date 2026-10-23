import { useRef, useState } from 'react';
import s from '../admin.module.css';

/**
 * Copies `text` to the clipboard: the async Clipboard API first, then the
 * old `execCommand('copy')` on a hidden textarea (older iOS Safari, http
 * on a LAN address, embedded WebViews). Returns false only when both fail.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or not a secure context — try the fallback.
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '0';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * A copy button that says what happened. When the browser allows no
 * copying at all, the text appears in a selected read-only field to copy
 * by hand (long-press → «Скопировать» on a phone).
 */
export function CopyButton({
  text,
  label = 'Скопировать',
  primary = false,
}: {
  text: string;
  label?: string;
  primary?: boolean;
}) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  const manual = useRef<HTMLTextAreaElement>(null);
  return (
    <span className={s.copyGroup}>
      <button
        type="button"
        className={`${s.button} ${primary ? s.buttonPrimary : ''}`}
        onClick={async () => {
          const ok = await copyText(text);
          setState(ok ? 'done' : 'failed');
          if (!ok) requestAnimationFrame(() => manual.current?.select());
        }}
      >
        {label}
      </button>
      <span className={s.small} aria-live="polite">
        {state === 'done' && 'Скопировано'}
        {state === 'failed' && 'Браузер не дал скопировать — выделите текст ниже вручную.'}
      </span>
      {state === 'failed' && (
        <textarea
          ref={manual}
          className={`${s.textarea} ${s.mono}`}
          readOnly
          value={text}
          aria-label={`${label}: текст для ручного копирования`}
          rows={Math.min(12, text.split('\n').length + 1)}
        />
      )}
    </span>
  );
}
