import { describe, expect, it } from 'vitest';
import type { AuthUser } from '@zybrilka/shared';
import { isOnboardingPending } from './onboardingStatus.js';

describe('isOnboardingPending', () => {
  it('is true only for an explicit server "false"', () => {
    expect(isOnboardingPending({ onboardingCompleted: false })).toBe(true);
  });

  it('is false once the server says completed', () => {
    expect(isOnboardingPending({ onboardingCompleted: true })).toBe(false);
  });

  it('is false when signed out / not checked yet', () => {
    expect(isOnboardingPending(null)).toBe(false);
    expect(isOnboardingPending(undefined)).toBe(false);
  });

  it.each([
    ['missing (older API build)', undefined],
    ['null', null],
    ['a string', 'false'],
    ['0', 0],
  ])(
    'treats an unknown/incompatible value (%s) as "do not trap the user in onboarding"',
    (_n, value) => {
      const legacy = { onboardingCompleted: value } as unknown as AuthUser;
      expect(isOnboardingPending(legacy)).toBe(false);
      expect(isOnboardingPending({} as AuthUser)).toBe(false);
    },
  );
});
