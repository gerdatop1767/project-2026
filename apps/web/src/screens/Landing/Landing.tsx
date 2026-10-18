import { useNavigation } from '../../lib/navigation.js';
import { faq } from '../../data/siteInfo.js';
import { Icon } from '../../ui/Icon/Icon.js';
import { subjectIconSrc } from '../../ui/SubjectIcon/subjectIcons.js';
import { Reveal } from './Reveal.js';
import { SiteFooter, SiteHeader } from './SiteChrome.js';
import { FaqList } from './FaqList.js';
import { LandingIcon } from './LandingIcons.js';
import styles from './Landing.module.css';

/** Only the subjects that have published tasks today (packages/db imports). */
const subjects = [
  { id: 'math', name: 'Профильная математика', caption: 'Все 19 номеров экзамена' },
  { id: 'russian', name: 'Русский язык', caption: 'Тестовая часть и сочинение' },
] as const;

/** Existing trainer features only — each one is a real screen in the app. */
const features = [
  {
    icon: 'numbers',
    title: 'Задания по номерам и темам',
    text: 'Выбираешь номер ЕГЭ или тему и решаешь, сколько нужно.',
  },
  {
    icon: 'variant',
    title: 'Полные варианты',
    text: 'Решаешь вариант целиком, как на экзамене, и видишь итог.',
  },
  {
    icon: 'check',
    title: 'Проверка и разбор',
    text: 'Сразу после ответа — правильный ответ и решение по шагам.',
  },
  {
    icon: 'mistakes',
    title: 'Мои ошибки',
    text: 'Неверные ответы собираются в отдельную тренировку.',
  },
  {
    icon: 'stats',
    title: 'Статистика',
    text: 'Точность по номерам и темам показывает, что подтянуть.',
  },
  {
    icon: 'scratch',
    title: 'Черновик и калькулятор',
    text: 'Пиши пальцем или стилусом прямо рядом с задачей.',
  },
] as const;

const steps = [
  { title: 'Выбери предмет', text: 'Математику или русский язык — и номер, тему или вариант.' },
  { title: 'Решай и проверяй', text: 'Ответ проверяется сразу, а разбор показывает решение.' },
  { title: 'Закрывай пробелы', text: 'Возвращайся к ошибкам, пока статистика не выровняется.' },
] as const;

const sources = [
  {
    icon: 'bookMath',
    subject: 'Профильная математика',
    title: 'Ященко. ЕГЭ 2026. Типовые экзаменационные варианты',
  },
  {
    icon: 'bookRussian',
    subject: 'Русский язык',
    title: 'Дощинский. ЕГЭ 2027. Типовые экзаменационные варианты',
  },
] as const;

/**
 * Public landing — the signed-out face of `/` (see App.tsx). One
 * responsive composition for every width.
 *
 * Deliberately restrained: one visual accent (the original project mascot),
 * a large Unbounded headline (the same face the trainer uses for subject
 * names), short copy and a single CTA per screen. Content rule: only what
 * the trainer really has — two subjects with published tasks, their real
 * source collections, real features. Every CTA leads to the auth screen.
 */
