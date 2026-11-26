import { useEffect, useState } from 'react';
import type { MiniGameActiveResponse, MiniGameResume } from '@zybrilka/shared';
import { Button } from '../../ui/Button/Button.js';
import { Icon } from '../../ui/Icon/Icon.js';
import { Modal } from '../../ui/Modal/Modal.js';
import styles from './savedRound.module.css';

/** A guest's round lives on the server; its id is kept in this browser. */
const guestKey = (gameId: string) => `zybrilka.miniGames.round.${gameId}`;

function readGuestId(gameId: string): string | undefined {
  try {
    return window.localStorage.getItem(guestKey(gameId)) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeGuestId(gameId: string, id: string | null) {
  try {
    if (id) window.localStorage.setItem(guestKey(gameId), id);
    else window.localStorage.removeItem(guestKey(gameId));
  } catch {
    // Not kept in this browser — the round still plays.
  }
}

/** How far a saved round got: answered, total, points so far. */
export function resumeProgress<Q>(resume: MiniGameResume<Q>, pointsPerRight: number) {
  const right = resume.answered.filter((a) => a.firstCorrect).length;
  return {
    answered: resume.answered.length,
    total: resume.questions.length,
    right,
    points: right * pointsPerRight,
  };
}

/**
 * The round in progress of a game, from the SERVER: the signed-in player's
 * on any device (Telegram, another browser, after a reload), a guest's by
 * the id this browser kept. A round with every question answered is not
 * offered — only its summary was missing.
 */
export function useSavedRound<Q>({
  gameId,
  signedIn,
  fetchActive,
  abandon,
}: {
  gameId: string;
  signedIn: boolean;
  fetchActive: (sessionId?: string) => Promise<MiniGameActiveResponse<Q>>;
  abandon: (sessionId: string) => Promise<void>;
}) {
  const [resume, setResume] = useState<MiniGameResume<Q> | null>(null);
  const [version, setVersion] = useState(0);
  // A guest without a kept round id has nothing to ask the server about.
  const guestId = signedIn ? undefined : readGuestId(gameId);
  const askServer = signedIn || guestId !== undefined;

  useEffect(() => {
    if (!askServer) return;
    let live = true;
    fetchActive(guestId)
      .then((r) => {
        if (!live) return;
        const open =
          r.session && r.session.answered.length < r.session.questions.length ? r.session : null;
        setResume(open);
        if (!signedIn && !r.session) writeGuestId(gameId, null);
      })
      .catch(() => {
        if (live) setResume(null);
      });
    return () => {
      live = false;
    };
  }, [askServer, fetchActive, gameId, guestId, signedIn, version]);

  return {
    resume: askServer ? resume : null,
    refresh: () => setVersion((v) => v + 1),
    /** A new round started: a guest's id is remembered, the old offer gone. */
    started(sessionId: string | null) {
      if (!signedIn) writeGuestId(gameId, sessionId);
      setResume(null);
    },
    /** The round reached its summary. */
    finished() {
      if (!signedIn) writeGuestId(gameId, null);
      setResume(null);
    },
    /** «Новая игра» over the saved round: the server forgets it. */
    async giveUp() {
      if (resume) await abandon(resume.sessionId).catch(() => undefined);
      if (!signedIn) writeGuestId(gameId, null);
      setResume(null);
    },
  };
}

/** «Продолжить игру» on a game's start screen. */
export function ContinueCard({
  answered,
  total,
  points,
  onContinue,
  onNew,
}: {
  answered: number;
  total: number;
  points: number;
  onContinue: () => void;
  onNew: () => void;
}) {
  const percent = total > 0 ? Math.round((answered / total) * 100) : 0;
  return (
    <section className={styles.card} aria-label="Незаконченная игра">
      <div className={styles.head}>
        <span className={styles.icon} aria-hidden="true">
          <Icon name="play" size={20} />
        </span>
        <div>
          <p className={styles.title}>Незаконченная игра</p>
          <p className={styles.meta}>
            Отвечено {answered} из {total} · {points} очк.
          </p>
        </div>
      </div>
      <span className={styles.track} aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </span>
      <div className={styles.actions}>
        <Button onClick={onContinue}>
          <Icon name="play" size={18} /> Продолжить игру
        </Button>
        <Button variant="secondary" onClick={onNew}>
          Новая игра
        </Button>
      </div>
    </section>
  );
}

/** Starting a game while one is unfinished: continue it or start anew. */
export function NewGameChoice({
  open,
  answered,
  total,
  onContinue,
  onNew,
  onClose,
}: {
  open: boolean;
  answered: number;
  total: number;
  onContinue: () => void;
  onNew: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Есть незаконченная игра"
      subtitle={`Отвечено ${answered} из ${total}`}
      icon="play"
    >
      <div className={styles.choice}>
        <p className={styles.meta}>
          Продолжить её с того же места или начать новую? Незаконченная игра в новой не сохранится.
        </p>
        <Button fullWidth onClick={onContinue}>
          Продолжить предыдущую
        </Button>
        <Button fullWidth variant="secondary" onClick={onNew}>
          Начать новую
        </Button>
      </div>
    </Modal>
  );
}
