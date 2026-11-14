import { useNavigation, type TheorySection, type TheorySubject } from '../../lib/navigation.js';
import { Tabs } from '../../ui/Tabs/Tabs.js';

const subjectTabs = [
  { id: 'russian', label: 'Русский язык' },
  { id: 'math', label: 'Математика' },
] as const;

/** Switches the theory catalog between subjects, keeping the section. */
export function TheorySubjectTabs({
  section,
  subject,
}: {
  section: TheorySection;
  subject: TheorySubject;
}) {
  const { navigate } = useNavigation();
  return (
    <Tabs
      aria-label="Предмет"
      items={subjectTabs}
      activeId={subject}
      onChange={(id) =>
        navigate(
          id === 'math'
            ? { screen: 'theory', section, subject: 'math' }
            : { screen: 'theory', section },
          { replace: true },
        )
      }
    />
  );
}
