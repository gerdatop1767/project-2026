/**
 * Fine-grained, deterministic classification of a task by its own text
 * (docs/learning/SIMILAR-TASKS.md). The catalog's metadata stops at the EGE
 * topic (`task_skills`) and a coarse importer subtopic (`topics.slug`, named
 * differently by different importers); «угол между прямой и плоскостью» vs
 * «расстояние до плоскости», or «пишется одна Н» vs «пишется НН», exist only
 * in the condition. These rules read them out — no AI, no network, same
 * input → same output, so the result can be cached per task version.
 *
 * Two kinds of features:
 * - `primary` — WHAT the task asks / WHICH rule it checks (the subtype);
 * - `secondary` — the context it works in (the solid, the figure, the
 *   function family, the kind of text).
 * A rule is added here only when it is visible in the real imported
 * conditions; a task no rule matches simply has no subtype — it is never
 * given a guessed one.
 */
export interface TaskFeatures {
  /** Sorted primary features joined with «+», or null when none matched. */
  readonly subtype: string | null;
  readonly primary: readonly string[];
  readonly secondary: readonly string[];
}

interface Rule {
  readonly feature: string;
  readonly kind: 'primary' | 'secondary';
  readonly re: RegExp;
}

const p = (feature: string, re: RegExp): Rule => ({ feature, kind: 'primary', re });
const s = (feature: string, re: RegExp): Rule => ({ feature, kind: 'secondary', re });

/** Applied to lowercased text with «ё» → «е» and markdown emphasis removed. */
const MATH_RULES: readonly Rule[] = [
  // Stereometry: what is asked.
  p('angle-line-plane', /угол между прямой[^.;]{0,80}?и плоскост/),
  p('angle-planes', /угол между плоскостями|двугранн/),
  p('angle-lines', /угол между (?:скрещивающимися )?прямыми/),
  p('dist-point-plane', /расстояние от (?:точки|вершины)[^.;]{0,80}?до плоскост/),
  p('dist-lines', /расстояние между (?:скрещивающимися )?прямыми/),
  p('dist-point-line', /расстояние от (?:точки|вершины)[^.;]{0,80}?до прямой/),
  p('section-area', /площадь сечения/),
  p('surface-area', /площадь (?:полной |боковой )?поверхност/),
  p('volume', /объем/),
  // Derivative / functions.
  p('tangent', /касательн/),
  p('derivative-graph', /график[^.]{0,40}производн|производн[^.]{0,60}график/),
  p('point-motion', /материальная точка/),
  p('extremum-point', /точк[уи] (?:максимума|минимума|экстремум)/),
  p('max-min-value', /наибольшее значение функции|наименьшее значение функции/),
  // Probability.
  p('prob-dice', /игральн[^.]{0,20}кост|кубик/),
  p('prob-coin', /монет/),
  p('prob-expectation', /математическ[^.]{0,10}ожидан/),
  // Word problems / finance.
  p('finance-credit', /кредит/),
  p('finance-deposit', /вклад/),
  p('motion', /скорост|км\/ч/),
  p('work', /производительн|насос|бригад|выполн[^.]{0,20}работ/),
  p('mixture', /раствор|сплав|смес|концентрац/),
  // Parameters / number theory.
  p('parameter', /при каждом из которых|параметр/),
  p('digits', /цифр/),
  p('divisibility', /делится на|делител|кратн/),
  // Planimetry: what is asked.
  p('find-angle', /найдите[^.]{0,40}угол|ответ дайте в градусах/),
  p('find-area', /найдите площадь/),
  p('find-trig', /найдите (?:синус|косинус|тангенс)/),
  p(
    'find-length',
    /найдите (?:длину|сторону|радиус|диаметр|высоту|медиану|биссектрису|диагональ|хорду|отрезок|периметр|бо́?льшую|меньшую)/,
  ),
  // Vectors.
  p('vector-dot', /скалярн/),
  p('vector-length', /длин[уа] вектора/),
  // Probability: the setting.
  p('prob-shooting', /стрел/),
  p('prob-defect', /неисправн|брак|бракован/),
  p('prob-order', /выступ|жреби|очередност|порядок выступлен/),
  // Reading a graph or a table.
  p('graph-read', /на рисунке изображен график|на графике изображен/),
  p('percent', /процент|%/),
  // Equations and inequalities: what kind.
  p('inequality', /неравенств/),
  p('equation', /уравнени/),
  s('root-selection', /принадлежащ|на отрезке|промежутк/),
  p('expression-value', /значение выражения/),
  s('proof', /докажите/),
  // Context: solids and figures.
  s('pyramid', /пирамид|тетраэдр/),
  s('prism', /призм/),
  s('box', /параллелепипед|(?<![а-я])куб(?:а|е|ом)?(?![а-я])/),
  s('cylinder', /цилиндр/),
  s('cone', /конус/),
  s('sphere', /шар|сфер/),
  s('triangle', /треугольник/),
  s('trapezoid', /трапеци/),
  s('parallelogram', /параллелограмм/),
  s('rhombus', /ромб/),
  s('circle', /окружност|вписан|описан/),
  // Context: function families.
  s('log', /\\log|\blog/),
  s('trig', /\\sin|\\cos|\\tg|\\ctg|\\mathrm\{tg\}|\\mathrm\{ctg\}|\\operatorname\{tg\}/),
  s('sqrt', /\\sqrt/),
  s('exp', /\d\^\{?[^}\s]*x|\^\{[^}]*x[^}]*\}/),
  s('abs', /\|[^|]+\|/),
  s('system', /систем/),
];

