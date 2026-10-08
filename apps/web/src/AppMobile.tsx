import { MobileShell } from './ui/MobileShell/MobileShell.js';
import { BottomNav } from './ui/BottomNav/BottomNav.js';
import { defaultBottomNavItems } from './ui/BottomNav/defaultItems.js';
import { WipPlaceholder } from './ui/WipPlaceholder/WipPlaceholder.js';
import { MobileMenu } from './ui/MobileMenu/MobileMenu.js';
import { TaskMobile } from './screens/Task/TaskMobile.js';
import { ResultMobile } from './screens/Result/ResultMobile.js';
import { useNavigation, type MainTabId } from './lib/navigation.js';
import { HomeMobile } from './screens/Home/HomeMobile.js';
import { StatisticsMobile } from './screens/Statistics/StatisticsMobile.js';
import { MistakesMobile } from './screens/Mistakes/MistakesMobile.js';
import { AchievementsMobile } from './screens/Achievements/AchievementsMobile.js';
import { RatingMobile } from './screens/Rating/RatingMobile.js';
import { AboutMobile } from './screens/About/AboutMobile.js';
import { HelpMobile } from './screens/Help/HelpMobile.js';
import { FriendsMobile } from './screens/Friends/FriendsMobile.js';
import { FriendProfileMobile } from './screens/Friends/FriendProfileMobile.js';
import { SubjectCatalogMobile } from './screens/SubjectCatalog/SubjectCatalogMobile.js';
import { SubjectMobile } from './screens/Subject/SubjectMobile.js';
import { Onboarding } from './screens/Onboarding/Onboarding.js';
import { Profile } from './screens/Profile/Profile.js';
import { Training } from './screens/Training/Training.js';
import { TrainingByNumber } from './screens/Training/TrainingByNumber.js';
import { LearningSession } from './screens/LearningSession/LearningSession.js';

/**
 * Mobile app tree (S1 Block 6, approved design). Screens not yet
 * rebuilt against the approved mobile screenshots render a plain
 * "not built yet" placeholder rather than the old orange-system
 * screens, which visually contradict the new design — see the
 * project report for which screens are still pending.
 *
 * Menu is not a full-screen overlay swap like Task/Result/Mistakes —
 * the approved screenshot shows it as a drawer over whatever screen
 * is currently showing, so it renders as a portal on top of the
 * normal tab/overlay content instead (see `isMenuOpen` below).
 *
 * Exactly one `<MobileShell>` in exactly one place in the returned
 * tree: this used to be three separate `return` statements with
 * `{menu}` placed inconsistently relative to `<MobileShell>` across
 * them. That inconsistency was investigated as a possible cause of
 * the mobile-only visual flash (a hypothesis that the differing root
 * element shape forced React to unmount/remount the shell on certain
 * transitions), but a mount-counter instrumentation test proved the
 * shell does NOT remount across that boundary even in the old code —
 * so that was not the actual cause, and this restructuring is kept
 * purely as a readability simplification (one shell instance, props
 * vary), not as the flash fix. The real cause is tracked separately.
 */
