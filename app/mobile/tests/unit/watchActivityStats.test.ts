import { describe, expect, it } from 'vitest';
import {
  buildActivityHeatmap,
  formatActivityDate,
  summarizeWatchActivity,
} from '../../convex/watchActivityStats';

describe('watch activity summary', () => {
  it('keeps a streak alive through today and measures the longest run', () => {
    const days = [
      { date: '2026-09-01', episodes: 2 },
      { date: '2026-09-02', episodes: 5 },
      { date: '2026-09-03', episodes: 1 },
      { date: '2026-10-08', episodes: 3 },
      { date: '2026-10-09', episodes: 5 },
    ];
    expect(summarizeWatchActivity(days, '2026-10-10')).toMatchObject({
      currentStreak: 2,
      longestStreak: 3,
      watchedToday: false,
      totalEpisodes: 16,
      activeDays: 5,
      firstDate: '2026-09-01',
      // 2026-10-10 is a Saturday; its week began Sunday, Oct 4.
      thisWeek: 8,
      lastWeek: 0,
    });
    // 16 episodes across Sep 1 – Oct 10 inclusive (40 days).
    expect(summarizeWatchActivity(days, '2026-10-10').dailyAverage).toBeCloseTo(0.4);
    expect(summarizeWatchActivity(days, '2026-10-11')).toMatchObject({
      currentStreak: 0,
      thisWeek: 0,
      lastWeek: 8,
    });
  });

  it('crosses month and year boundaries and reports empty history', () => {
    const days = [
      { date: '2025-12-31', episodes: 1 },
      { date: '2026-01-01', episodes: 1 },
    ];
    expect(summarizeWatchActivity(days, '2026-01-01')).toMatchObject({
      currentStreak: 2,
      longestStreak: 2,
      watchedToday: true,
      dailyAverage: 1,
    });
    expect(summarizeWatchActivity([], '2026-01-01')).toMatchObject({
      currentStreak: 0,
      longestStreak: 0,
      dailyAverage: 0,
      thisWeek: 0,
      lastWeek: 0,
    });
  });

  it('formats dates without locale data', () => {
    expect(formatActivityDate('2026-10-03')).toBe('Oct 3, 2026');
  });

  it('ignores days ahead of the viewer calendar, including in streaks and averages', () => {
    const days = [
      { date: '2026-10-09', episodes: 2 },
      { date: '2026-10-10', episodes: 3 },
      // A public profile or a timezone change can put a recorded day ahead of today.
      { date: '2026-10-11', episodes: 8 },
    ];
    expect(summarizeWatchActivity(days, '2026-10-10')).toMatchObject({
      currentStreak: 2,
      longestStreak: 2,
      watchedToday: true,
      dailyAverage: 2.5,
      thisWeek: 5,
    });
    expect(summarizeWatchActivity(days.slice(2), '2026-10-10')).toMatchObject({
      currentStreak: 0,
      longestStreak: 0,
      dailyAverage: 0,
      firstDate: undefined,
    });
  });
});

describe('activity heatmap', () => {
  it('ends on the current Sunday-first week and scales levels to the busiest day', () => {
    // 2026-10-10 is a Saturday, so the final column is complete.
    const heatmap = buildActivityHeatmap(
      [
        { date: '2026-10-10', episodes: 8 },
        { date: '2026-10-04', episodes: 1 },
        { date: '2026-09-01', episodes: 4 },
      ],
      '2026-10-10',
      6,
    );
    expect(heatmap.weeks).toHaveLength(6);
    expect(heatmap.weeks[5]![0]).toMatchObject({ date: '2026-10-04', level: 1 });
    expect(heatmap.weeks[5]![6]).toMatchObject({ date: '2026-10-10', level: 4 });
    expect(heatmap.weeks[0]![0]!.date).toBe('2026-08-30');
    expect(heatmap.total).toBe(13);
    expect(heatmap.months).toEqual([
      { week: 0, label: 'Sep' },
      { week: 4, label: 'Oct' },
    ]);
  });

  it('leaves days after today empty', () => {
    // 2026-10-07 is a Wednesday.
    const { weeks } = buildActivityHeatmap([], '2026-10-07', 1);
    expect(weeks[0]!.slice(0, 4).every((cell) => cell?.level === 0)).toBe(true);
    expect(weeks[0]!.slice(4)).toEqual([null, null, null]);
  });
});
