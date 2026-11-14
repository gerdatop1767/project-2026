import { useEffect, useState } from 'react';
import { EXAM_TOPICS } from '@zybrilka/shared';
import { examNumbersLabel, loadMathTheory, mathMaterialFor } from '../../data/theory/mathTheory.js';
import { Icon } from '../Icon/Icon.js';
import { SkeletonParagraph } from '../Skeleton/Skeleton.js';
import { TheoryMarkdown } from './TheoryMarkdown.js';
import mathStyles from './MathTopicTheory.module.css';

const topicTitle = (key: string) => EXAM_TOPICS.find((t) => t.key === key)?.title ?? key;

/**
 * The theory of one math topic (catalog reader and the task's «Правило»):
 * where it is checked in each exam edition, a note about the edition when
 * there is one, the text and its sources. A topic without a
 * written material says so instead of showing an empty page.
 */
export function MathTopicTheory({
  topicKey,
  note,
  partOf,
  showTitle,
}: {
  topicKey: string;
  note?: string;
  partOf: boolean;
  showTitle: boolean;
}) {
  const material = mathMaterialFor(topicKey);
  const [text, setText] = useState<{ file: string; source: string | null } | null>(null);
  useEffect(() => {
    if (!material) return;
    let live = true;
    loadMathTheory(material.file).then(
      (source) => live && setText({ file: material.file, source }),
      () => live && setText({ file: material.file, source: null }),
    );
    return () => {
      live = false;
    };
  }, [material]);

  return (
    <section className={mathStyles.topic} aria-label={topicTitle(topicKey)}>
      {showTitle && (
        <h3 className="text-h3">
          {topicTitle(topicKey)}
          {partOf && <span className={mathStyles.partOf}> — входит в задание частично</span>}
        </h3>
      )}
      <p className={mathStyles.numbers}>
        <Icon name="topic" size={14} /> {examNumbersLabel(topicKey)}
      </p>
      {note && <p className={mathStyles.caution}>{note}</p>}
      {!material ? (
        <p className="text-body-sm text-secondary">
          Теория по этой теме готовится. Она появится здесь и сразу будет доступна во всех
          редакциях.
        </p>
      ) : !text || text.file !== material.file ? (
        <SkeletonParagraph lines={6} />
      ) : text.source === null ? (
        <p className="text-body-sm text-secondary" role="alert">
          Не удалось загрузить теорию. Проверь подключение и открой номер ещё раз.
        </p>
      ) : (
        <>
          {material.caution && <p className={mathStyles.caution}>{material.caution}</p>}
          <TheoryMarkdown source={text.source} />
          <details className={mathStyles.sources}>
            <summary>Источники</summary>
            <ul>
              {material.sources.map((s) => (
                <li key={s.title}>
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noopener noreferrer">
                      {s.title}
                    </a>
                  ) : (
                    s.title
                  )}
                  <span className="text-secondary"> — {s.confirms}</span>
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </section>
  );
}