export function AppMobile() {
  const { tab, overlay, navigate, back } = useNavigation();
  const isMenuOpen = overlay?.screen === 'menu';
  const contentOverlay = isMenuOpen ? null : overlay;

  function selectTab(id: string) {
    // Профиль/Мои ошибки are real overlay screens (see navigation.tsx's
    // doc comments), not MainTabIds, so they need their own navigate()
    // — unlike every other overlay entry, the bottom nav stays visible
    // over them (see the dedicated branch below).
    if (id === 'profile') {
      navigate({ screen: 'profile', from: { screen: tab } });
      return;
    }
    if (id === 'mistakes') {
      navigate({ screen: 'mistakes' });
      return;
    }
    navigate({ screen: id as MainTabId });
  }

  const menu = <MobileMenu open={isMenuOpen} onClose={back} activeTab={tab} />;

  // Профиль and Мои ошибки are the two overlays that keep the bottom
  // nav visible (with their own slot highlighted) — every other
  // overlay below is a chrome-less full-screen takeover. See
  // navigation.tsx: both deliberately stay OverlayRoutes (not
  // MainTabIds) so Desktop's own routing/BackRow keeps working
  // untouched; this is a mobile-only rendering choice, not a routing
  // change.
  const showsBottomNavOverlay =
    contentOverlay !== null &&
    (contentOverlay.screen === 'profile' || contentOverlay.screen === 'mistakes');

  const nav = !contentOverlay ? (
    <BottomNav items={defaultBottomNavItems} activeId={tab} onSelect={selectTab} />
  ) : showsBottomNavOverlay ? (
    <BottomNav
      items={defaultBottomNavItems}
      activeId={contentOverlay.screen}
      onSelect={selectTab}
    />
  ) : undefined;

  return (
    <>
      <MobileShell nav={nav}>
        {!contentOverlay && (
          <>
            {tab === 'home' && <HomeMobile />}
            {tab === 'training' && <Training />}
            {tab === 'statistics' && <StatisticsMobile />}
            {tab === 'achievements' && <AchievementsMobile />}
          </>
        )}
        {showsBottomNavOverlay && (
          <>
            {contentOverlay.screen === 'profile' && <Profile />}
            {contentOverlay.screen === 'mistakes' && <MistakesMobile />}
          </>
        )}
        {contentOverlay && !showsBottomNavOverlay && (
          <>
            {contentOverlay.screen === 'subjectCatalog' && <SubjectCatalogMobile />}
            {contentOverlay.screen === 'subject' && (
              <SubjectMobile
                subjectId={contentOverlay.subjectId}
                from={contentOverlay.from}
                collectionSlug={contentOverlay.collectionSlug}
                initialMode={contentOverlay.initialMode}
              />
            )}
            {contentOverlay.screen === 'task' && (
              <TaskMobile
                key={contentOverlay.taskId}
                subjectId={contentOverlay.subjectId}
                taskNumber={contentOverlay.taskNumber}
                taskId={contentOverlay.taskId}
                collectionSlug={contentOverlay.collectionSlug}
                variantId={contentOverlay.variantId}
                customOrderedTasks={contentOverlay.customOrderedTasks}
                returnTo={contentOverlay.returnTo}
              />
            )}
            {contentOverlay.screen === 'result' && (
              <ResultMobile
                key={`${contentOverlay.taskId}-${contentOverlay.correct}`}
                subjectId={contentOverlay.subjectId}
                taskNumber={contentOverlay.taskNumber}
                taskId={contentOverlay.taskId}
                correct={contentOverlay.correct}
                userAnswer={contentOverlay.userAnswer}
                collectionSlug={contentOverlay.collectionSlug}
                variantId={contentOverlay.variantId}
                customOrderedTasks={contentOverlay.customOrderedTasks}
                returnTo={contentOverlay.returnTo}
                timeSpentMs={contentOverlay.timeSpentMs}
              />
            )}
            {contentOverlay.screen === 'learningSession' && (
              <LearningSession
                key={contentOverlay.sessionId}
                sessionId={contentOverlay.sessionId}
              />
            )}
            {contentOverlay.screen === 'trainingTopic' && (
              <WipPlaceholder
                title="Тренировка по теме"
                note="Экран в разработке — следующий блок."
              />
            )}
            {contentOverlay.screen === 'trainingRandom' && (
              <WipPlaceholder
                title="Случайные задания"
                note="Экран в разработке — следующий блок."
              />
            )}
            {contentOverlay.screen === 'trainingVariants' && (
              <WipPlaceholder title="Варианты" note="Экран в разработке — следующий блок." />
            )}
            {contentOverlay.screen === 'trainingByNumber' && (
              <TrainingByNumber
                subjectId={contentOverlay.subjectId}
                collectionSlug={contentOverlay.collectionSlug}
                from={contentOverlay.from}
                initialTaskNumber={contentOverlay.initialTaskNumber}
              />
            )}
            {contentOverlay.screen === 'rating' && <RatingMobile />}
            {contentOverlay.screen === 'about' && <AboutMobile />}
            {contentOverlay.screen === 'learningCenter' && (
              <WipPlaceholder
                title="Учебный центр"
                note="Утверждённый референс для этого экрана ещё не получен."
              />
            )}
            {contentOverlay.screen === 'onboarding' && <Onboarding />}
            {contentOverlay.screen === 'favorites' && (
              <WipPlaceholder title="Избранное" note="Экран в разработке — следующий блок." />
            )}
            {contentOverlay.screen === 'mockExams' && (
              <WipPlaceholder title="Пробники" note="Экран в разработке — следующий блок." />
            )}
            {contentOverlay.screen === 'topics' && (
              <WipPlaceholder title="Темы" note="Экран в разработке — следующий блок." />
            )}
            {contentOverlay.screen === 'friends' && <FriendsMobile />}
            {contentOverlay.screen === 'friendProfile' && (
              <FriendProfileMobile friendId={contentOverlay.friendId} />
            )}
            {contentOverlay.screen === 'settings' && (
              <WipPlaceholder title="Настройки" note="Экран в разработке — следующий блок." />
            )}
            {contentOverlay.screen === 'help' && <HelpMobile />}
          </>
        )}
      </MobileShell>
      {menu}
    </>
  );
}
