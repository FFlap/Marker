import { afterEach, expect, it, vi } from 'vitest';
import { putNonFatal } from '../../convex/providerSnapshots';

afterEach(() => vi.restoreAllMocks());

it.each(['calendar:tv:42', 'tmdb:search:show', 'unknown:42'])(
  'skips unsupported snapshot keys without persisting them: %s',
  async (key) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runMutation = vi.fn();
    for (const value of [[], 'x'.repeat(800 * 1024)])
      expect(await putNonFatal({ runMutation }, { key, value, metricKey: 'test' })).toBe(false);
    expect(runMutation).not.toHaveBeenCalled();
  },
);