const RUSSIAN_RULES: readonly Rule[] = [
  // №1: which part of speech fills the gap, and which kind of it.
  p('fill-pronoun', /подберите[^.]{0,40}местоимени/),
  p('fill-preposition', /подберите[^.]{0,40}предлог/),
  p('fill-conjunction', /подберите[^.]{0,40}союз/),
  p('fill-particle', /подберите[^.]{0,40}частиц/),
  p('fill-adverb', /подберите[^.]{0,40}наречи/),
  s('demonstrative', /указательн/),
  s('derivative-preposition', /производн/),
  s('subordinating', /подчинительн/),
  s('coordinating', /сочинительн/),
  // №13 / №14: the asked spelling.
  p('write-together', /пишется слитно|пишутся слитно/),
  p('write-apart', /пишется раздельно|пишутся раздельно/),
  p('write-hyphen', /через дефис/),
  // №15: one Н or НН.
  p('one-n', /пишется (?:одна буква )?н(?![а-ян])/),
  p('double-n', /пишется нн/),
  // №16: how many commas.
  p('one-comma', /одну запятую/),
  p('two-commas', /две запятые/),
  // №21: which mark.
  p('mark-dash', /в которых тире/),
  p('mark-colon', /в которых двоеточие/),
  p('mark-comma', /в которых запят/),
  // №23 / №24: true or false statements, text types.
  p('statements-false', /не соответствуют содержанию|противоречат содержанию/),
  p('statements-true', /(?<!не )соответствуют содержанию/),
  s('narration', /повествовани/),
  s('description', /описани/),
  s('reasoning', /рассуждени/),
  // №25: which lexical unit to find.
  p('lex-phraseologism', /фразеологизм/),
  p('lex-synonym', /синоним/),
  p('lex-antonym', /антоним/),
  p('lex-meaning', /со значением/),
  // №26: kind of cohesion.
  s('cohesion-pronoun', /местоимени/),
  s('cohesion-lexical-repeat', /лексическ[^.]{0,20}повтор/),
  // №12: what the gaps are in.
  s('participle-suffix', /\.\.(?:щ|вш|нн|м(?:ый|ая|ое|ые))/),
  s('verb-ending', /\.\.(?:шь|шься|т|тся|те|м)[\s,)]/),
];

const RULES_BY_SUBJECT: Readonly<Record<string, readonly Rule[]>> = {
  math: MATH_RULES,
  russian: RUSSIAN_RULES,
};

export function normalizeTaskText(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\*\*|__/g, '')
    .replace(/\s+/g, ' ');
}

export function taskFeatures(input: {
  readonly subjectId: string;
  readonly conditionMd: string;
}): TaskFeatures {
  const rules = RULES_BY_SUBJECT[input.subjectId] ?? [];
  const text = normalizeTaskText(input.conditionMd);
  const primary = new Set<string>();
  const secondary = new Set<string>();
  for (const rule of rules) {
    if (!rule.re.test(text)) continue;
    (rule.kind === 'primary' ? primary : secondary).add(rule.feature);
  }
  // «угол между прямой и плоскостью» also says «плоскост…» and «прямой»:
  // the more specific distance/angle rules already caught it; a bare
  // «объем» in a stereometry part-2 text with an angle asked is context.
  if (
    primary.has('volume') &&
    [...primary].some((f) => f.startsWith('angle-') || f.startsWith('dist-'))
  ) {
    primary.delete('volume');
    secondary.add('volume');
  }
  const sortedPrimary = [...primary].sort();
  return {
    subtype: sortedPrimary.length > 0 ? sortedPrimary.join('+') : null,
    primary: sortedPrimary,
    secondary: [...secondary].sort(),
  };
}

/**
 * Importers name the same subtopic differently («trig-identities» /
 * «trigonometry-identities», «russian-nn-spelling» / «russian-n-nn-spelling»).
 * One canonical spelling per pair, for an equality test only.
 */
const SUBTOPIC_ALIASES: Readonly<Record<string, string>> = {
  'trigonometry-identities': 'trig-identities',
  'trigonometric-equations': 'trig-equations',
  'derivative-graph-analysis': 'derivative-graph',
  'russian-n-nn-spelling': 'russian-nn-spelling',
  'russian-grammatical-forms': 'russian-grammar-forms',
  'russian-together-separate-spelling': 'russian-separate-combined-spelling',
  'russian-not-with-words': 'russian-not-ni-spelling',
  'russian-punctuation-homogeneous': 'russian-comma-compound-sentence',
  'russian-punctuation-attributes': 'russian-comma-participial-phrase',
  'russian-punctuation-parenthetical': 'russian-comma-parenthetical',
  'russian-punctuation-complex-sentence': 'russian-comma-subordinate-clauses',
  'russian-particle-fill': 'russian-particles',
  'russian-prepositions-fill': 'russian-prepositions',
  'russian-pronoun-fill': 'russian-pronouns',
};

export function canonicalSubtopic(slug: string | null): string | null {
  if (!slug) return null;
  return SUBTOPIC_ALIASES[slug] ?? slug;
}
