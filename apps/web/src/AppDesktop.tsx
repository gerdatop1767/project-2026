import { DesktopShell } from './ui/DesktopShell/DesktopShell.js';
import { WipPlaceholder } from './ui/WipPlaceholder/WipPlaceholder.js';
import { TaskDesktop } from './screens/Task/TaskDesktop.js';
import { ResultDesktop } from './screens/Result/ResultDesktop.js';
import { useNavigation } from './lib/navigation.js';
import { StatisticsDesktop } from './screens/Statistics/StatisticsDesktop.js';
import { MistakesDesktop } from './screens/Mistakes/MistakesDesktop.js';
import { AchievementsDesktop } from './screens/Achievements/AchievementsDesktop.js';
import { RatingDesktop } from './screens/Rating/RatingDesktop.js';
import { Level } from './screens/Level/Level.js';
import { LearningCenterDesktop } from './screens/LearningCenter/LearningCenterDesktop.js';
import { TheoryCatalog } from './screens/Theory/TheoryCatalog.js';
import { Notifications } from './screens/Notifications/Notifications.js';
import { SubjectCatalogDesktop } from './screens/SubjectCatalog/SubjectCatalogDesktop.js';
import { SubjectDesktop } from './screens/Subject/SubjectDesktop.js';
import { ProfileDesktop } from './screens/Profile/ProfileDesktop.js';
import { HelpDesktop } from './screens/Help/HelpDesktop.js';
import { FriendsDesktop } from './screens/Friends/FriendsDesktop.js';
import { FriendProfileDesktop } from './screens/Friends/FriendProfileDesktop.js';
import { Training } from './screens/Training/Training.js';
import { Onboarding } from './screens/Onboarding/Onboarding.js';
import { LearningSession } from './screens/LearningSession/LearningSession.js';
import { VariantAttempt } from './screens/VariantAttempt/VariantAttempt.js';

/** Screens whose approved desktop composition has no left sidebar. */
const noSidebarScreens = new Set(['task', 'result', 'onboarding', 'learningSession']);

/**
 * Desktop app tree (S1 Block 6, approved design) — its own composition,
 * not mobile scaled up. Screens not yet rebuilt render a plain
 * placeholder rather than the old design.
 */
export function AppDesktop() {
  const { tab, overlay } = useNavigation();

  if (overlay) {
    const sidebar = !noSidebarScreens.has(overlay.screen);
    const header = 'status';
    return (
      <DesktopShell header={header} sidebar={sidebar}>
        {overlay.screen === 'subjectCatalog' && <SubjectCatalogDesktop />}
        {overlay.screen === 'subject' && (
          <SubjectDesktop
            subjectId={overlay.subjectId}
            from={overlay.from}
            collectionSlug={overlay.collectionSlug}
            initialMode={overlay.initialMode}
            initialTaskNumber={overlay.initialTaskNumber}
          />
        )}
        {overlay.screen === 'task' && (
          <TaskDesktop
            key={overlay.taskId}
            subjectId={overlay.subjectId}
            taskNumber={overlay.taskNumber}
            taskId={overlay.taskId}
            collectionSlug={overlay.collectionSlug}
            variantId={overlay.variantId}
            customOrderedTasks={overlay.customOrderedTasks}
            returnTo={overlay.returnTo}
          />
        )}
        {overlay.screen === 'result' && (
          <ResultDesktop
            key={`${overlay.taskId}-${overlay.correct}`}
            subjectId={overlay.subjectId}
            taskNumber={overlay.taskNumber}
            taskId={overlay.taskId}
            correct={overlay.correct}
            userAnswer={overlay.userAnswer}
            collectionSlug={overlay.collectionSlug}
            variantId={overlay.variantId}
            customOrderedTasks={overlay.customOrderedTasks}
            returnTo={overlay.returnTo}
            timeSpentMs={overlay.timeSpentMs}
            revealed={overlay.revealed}
          />
        )}
        {overlay.screen === 'learningSession' && (
          <LearningSession key={overlay.sessionId} sessionId={overlay.sessionId} />
        )}
        {overlay.screen === 'variantAttempt' && (
          <VariantAttempt key={overlay.sessionId} sessionId={overlay.sessionId} />
        )}
        {overlay.screen === 'mistakes' && <MistakesDesktop />}
        {overlay.screen === 'trainingTopic' && (
          <WipPlaceholder title="Тренировка по теме" note="Экран в разработке — следующий блок." />
        )}
        {overlay.screen === 'trainingRandom' && (
          <WipPlaceholder title="Случайные задания" note="Экран в разработке — следующий блок." />
        )}
        {overlay.screen === 'trainingVariants' && (
          <WipPlaceholder title="Варианты" note="Экран в разработке — следующий блок." />
        )}
        {overlay.screen === 'rating' && <RatingDesktop />}
        {overlay.screen === 'level' && <Level />}
        {overlay.screen === 'learningCenter' && <LearningCenterDesktop />}
        {overlay.screen === 'theory' && (
          <TheoryCatalog section={overlay.section} taskNumber={overlay.taskNumber} />
        )}
        {overlay.screen === 'onboarding' && <Onboarding />}
        {overlay.screen === 'favorites' && (
          <WipPlaceholder title="Избранное" note="Экран в разработке — следующий блок." />
        )}
        {overlay.screen === 'mockExams' && (
          <WipPlaceholder title="Пробники" note="Экран в разработке — следующий блок." />
        )}
        {overlay.screen === 'topics' && (
          <WipPlaceholder title="Темы" note="Экран в разработке — следующий блок." />
        )}
        {overlay.screen === 'friends' && <FriendsDesktop />}
        {overlay.screen === 'friendProfile' && <FriendProfileDesktop friendId={overlay.friendId} />}
        {overlay.screen === 'settings' && (
          <WipPlaceholder title="Настройки" note="Экран в разработке — следующий блок." />
        )}
        {overlay.screen === 'help' && <HelpDesktop />}
        {overlay.screen === 'notifications' && <Notifications />}
        {overlay.screen === 'profile' && <ProfileDesktop from={overlay.from} />}
      </DesktopShell>
    );
  }

  const sidebar = !noSidebarScreens.has(tab);

  return (
    <DesktopShell header="status" sidebar={sidebar}>
      {/* A signed-in visitor's `/` is the Учебный центр — the same hub the
          logo opens. (It used to be a marketing page that duplicated the
          public landing's old copy.) */}
      {tab === 'home' && <LearningCenterDesktop />}
      {tab === 'training' && <Training />}
      {tab === 'statistics' && <StatisticsDesktop />}
      {tab === 'achievements' && <AchievementsDesktop />}
    </DesktopShell>
  );
}
