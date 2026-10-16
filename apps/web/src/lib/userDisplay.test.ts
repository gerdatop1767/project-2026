import { describe, expect, it } from 'vitest';
import { displayName } from './userDisplay.js';

describe('displayName', () => {
  it('prefers the server-resolved name (custom name wins)', () => {
    expect(displayName({ firstName: 'Иван', lastName: 'Петров', displayName: 'Мой ник' })).toBe(
      'Мой ник',
    );
  });
  it('falls back to the provider first + last name', () => {
    expect(displayName({ firstName: 'Иван', lastName: null, displayName: null })).toBe('Иван');
    expect(displayName({ firstName: ' ', lastName: 'Петров' })).toBe('Петров');
  });
  it('is null when there is no name at all', () => {
    expect(displayName({ firstName: null, lastName: null, displayName: '  ' })).toBeNull();
    expect(displayName(null)).toBeNull();
  });
});
