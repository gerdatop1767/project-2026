import { Fragment, type ReactNode } from 'react';
import {
  OWNER_PLACEHOLDER,
  faq,
  privacyPolicy,
  termsOfUse,
  type LegalDocument,
} from '../../data/siteInfo.js';
import { resetConsent } from '../../lib/consent.js';
import { Icon } from '../../ui/Icon/Icon.js';
import { FaqList } from '../Landing/FaqList.js';
import { SiteFooter, SiteHeader, useRouteLink } from '../Landing/SiteChrome.js';
import { SupportDialogProvider, useSupportDialog } from '../Landing/SupportDialog.js';
import landing from '../Landing/Landing.module.css';
import styles from './InfoPage.module.css';

export type InfoPageKind = 'faq' | 'privacy' | 'terms';

/** Soft hyphens for the two words too long for a phone line at heading
 * size. Explicit, because `hyphens: auto` has no Russian dictionary in
 * Chromium (see `.text-card-title` in ui/global.css). */
const SOFT_HYPHENS: Record<string, string> = {
  конфиденциальности: 'конфиден\u00adциальности',
  Пользовательское: 'Пользова\u00adтельское',
};

function hyphenate(title: string): string {
  return title.replace(/[А-Яа-яЁё]+/g, (word) => SOFT_HYPHENS[word] ?? word);
}

/** Highlights owner-only placeholders ("[Заполнить: …]") inside a line of copy. */
function withPlaceholders(text: string): ReactNode {
  const parts = text.split(OWNER_PLACEHOLDER);
  const marks = text.match(OWNER_PLACEHOLDER) ?? [];
  return parts.map((part, index) => (
    <Fragment key={index}>
      {part}
      {marks[index] && <mark className={styles.placeholder}>{marks[index]}</mark>}
    </Fragment>
  ));
}

function hasPlaceholders(doc: LegalDocument): boolean {
  const text = JSON.stringify(doc);
  OWNER_PLACEHOLDER.lastIndex = 0;
  return OWNER_PLACEHOLDER.test(text);
}

function LegalBody({ doc }: { doc: LegalDocument }) {
  return (
    <>
      {hasPlaceholders(doc) && (
        <p className={styles.draft} role="note">
          Проект документа. Выделенные места заполняет владелец сервиса — до этого документ не
          является окончательным.
        </p>
      )}
      {doc.sections.map((section) => (
        <section key={section.heading} className={styles.section}>
          <h2 className={styles.h2}>{section.heading}</h2>
          {section.paragraphs?.map((paragraph) => (
            <p key={paragraph} className={styles.text}>
              {withPlaceholders(paragraph)}
            </p>
          ))}
          {section.list && (
            <ul className={styles.list}>
              {section.list.map((item) => (
                <li key={item}>{withPlaceholders(item)}</li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </>
  );
}

/**
 * Public info pages — FAQ, privacy policy, terms of use. Rendered outside
 * the app shells (App.tsx) with the landing's header and footer, readable
 * signed in or out, each at its own URL (/faq, /privacy, /terms).
 */
export function InfoPage({ kind }: { kind: InfoPageKind }) {
  return (
    <SupportDialogProvider>
      <InfoPageContent kind={kind} />
    </SupportDialogProvider>
  );
}

function InfoPageContent({ kind }: { kind: InfoPageKind }) {
  const link = useRouteLink();
  const support = useSupportDialog();
  const doc = kind === 'privacy' ? privacyPolicy : kind === 'terms' ? termsOfUse : null;

  return (
    <div className={landing.page}>
      <SiteHeader />
      <main className={styles.main}>
        <a {...link({ screen: 'home' })} className={styles.back}>
          <Icon name="chevronLeft" size={18} /> На главную
        </a>

        <h1 className={styles.title}>{doc ? hyphenate(doc.title) : 'Вопросы и ответы'}</h1>
        <p className={styles.summary}>
          {doc ? doc.summary : 'Коротко о том, как устроен тренажёр и как начать подготовку.'}
        </p>

        {doc ? (
          <>
            <LegalBody doc={doc} />
            {kind === 'privacy' && (
              <p className={styles.more}>
                <button type="button" className={styles.moreButton} onClick={resetConsent}>
                  Изменить настройки cookie
                </button>
              </p>
            )}
          </>
        ) : (
          <>
            <FaqList items={faq} />
            <p className={styles.more}>
              Не нашли ответ?{' '}
              <button
                type="button"
                className={styles.moreButton}
                onClick={(event) => support.open(event.currentTarget)}
              >
                Напишите в поддержку
              </button>
            </p>
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