export function Landing() {
  const { navigate } = useNavigation();
  const start = () => navigate({ screen: 'login' });

  return (
    <div className={styles.page}>
      <SiteHeader sectionLinks />

      <main>
        <section className={styles.hero} aria-labelledby="landing-title">
          <div className={styles.heroCopy}>
            <p className={styles.badge} style={{ ['--i' as string]: 0 }}>
              Бесплатно · Без подписок
            </p>
            <h1 id="landing-title" className={styles.title} style={{ ['--i' as string]: 1 }}>
              Подготовка к&nbsp;ЕГЭ, которая <span className={styles.accent}>работает</span>
            </h1>
            <p className={styles.lead} style={{ ['--i' as string]: 2 }}>
              Решай задания из типовых вариантов, сразу смотри разбор и возвращайся к своим ошибкам.
              Профильная математика и русский язык.
            </p>
            <div className={styles.heroAction} style={{ ['--i' as string]: 3 }}>
              <button type="button" className={styles.primary} onClick={start}>
                Начать бесплатно
                <Icon name="arrowRight" size={20} className={styles.primaryArrow} />
              </button>
            </div>
          </div>

          <div className={styles.heroArt} aria-hidden="true">
            <span className={styles.halo} />
            <span className={styles.ring} />
            <span className={styles.floor} />
            <img
              src="/branding/v2/landing-mascot.webp"
              alt=""
              width={1224}
              height={1024}
              className={styles.mascot}
              fetchPriority="high"
              decoding="async"
            />
          </div>
        </section>

        <Reveal
          as="section"
          id="subjects"
          className={styles.section}
          aria-labelledby="subjects-title"
        >
          <div className={styles.sectionHead}>
            <h2 id="subjects-title" className={styles.h2}>
              Предметы
            </h2>
            <p className={styles.sectionLead}>
              Сейчас в тренажёре два предмета. Новые появятся, когда их задания будут проверены.
            </p>
          </div>
          <ul className={styles.subjects}>
            {subjects.map((subject) => (
              <li key={subject.id}>
                <button
                  type="button"
                  className={styles.subject}
                  onClick={start}
                  style={{ ['--tint' as string]: `var(--color-subject-${subject.id})` }}
                >
                  <img
                    src={subjectIconSrc(subject.id)}
                    alt=""
                    width={512}
                    height={512}
                    loading="lazy"
                    decoding="async"
                    className={styles.subjectIcon}
                  />
                  <span className={styles.subjectText}>
                    <span className={`text-card-title ${styles.subjectName}`}>{subject.name}</span>
                    <span className={styles.subjectCaption}>{subject.caption}</span>
                  </span>
                  <Icon name="arrowRight" size={20} className={styles.subjectArrow} />
                </button>
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal
          as="section"
          id="features"
          className={styles.section}
          aria-labelledby="features-title"
        >
          <div className={styles.sectionHead}>
            <h2 id="features-title" className={styles.h2}>
              Всё для подготовки — <span className={styles.accent}>в одном месте</span>
            </h2>
          </div>
          <ul className={styles.features}>
            {features.map((feature, index) => (
              <Reveal
                as="li"
                key={feature.title}
                step={index % 3}
                className={styles.feature}
                data-icon-host
              >
                <LandingIcon name={feature.icon} />
                <div className={styles.featureBody}>
                  <h3 className={styles.h3}>{feature.title}</h3>
                  <p className={styles.featureText}>{feature.text}</p>
                </div>
              </Reveal>
            ))}
          </ul>
        </Reveal>

        <Reveal as="section" className={styles.section} aria-labelledby="steps-title">
          <div className={styles.sectionHead}>
            <h2 id="steps-title" className={styles.h2}>
              Как это работает
            </h2>
          </div>
          <ol className={styles.steps}>
            {steps.map((step, index) => (
              <li key={step.title} className={styles.step}>
                <span className={styles.stepNumber} aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <h3 className={styles.h3}>{step.title}</h3>
                <p className={styles.featureText}>{step.text}</p>
              </li>
            ))}
          </ol>
        </Reveal>

        <Reveal
          as="section"
          className={`${styles.section} ${styles.split}`}
          aria-labelledby="sources-title"
        >
          <div className={styles.sectionHead}>
            <h2 id="sources-title" className={styles.h2}>
              Источники заданий
            </h2>
            <p className={styles.sectionLead}>
              Задания взяты из сборников типовых экзаменационных вариантов. Для каждого задания в
              базе сохранены сборник и номер варианта.
            </p>
          </div>
          <ul className={styles.sources}>
            {sources.map((source, index) => (
              <Reveal
                as="li"
                key={source.subject}
                step={index}
                className={styles.source}
                data-icon-host
              >
                <LandingIcon name={source.icon} />
                <span className={styles.sourceBody}>
                  <span className={styles.sourceSubject}>{source.subject}</span>
                  <span className={styles.sourceTitle}>{source.title}</span>
                </span>
              </Reveal>
            ))}
          </ul>
        </Reveal>

        <Reveal
          as="section"
          id="faq"
          className={`${styles.section} ${styles.split}`}
          aria-labelledby="faq-title"
        >
          <div className={styles.sectionHead}>
            <h2 id="faq-title" className={styles.h2}>
              Вопросы и ответы
            </h2>
          </div>
          <FaqList items={faq} />
        </Reveal>

        <Reveal as="section" className={styles.section} aria-labelledby="cta-title">
          <div className={styles.cta}>
            <h2 id="cta-title" className={styles.ctaTitle}>
              Начни готовиться <span className={styles.accent}>сегодня</span>
            </h2>
            <p className={styles.sectionLead}>
              Бесплатно и без подписок. Нужен только вход — через VK ID или по почте.
            </p>
            <button type="button" className={styles.primary} onClick={start}>
              Начать бесплатно
              <Icon name="arrowRight" size={20} className={styles.primaryArrow} />
            </button>
          </div>
        </Reveal>
      </main>

      <SiteFooter />
    </div>
  );
}
