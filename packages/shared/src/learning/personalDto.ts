import type { Advice } from './adviceBase.js';
import type { ProblemType } from './diagnosis.js';
import type { RecommendationKind } from './engine.js';
import type { SkillLevel, SkillTrend } from './mastery.js';
import type { PlanActivity, PlanDayStatus, PlanKind, PlanProgress } from './plans.js';
import type { AccuracyPoint, Dynamics } from './skillProgress.js';

/** API shapes of personal learning (docs/learning/PERSONAL-PLANS.md § API). */

export interface ProblemSummary {
  readonly type: ProblemType;
  readonly title: string;
  /** One line for the card. */
  readonly summary: string;
  /** The student's numbers behind it. */
  readonly evidence: readonly string[];
  /** The subtype or part the cause concerns («НН», «Деепричастный оборот»). */
  readonly focus?: string | null;
}

export interface PersonalRecommendation {
  readonly subjectId: string;
  readonly skillKey: string;
  readonly examNumber: number | null;
  readonly title: string;
  readonly kind: RecommendationKind;
  readonly priority: number;
  readonly priorityLevel: 'high' | 'medium' | 'low';
  readonly reason: string;
  readonly problem: ProblemSummary;
  readonly progress: {
    /** Null while there is too little data for a level. */
    readonly mastery: number | null;
    readonly level: SkillLevel;
    readonly attempts: number;
    readonly accuracy: number | null;
  };
  readonly suggestedTasks: number;
  readonly taskIds: readonly string[];
}

export interface PersonalRecommendationsResponse {
  readonly summary: {
    /** Recommendations with a high or medium priority. */
    readonly priorityTopics: number;
    /** Primary points these numbers can still give (only numbers with known
     * scoring rules), null when none is known. */
    readonly potentialPrimaryPoints: number | null;
    /** The ЕГЭ result gain in TEST points (0–100) by the official table of
     * the subject's format (`testScoreGain`): «было → станет». `available:
     * false` with the reason when it cannot be counted — then no number is
     * shown, and primary points are never shown in its place. */
    readonly potentialTestPoints:
      | {
          readonly available: true;
          /** The gain in test points: `to − from`. */
          readonly points: number;
          /** Estimated test score now and after the recommended numbers improve. */
          readonly from: number;
          readonly to: number;
          readonly approximate: boolean;
          /** «Тестовый балл · ориентир по шкале ЕГЭ-2026» — always shown with the number. */
          readonly label: string;
          /** What the estimate leaves out (Russian: the essay). */
          readonly note?: string;
        }
      | { readonly available: false; readonly reason: string };
    /** Days to the nearest goal: the active plan's remaining days, else the
     * length of a week plan. */
    readonly etaDays: number | null;
    readonly etaBasis: 'active_plan' | 'week_plan' | null;
    readonly activePlan: {
      readonly id: string;
      readonly subjectId: string;
      readonly kind: PlanKind;
      readonly percent: number;
      readonly today: PlanDayView | null;
    } | null;
  };
  readonly recommendations: readonly PersonalRecommendation[];
}

export interface AdviceResponse {
  readonly skillKey: string;
  readonly subjectId: string;
  readonly examNumber: number | null;
  readonly title: string;
  readonly problem: ProblemSummary;
  /** Other causes the evidence supports. */
  readonly alsoProblems: readonly ProblemType[];
  readonly advice: Advice;
  /** Theory page of the number in the learning centre, null without one. */
  /** The theory page: by number, or by topic for a math topic without a
   * current number; `sections` are its headings the advice points to. */
  readonly theory: {
    readonly subjectId: string;
    readonly taskNumber: number | null;
    readonly topic: string | null;
    readonly sections: readonly string[];
  } | null;
  readonly stats: SkillProgressSummary;
  readonly availableTasks: number;
}

export interface SkillProgressSummary {
  readonly mastery: number | null;
  readonly level: SkillLevel;
  readonly confidence: number;
  readonly attempts: number;
  readonly solvedTasks: number;
  readonly accuracy: number | null;
  readonly incorrect: number;
  readonly repeatedErrorTasks: number;
  readonly trend: SkillTrend | null;
}

export interface PlanDayView {
  readonly dayIndex: number;
  readonly date: string;
  readonly skillKey: string | null;
  readonly skillTitle: string | null;
  readonly examNumber: number | null;
  readonly activity: PlanActivity;
  readonly activityTitle: string;
  readonly steps: readonly string[];
  readonly targetTasks: number;
  readonly difficulty: 1 | 2 | 3;
  readonly done: number;
  readonly correct: number;
  readonly status: PlanDayStatus;
  readonly canSkip: boolean;
  readonly canMove: boolean;
}

export interface PlanFocusView {
  readonly skillKey: string;
  readonly title: string;
  readonly examNumber: number | null;
  readonly problem: ProblemType;
  readonly before: { readonly mastery: number; readonly accuracy: number | null };
  readonly now: {
    readonly mastery: number | null;
    readonly accuracyInPlan: number | null;
    readonly attemptsInPlan: number;
  };
  readonly masteryDelta: number | null;
  readonly accuracyDelta: number | null;
  readonly enoughData: boolean;
}

export interface PlanResponse {
  readonly id: string;
  readonly subjectId: string;
  readonly kind: PlanKind;
  readonly status: 'active' | 'completed' | 'cancelled';
  readonly startDate: string;
  readonly endDate: string;
  readonly today: string;
  readonly movesLeft: number;
  readonly progress: PlanProgress;
  readonly focus: readonly PlanFocusView[];
  readonly days: readonly PlanDayView[];
}

export interface SkillProgressResponse {
  readonly skillKey: string;
  readonly subjectId: string;
  readonly examNumber: number | null;
  readonly title: string;
  readonly stats: SkillProgressSummary;
  readonly problem: ProblemSummary;
  readonly dynamics: Dynamics;
  readonly series: readonly AccuracyPoint[];
  /** Days with practice, newest first (at most 20). */
  readonly history: readonly { date: string; attempts: number; correct: number }[];
  readonly goal: { readonly targetMastery: number; readonly planId: string | null } | null;
  readonly plan: PlanFocusView | null;
  readonly planProgress: { readonly done: number; readonly total: number } | null;
}
