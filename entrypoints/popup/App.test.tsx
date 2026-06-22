import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { EpisodeBookmark } from '../../src/domain/types';

const bookmark: EpisodeBookmark = {
  seriesId: 'GYZJ43JMR',
  seriesTitle: 'That Time I Got Reincarnated as a Slime',
  seriesUrl: 'https://www.crunchyroll.com/series/GYZJ43JMR/slime',
  seasonNumber: '1',
  episodeNumber: '2',
  episodeTitle: 'Meeting the Goblins',
  episodeId: 'G6245P09Y',
  watchUrl: 'https://www.crunchyroll.com/watch/G6245P09Y/meeting-the-goblins',
  updatedAt: 200,
};

describe('App', () => {
  it('shows a useful empty state', () => {
    render(
      <App
        bookmarks={[]}
        onOpen={vi.fn()}
        onRemove={vi.fn()}
        onClear={vi.fn()}
      />,
    );

    expect(screen.getByText('No episodes tracked yet')).toBeInTheDocument();
    expect(screen.getByText(/Open any episode on Crunchyroll/i)).toBeInTheDocument();
  });

  it('renders series, season, episode, and episode title', () => {
    render(
      <App
        bookmarks={[bookmark]}
        onOpen={vi.fn()}
        onRemove={vi.fn()}
        onClear={vi.fn()}
      />,
    );

    expect(screen.getByText(bookmark.seriesTitle)).toBeInTheDocument();
    expect(screen.getByText('Season 1')).toBeInTheDocument();
    expect(screen.getByText('Episode 2')).toBeInTheDocument();
    expect(screen.getByText('Meeting the Goblins')).toBeInTheDocument();
  });

  it('renders non-numbered categories without adding the word Season', () => {
    render(
      <App
        bookmarks={[{ ...bookmark, seasonNumber: 'Specials' }]}
        onOpen={vi.fn()}
        onRemove={vi.fn()}
        onClear={vi.fn()}
      />,
    );

    expect(screen.getByText('Specials')).toBeInTheDocument();
    expect(screen.queryByText('Season Specials')).not.toBeInTheDocument();
  });

  it('opens the exact last watched episode from the card', () => {
    const onOpen = vi.fn();
    render(
      <App
        bookmarks={[bookmark]}
        onOpen={onOpen}
        onRemove={vi.fn()}
        onClear={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /continue that time/i }));
    expect(onOpen).toHaveBeenCalledWith(bookmark.watchUrl);
  });

  it('removes one bookmark without opening it', () => {
    const onOpen = vi.fn();
    const onRemove = vi.fn();
    render(
      <App
        bookmarks={[bookmark]}
        onOpen={onOpen}
        onRemove={onRemove}
        onClear={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /remove that time/i }));
    expect(onRemove).toHaveBeenCalledWith(bookmark.seriesId);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('clears all bookmarks', () => {
    const onClear = vi.fn();
    render(
      <App
        bookmarks={[bookmark]}
        onOpen={vi.fn()}
        onRemove={vi.fn()}
        onClear={onClear}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(onClear).toHaveBeenCalledOnce();
  });
});
