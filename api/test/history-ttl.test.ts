import { describe, it, expect } from 'vitest';
import {
  DEFAULT_HISTORY_TTL_SEC,
  HISTORY_TTL_OPTIONS,
  historyTtlDaysLabel,
  normalizeHistoryTtlSec,
  resolveUserHistoryTtlSec,
} from '../src/history-ttl.js';

describe('history TTL', () => {
  it('default is 3 days', () => {
    expect(DEFAULT_HISTORY_TTL_SEC).toBe(3 * 24 * 3600);
  });

  it('exposes 1 / 3 / 7 / 14 / 30 day options', () => {
    expect(HISTORY_TTL_OPTIONS.map((o) => o.days)).toEqual([1, 3, 7, 14, 30]);
  });

  it('normalize keeps allowed values and falls back otherwise', () => {
    expect(normalizeHistoryTtlSec(7 * 24 * 3600)).toBe(7 * 24 * 3600);
    expect(normalizeHistoryTtlSec(1234)).toBe(DEFAULT_HISTORY_TTL_SEC);
    expect(normalizeHistoryTtlSec('nope')).toBe(DEFAULT_HISTORY_TTL_SEC);
  });

  it('resolveUser passes through valid ttl and defaults when omitted', () => {
    expect(resolveUserHistoryTtlSec(30 * 24 * 3600)).toBe(30 * 24 * 3600);
    expect(resolveUserHistoryTtlSec(undefined)).toBe(DEFAULT_HISTORY_TTL_SEC);
  });

  it('labels days for UI copy', () => {
    expect(historyTtlDaysLabel(86400)).toBe('1 day');
    expect(historyTtlDaysLabel(3 * 86400)).toBe('3 days');
  });
});
