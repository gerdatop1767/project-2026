import type { QuizItem } from './quizGames.js';

/**
 * Computed «Вычисления» questions (ЕГЭ задание 7 types): the expression is
 * built from parameters and its value is computed exactly here, never typed
 * in by hand. Each family is a standard identity:
 *   - log_a(p^k) + log_a(q^k) = k, when a = p·q;
 *   - log_a(a^k·m) − log_a(m) = k;
 *   - a^m · a^n : a^k = a^(m+n−k);
 *   - √(c·s²) · √(c·t²) = c·s·t;
 *   - log_(a^p)(a^q) = q/p.
 * A test re-evaluates every question numerically (Math.log, Math.pow,
 * Math.sqrt) and compares with the stored answer.
 */

export interface MathDrill {
  readonly key: string;
  /** The expression in LaTeX (without $). */
  readonly tex: string;
  /** Its exact value. */
  readonly value: number;
  /** A plain JS expression with the same value, for the test's check. */
  readonly check: string;
  /** The steps, LaTeX in $…$. */
  readonly explanation: string;
}

/** «1.5» → «1,5» as the answer is written in Russian. */
const ru = (n: number) => String(n).replace('.', ',');
const texNum = (n: number) => String(n).replace('.', '{,}');

function logSums(): MathDrill[] {
  const out: MathDrill[] = [];
  const bases: [number, number][] = [
    [2, 3],
    [2, 5],
    [2, 7],
    [3, 5],
    [3, 7],
  ];
  for (const [p, q] of bases) {
    const a = p * q;
    for (const k of [2, 3]) {
      const x = p ** k;
      const y = q ** k;
      out.push({
        key: `logsum:${a}:${k}`,
        tex: `\\log_{${a}}${x}+\\log_{${a}}${y}`,
        value: k,
        check: `Math.log(${x})/Math.log(${a})+Math.log(${y})/Math.log(${a})`,
        explanation: `Сумма логарифмов с одним основанием — логарифм произведения: $\\log_{${a}}${x}+\\log_{${a}}${y}=\\log_{${a}}(${x}\\cdot${y})=\\log_{${a}}${x * y}$. Так как $${a}^{${k}}=${x * y}$, ответ: $${k}$.`,
      });
    }
  }
  return out;
}

function logDifferences(): MathDrill[] {
  const out: MathDrill[] = [];
  for (const a of [2, 3, 5]) {
    for (const k of [1, 2, 3]) {
      for (const m of [3, 5, 7, 11].filter((m) => m !== a)) {
        const x = a ** k * m;
        if (x > 1000) continue;
        out.push({
          key: `logdiff:${a}:${k}:${m}`,
          tex: `\\log_{${a}}${x}-\\log_{${a}}${m}`,
          value: k,
          check: `Math.log(${x})/Math.log(${a})-Math.log(${m})/Math.log(${a})`,
          explanation: `Разность логарифмов с одним основанием — логарифм частного: $\\log_{${a}}${x}-\\log_{${a}}${m}=\\log_{${a}}\\dfrac{${x}}{${m}}=\\log_{${a}}${a ** k}=${k}$.`,
        });
      }
    }
  }
  return out;
}

function powerProducts(): MathDrill[] {
  const out: MathDrill[] = [];
  // Exponents in tenths, so every sum is exact in integers.
  for (const a of [2, 3, 5, 7]) {
    for (const r of [1, 2]) {
      for (const m10 of [13, 26, 34]) {
        for (const k of [3, 4]) {
          const n10 = (k + r) * 10 - m10;
          if (n10 <= 0 || n10 % 10 === 0) continue;
          const m = m10 / 10;
          const n = n10 / 10;
          const value = a ** r;
          out.push({
            key: `pow:${a}:${r}:${m10}:${k}`,
            tex: `\\dfrac{${a}^{${texNum(m)}}\\cdot ${a}^{${texNum(n)}}}{${a}^{${k}}}`,
            value,
            check: `Math.pow(${a},${m})*Math.pow(${a},${n})/Math.pow(${a},${k})`,
            explanation: `При умножении степеней с одним основанием показатели складываются, при делении — вычитаются: $${texNum(m)}+${texNum(n)}-${k}=${r}$, значит выражение равно $${a}^{${r}}=${value}$.`,
          });
        }
      }
    }
  }
  return out;
}

function rootProducts(): MathDrill[] {
  const out: MathDrill[] = [];
  for (const c of [2, 3, 5, 6, 7]) {
    for (const [s, t] of [
      [1, 2],
      [1, 3],
      [2, 3],
      [2, 5],
    ] as const) {
      const x = c * s * s;
      const y = c * t * t;
      const value = c * s * t;
      out.push({
        key: `root:${c}:${s}:${t}`,
        tex: `\\sqrt{${x}}\\cdot\\sqrt{${y}}`,
        value,
        check: `Math.sqrt(${x})*Math.sqrt(${y})`,
        explanation: `Произведение корней — корень из произведения: $\\sqrt{${x}}\\cdot\\sqrt{${y}}=\\sqrt{${x * y}}=${value}$, так как $${value}^2=${x * y}$.`,
      });
    }
  }
  return out;
}

function logOfPowers(): MathDrill[] {
  const out: MathDrill[] = [];
  for (const a of [2, 3, 5]) {
    for (const p of [2, 4]) {
      for (let q = 1; q <= 7; q++) {
        if (q % p === 0) continue;
        const base = a ** p;
        const arg = a ** q;
        if (base > 1000 || arg > 100000) continue;
        const value = q / p;
        out.push({
          key: `logpow:${a}:${p}:${q}`,
          tex: `\\log_{${base}}${arg}`,
          value,
          check: `Math.log(${arg})/Math.log(${base})`,
          explanation: `$${base}=${a}^{${p}}$, $${arg}=${a}^{${q}}$, поэтому $\\log_{${base}}${arg}=\\log_{${a}^{${p}}}${a}^{${q}}=\\dfrac{${q}}{${p}}=${texNum(value)}$.`,
        });
      }
    }
  }
  return out;
}

export function mathExpressionDrills(): MathDrill[] {
  return [
    ...logSums(),
    ...logDifferences(),
    ...powerProducts(),
    ...rootProducts(),
    ...logOfPowers(),
  ];
}

/** The drills as «Вычисления» questions; explanations are marked automatic. */
export function expressionDrillItems(): QuizItem[] {
  return mathExpressionDrills().map((d) => ({
    key: `drill:${d.key}`,
    taskId: `drill:${d.key}`,
    kind: 'input' as const,
    text: `Найдите значение выражения $${d.tex}$.`,
    correct: String(d.value),
    accepted: [],
    display: ru(d.value),
    explanation: d.explanation,
    explanationSource: 'auto' as const,
  }));
}
