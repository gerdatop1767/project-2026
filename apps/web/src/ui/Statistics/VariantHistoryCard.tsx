import type { VariantProgressItem } from '@zybrilka/shared';
import { formatDateShort } from '../../lib/formatDate.js';
import { errorSignatureLabel, formatDurationLong } from '../../lib/statisticsDetailFormat.js';
import { useNavigation } from '../../lib/navigation.js';
import { Card } from '../Card/Card.js';
import { Icon } from '../Icon/Icon.js';
import styles from './VariantHistoryCard.module.css';

export interface VariantHistoryCardProps {
  item: VariantProgressItem;
}

/**
 * Statistics 2.0 — "Статистика вариантов": one real variant session,
 * completed or still in progress (an abandoned one shows its real
 * partial X/Y rather than being hidden or faked as finished — see
 * `GET /progress/variants`'s doc comment). Shared by Desktop and
 * Mobile — same component, same data, no second visual style.
 */
export function VariantHistoryCard({ item }: VariantHistoryCardProps) {
  const { navigate } = useNavigation();
  return (
    <Card className={styles.card} interactive>
      <div className={styles.header}>
        {/* The whole card opens THIS attempt's own result (the button's
            hit area is stretched over the card). */}
        <button
          type="button"
          className={styles.open}
          aria-label={`Вариант ${item.variantNumber}, попытка от ${formatDateShort(item.startedAt)} — подробная статистика`}
          onClick={() => navigate({ screen: 'variantAttempt', sessionId: item.sessionId })}
        >
          <span className="text-h3">Вариант {item.variantNumber}</span>
        </button>
        <span className="text-body-sm text-secondary">{formatDateShort(item.startedAt)}</span>
      </div>

      <p className={styles.fraction}>
        {item.solvedCount} / {item.plannedCount} заданий
        {item.status === 'active' && (
          <span className="text-body-sm text-secondary"> · в процессе</span>
        )}
      </p>

      <div className={styles.statsRow}>
        <span className="text-body-sm">{item.correctCount} правильных</span>
        <span className="text-body-sm">
          {item.accuracyPercent !== null ? `${item.accuracyPercent}%` : '—'}
        </span>
      </div>

      {item.totalTimeMs !== null && (
        <p className="text-body-sm text-secondary">Время: {formatDurationLong(item.totalTimeMs)}</p>
      )}

      {item.keyErrors.length > 0 && (
        <div className={styles.errors}>
          <p className="text-body-sm" style={{ fontWeight: 600 }}>
            Ключевые ошибки:
          </p>
          <ul className={styles.errorList}>
            {item.keyErrors.map((e) => (
              <li key={e.signature} className="text-body-sm text-secondary">
                {errorSignatureLabel(e.signature)} — {e.count}
              </li>
            ))}
          </ul>
        </div>
      )}
      <span className={styles.more} aria-hidden="true">
        Подробнее <Icon name="chevronRight" size={14} />
      </span>
    </Card>
  );
}
