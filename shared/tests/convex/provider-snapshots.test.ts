import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { internal } from '../../convex/_generated/api';
import { putNonFatal } from '../../convex/providerSnapshots';
import schema from '../../convex/schema';

const modules = import.meta.glob('../../convex/**/*.ts');

describe('provider snapshot contracts', () => {
  it('persists the same episode fields accepted at the cache write boundary', async () => {
    const t = convexTest({ schema, modules });
    const episodes = [
      {
        id: 123,
        providerEpisodeId: 123,
        season: 1,
        episode: 1,
        name: 'First episode',
        stillPath: '/episode.jpg',
      },
    ];
    const key = 'tvdb:season:42:official:1';

    expect(
      await putNonFatal(
        { runMutation: t.mutation },
        { key, value: episodes, metricKey: 'tvdb-season' },
      ),
    ).toBe(true);
    expect(await t.query(internal.providerSnapshots.get, { key })).toMatchObject({
      kind: 'episodes',
      value: episodes,
    });
  });

  it('preserves unknown count status through a cached guide', async () => {
    const t = convexTest({ schema, modules });
    const key = 'tvdb:anime:v11:88:42:official';
    const guide = {
      tvdbId: 42,
      title: 'Series',
      episodeRunTime: [24],
      genres: ['Anime'],
      order: 'official',
      seasons: [{ season: 2, name: 'Season 2', episodeCount: 0, episodeCountVerified: false }],
    };

    expect(
      await putNonFatal(
        { runMutation: t.mutation },
        { key, value: guide, metricKey: 'tvdb-guide' },
      ),
    ).toBe(true);
    expect(await t.query(internal.providerSnapshots.get, { key })).toMatchObject({ value: guide });
  });
});
