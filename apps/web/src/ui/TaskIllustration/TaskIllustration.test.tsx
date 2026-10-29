import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  TaskExamIllustration,
  TaskSolutionIllustration,
  conditionRefersToFigure,
} from './TaskIllustration.js';

const V1 = ['ege-2026-variant-1'];

describe('TaskExamIllustration — our SVG reconstruction of a real original diagram (EGE Fidelity audit)', () => {
  it('renders the verified SVG inside "Условие" for a task whose source material has a diagram (e.g. task 11)', () => {
    render(<TaskExamIllustration subjectId="math" tags={V1} taskNumber={11} />);
    expect(screen.getByRole('img')).toBeInTheDocument();
  });

  it('never renders a raster image for Вариант 1 — only our own SVG, or nothing', () => {
    const { container } = render(
      <TaskExamIllustration subjectId="math" tags={V1} taskNumber={11} imageUrl="/x.png" />,
    );
    expect(container.querySelector('img')).not.toBeInTheDocument();
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('renders nothing for a task whose SVG is only a solving aid (no original diagram, e.g. task 14)', () => {
    const { container } = render(
      <TaskExamIllustration subjectId="math" tags={V1} taskNumber={14} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a task with no custom illustration at all', () => {
    const { container } = render(
      <TaskExamIllustration subjectId="math" tags={V1} taskNumber={6} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('TaskSolutionIllustration — our solving aid, never shown as the original condition (audit Block 5)', () => {
  it('renders a labelled custom illustration for a task with no real diagram (e.g. task 14)', () => {
    render(<TaskSolutionIllustration subjectId="math" tags={V1} taskNumber={14} />);
    expect(screen.getByText('Иллюстрация к решению')).toBeInTheDocument();
    expect(screen.getByRole('img')).toBeInTheDocument();
  });

  it('renders nothing for a task whose SVG already reconstructs a real original diagram (e.g. task 11)', () => {
    const { container } = render(
      <TaskSolutionIllustration subjectId="math" tags={V1} taskNumber={11} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a task with no custom illustration at all', () => {
    const { container } = render(
      <TaskSolutionIllustration subjectId="math" tags={V1} taskNumber={6} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('figures are bound to the task, not just to its number', () => {
  it("another variant with the same number never gets Вариант 1's figure or solving aid", () => {
    for (const tags of [['ege-2026-variant-3'], ['ege-2027-variant-1'], []]) {
      for (const n of [1, 3, 8, 11, 14, 17]) {
        const exam = render(<TaskExamIllustration subjectId="math" tags={tags} taskNumber={n} />);
        expect(exam.container).toBeEmptyDOMElement();
        exam.unmount();
        const aid = render(
          <TaskSolutionIllustration subjectId="math" tags={tags} taskNumber={n} />,
        );
        expect(aid.container).toBeEmptyDOMElement();
        aid.unmount();
      }
    }
  });

  it("shows the task's own source figure, unaltered, with an accessible name", () => {
    render(
      <TaskExamIllustration
        subjectId="math"
        tags={['ege-2027-variant-2']}
        taskNumber={9}
        imageUrl="/tasks/imports/ege-2027-variant-2/task-09-derivative-graph.png"
      />,
    );
    const img = screen.getByRole('img', { name: 'Рисунок к заданию 9' });
    expect(img).toHaveAttribute(
      'src',
      '/tasks/imports/ege-2027-variant-2/task-09-derivative-graph.png',
    );
  });
});

describe('a condition that refers to a figure we do not have', () => {
  it('shows a note instead of a figure — never Вариант 1’s', () => {
    render(
      <TaskExamIllustration
        subjectId="math"
        tags={['ege-2026-variant-7']}
        taskNumber={8}
        conditionMd="На рисунке изображён график функции $y=f(x)$."
      />,
    );
    expect(screen.getByRole('note')).toHaveTextContent('Рисунок к этому заданию ещё не добавлен');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('says nothing for a text-only condition, and nothing extra when the figure exists', () => {
    const plain = render(
      <TaskExamIllustration
        subjectId="math"
        tags={[]}
        taskNumber={5}
        conditionMd="Найдите корень."
      />,
    );
    expect(plain.container).toBeEmptyDOMElement();
    plain.unmount();
    render(
      <TaskExamIllustration
        subjectId="math"
        tags={['ege-2027-variant-1']}
        taskNumber={9}
        imageUrl="/x.png"
        conditionMd="На рисунке изображён график"
      />,
    );
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('only for math — «изображён» in another subject is ordinary wording', () => {
    const { container } = render(
      <TaskExamIllustration
        subjectId="russian"
        taskNumber={8}
        conditionMd="Кто изображён в отрывке?"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('recognises the usual wordings', () => {
    expect(conditionRefersToFigure('На координатной плоскости изображены векторы')).toBe(true);
    expect(conditionRefersToFigure('На рисунке изображён график')).toBe(true);
    expect(conditionRefersToFigure('Найдите значение выражения')).toBe(false);
  });
});

describe('ЕГЭ 2026: the 11 tasks without their own figure (figures audit)', () => {
  const MISSING: [number, number][] = [
    [3, 2],
    [4, 2],
    [6, 2],
    [9, 2],
    [10, 2],
    [7, 8],
    [8, 8],
    [7, 11],
    [8, 11],
    [9, 11],
    [10, 11],
  ];
  it.each(MISSING)(
    'В%i №%i: no Вариант 1 SVG, no foreign image — only the «missing figure» note',
    (v, n) => {
      const tags = [`ege-2026-variant-${v}`];
      const exam = render(
        <TaskExamIllustration
          subjectId="math"
          tags={tags}
          taskNumber={n}
          imageUrl={null}
          conditionMd="На рисунке изображён график"
        />,
      );
      expect(exam.container.querySelector('svg, img')).toBeNull();
      expect(screen.getByRole('note')).toHaveTextContent('Рисунок к этому заданию ещё не добавлен');
      exam.unmount();
      const aid = render(<TaskSolutionIllustration subjectId="math" tags={tags} taskNumber={n} />);
      expect(aid.container).toBeEmptyDOMElement();
      aid.unmount();
    },
  );
});
