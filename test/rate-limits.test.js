const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeRateLimitSnapshot, unavailableRateLimits } = require('../src/rate-limits');

test('normalizeRateLimitSnapshot preserves both subscription windows and reset credits', () => {
  const snapshot = normalizeRateLimitSnapshot({
    rateLimits: {
      planType: 'pro',
      primary: { usedPercent: 13, windowDurationMins: 300, resetsAt: 1_800_000_000 },
      secondary: { usedPercent: 2, windowDurationMins: 10_080, resetsAt: 1_800_050_000 },
    },
    rateLimitResetCredits: { availableCount: 3 },
  });

  assert.deepEqual(snapshot, {
    status: 'available',
    primary: { usedPercent: 13, remainingPercent: 87, windowDurationMins: 300, resetsAt: 1_800_000_000 },
    secondary: { usedPercent: 2, remainingPercent: 98, windowDurationMins: 10_080, resetsAt: 1_800_050_000 },
    resetCredits: 3,
    plan: 'pro',
  });
});

test('unavailableRateLimits keeps quota UI honest when account data is absent', () => {
  assert.deepEqual(unavailableRateLimits(), {
    status: 'unavailable',
    primary: null,
    secondary: null,
    resetCredits: null,
    plan: null,
  });
});
