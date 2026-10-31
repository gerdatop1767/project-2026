import { useEffect, useState } from 'react';
import {
  THEORY_EXAM_YEAR,
  loadTheoryMaterial,
  type TheoryMaterial,
  type TheoryMaterialKind,
  type TheoryTask,
} from '../../data/theory/russianTheory.js';
import { Tabs } from '../Tabs/Tabs.js';
import { Icon } from '../Icon/Icon.js';
import { Button } from '../Button/Button.js';
import { SkeletonParagraph } from '../Skeleton/Skeleton.js';
import { TheoryMarkdown } from './TheoryMarkdown.js';
import { TheoryDiagram } from './TheoryDiagram.js';
import styles from './TheoryTaskView.module.css';

type LoadState = { status: 'loading' } | { status: 'ready'; source: string } | { status: 'error' };

/** Loaded texts stay for the visit: switching back to a tab is instant. */
const cache = new Map<string, string>();

/** One material's text. The caller keys it by material id, so `id`
 * never changes for a mounted instance. */
function useMaterial(id: string): [LoadState, () => void] {
  const [state, setState] = useState<LoadState>(() => {
    const cached = cache.get(id);
    return cached !== undefined ? { status: 'ready', source: cached } : { status: 'loading' };
  });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (cache.has(id)) return;
    let live = true;
    loadTheoryMaterial(id).then(
      (source) => {
        cache.set(id, source);
        if (live) setState({ status: 'ready', source });
      },
      () => live && setState({ status: 'error' }),
    );
    return () => {
      live = false;
    };
  }, [id, attempt]);
  const retry = () => {
    setState({ status: 'loading' });
    setAttempt((n) => n + 1);
  };
  return [state, retry];
}

export function MaterialBody({ material }: { material: TheoryMaterial }) {
  const [state, retry] = useMaterial(material.id);
  return (
    <div className={styles.body}>
      {material.caution && (
        <p className={styles.caution}>
          <Icon name="warning" size={16} /> {material.caution}
        </p>
      )}
      {state.status === 'loading' && (
        <div aria-busy="true" aria-label="Материал загружается">
          <SkeletonParagraph lines={6} />
        </div>
      )}
      {state.status === 'error' && (
        <div className={styles.error} role="alert">
          <p>Не удалось загрузить материал.</p>
          <Button variant="secondary" onClick={retry}>
            Повторить
          </Button>
        </div>
      )}
      {state.status === 'ready' && (
        <TheoryMarkdown source={state.source} stress={material.id.startsWith('task-04')} />
      )}
    </div>
  );
}

const kindLabel: Record<TheoryMaterialKind, string> = {
  theory: 'Конспект',
  reference: 'Справочник',
  practice: 'Практика',
};

export interface TheoryTaskViewProps {
  task: TheoryTask;
  /** Which materials to offer (the catalog's «Теория» shows конспекты,
   * «Полезные материалы» — справочники и практику). All by default. */
  kinds?: readonly TheoryMaterialKind[];
  /** Keeps the chosen material across re-renders driven by the parent. */
  materialId?: string;
  onMaterialChange?: (id: string) => void;
}

/**
 * One EGE task's materials: tabs for конспект / справочник / практика,
 * the visual scheme (if the rule has one) and an honest note about what
 * these texts are. A task with nothing yet says so.
 */
export function TheoryTaskView({ task, kinds, materialId, onMaterialChange }: TheoryTaskViewProps) {
  const materials = task.materials.filter((m) => !kinds || kinds.includes(m.kind));
  const [localId, setLocalId] = useState(materials[0]?.id);
  const activeId = materials.some((m) => m.id === materialId) ? materialId : localId;
  const active = materials.find((m) => m.id === activeId) ?? materials[0];

  if (materials.length === 0) {
    return (
      <div className={styles.empty}>
        <p className="text-body" style={{ fontWeight: 700 }}>
          Материала к заданию №{task.taskNumber} пока нет
        </p>
        <p className="text-body-sm text-secondary">
          {task.materials.length > 0
            ? 'В этом разделе к нему ничего нет — загляни в соседний.'
            : 'Конспект к этому заданию ещё не подготовлен. Когда он появится, он будет здесь.'}
        </p>
      </div>
    );
  }

  const select = (id: string) => {
    setLocalId(id);
    onMaterialChange?.(id);
  };

  // Several materials of one kind (e.g. №20 has two конспекта) keep their own titles.
  const sameKind = (m: TheoryMaterial) => materials.filter((x) => x.kind === m.kind).length > 1;

  return (
    <div className={styles.view}>
      {materials.length > 1 && (
        <Tabs
          scrollable
          aria-label="Материалы к заданию"
          items={materials.map((m) => ({
            id: m.id,
            label: sameKind(m) ? m.title : kindLabel[m.kind],
          }))}
          activeId={active!.id}
          onChange={select}
        />
      )}
      {task.diagram && active!.kind === 'theory' && active === materials[0] && (
        <TheoryDiagram id={task.diagram} />
      )}
      <MaterialBody key={active!.id} material={active!} />
      <p className={styles.footnote}>
        Учебная выжимка, ориентир — ЕГЭ-{THEORY_EXAM_YEAR}. Не официальный документ ФИПИ: точные
        формулировки и списки сверяй с навигатором ФИПИ.
      </p>
    </div>
  );
}
