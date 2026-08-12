import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockSetEpisode = jest.fn().mockResolvedValue(undefined);
const overview = {
  watching: [
    {
      itemId: 'one-piece',
      title: 'One Piece',
      genres: ['Anime'],
      season: 2,
      seasonName: 'Grand Line Arc',
      episode: 62,
      name: 'The First Line of Defense',
      runtime: 24,
      airDate: '2001-05-27',
      overview: 'The crew reaches the Grand Line.',
      tags: [],
    },
  ],
  favorites: [
    {
      itemId: 'kaguya',
      title: 'Kaguya-sama: Love Is War',
      genres: ['Anime'],
      season: 2,
      episode: 3,
      name: 'Miyuki Shirogane Wants to Gaze at the Moon',
      runtime: 24,
      airDate: '2020-04-25',
      overview: 'The student council spends an evening beneath the moon.',
      rating: 10,
      tags: ['Comedy'],
    },
  ],
};
let mockOverview: typeof overview | undefined = overview;

jest.mock('convex/react', () => ({
  useQuery: () => mockOverview,
  useMutation: () => mockSetEpisode,
}));
jest.mock('../../convex/_generated/api', () => ({
  api: {
    episodeHub: { overview: 'episodeHub.overview' },
    library: { setEpisodeState: 'library.setEpisodeState' },
  },
}));
jest.mock('../../src/components/AppDrawer', () => ({
  AppDrawer: () => null,
}));
jest.mock('expo-image', () => ({ Image: require('react-native').Image }));
jest.mock('../../src/components/ui/drawer', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');
  const container = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  return {
    Drawer: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
    DrawerContent: container,
    DrawerHeader: container,
    DrawerTitle: ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>,
    DrawerTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

import EpisodesScreen from '../../src/app/(tabs)/episodes';
import { ToastProvider } from '../../src/components/ui/Toast';

beforeEach(() => {
  mockOverview = overview;
});

it('uses episode-shaped skeleton rows while the hub loads', async () => {
  mockOverview = undefined;
  const view = await render(
    <ToastProvider>
      <EpisodesScreen />
    </ToastProvider>,
  );

  expect(view.getByLabelText('Loading episodes')).toBeTruthy();
  expect(view.queryByText('Finding your next episodes…')).toBeNull();
});

it('expands episode details, tracks the next episode, and keeps editing in the options menu', async () => {
  const view = await render(
    <ToastProvider>
      <EpisodesScreen />
    </ToastProvider>,
  );
  expect(view.queryByText('Pick up where you left off.')).toBeNull();
  expect(view.queryByText('EPISODE DESK')).toBeNull();
  expect(view.getByText('One Piece')).toBeTruthy();
  expect(view.getByText('The First Line of Defense')).toBeTruthy();
  expect(view.queryByText('EP 62')).toBeNull();
  expect(view.queryByText('24 min')).toBeNull();
  expect(view.getByText('The crew reaches the Grand Line.')).toBeTruthy();
  expect(view.queryByText('01')).toBeNull();

  await fireEvent.press(view.getByLabelText('View One Piece, episode 62'));
  expect(view.getByText('EP 62')).toBeTruthy();
  expect(view.getByText('24 min')).toBeTruthy();
  expect(view.getByText('The crew reaches the Grand Line.')).toBeTruthy();
  expect(view.getByText('Aired 2001-05-27')).toBeTruthy();

  await fireEvent.press(view.getByLabelText('Mark One Piece episode 62 watched'));
  await waitFor(() =>
    expect(mockSetEpisode).toHaveBeenCalledWith({
      itemId: 'one-piece',
      season: 2,
      episode: 62,
      seasonName: 'Grand Line Arc',
      name: 'The First Line of Defense',
      overview: 'The crew reaches the Grand Line.',
      runtime: 24,
      airDate: '2001-05-27',
      watched: true,
    }),
  );
  await fireEvent.press(view.getByRole('tab', { name: 'Favorites' }));
  expect(view.queryByText('The episodes you love most.')).toBeNull();
  expect(view.getByText('Miyuki Shirogane Wants to Gaze at the Moon')).toBeTruthy();
  expect(view.getByLabelText('Rated 10 out of 10')).toBeTruthy();
  expect(view.getByText('The student council spends an evening beneath the moon.')).toBeTruthy();
  await fireEvent.press(view.getByLabelText('View Kaguya-sama: Love Is War, episode 3'));
  expect(view.getByText('The student council spends an evening beneath the moon.')).toBeTruthy();
  expect(view.getByText('EP 03')).toBeTruthy();
  expect(view.getByText('24 min')).toBeTruthy();
  expect(view.getByText('Aired 2020-04-25')).toBeTruthy();
  await fireEvent.press(view.getByLabelText('Kaguya-sama: Love Is War episode 3 options'));
  expect(view.getAllByText('Tags').length).toBeGreaterThan(0);
  expect(view.getByText('Mark episode unwatched')).toBeTruthy();
  expect(view.queryByText('Edit episode 3')).toBeNull();
  await fireEvent.changeText(view.getByPlaceholderText('Add a tag'), 'Romance');
  await fireEvent.press(view.getByRole('button', { name: 'Add' }));
  await waitFor(() =>
    expect(mockSetEpisode).toHaveBeenCalledWith({
      itemId: 'kaguya',
      season: 2,
      episode: 3,
      name: 'Miyuki Shirogane Wants to Gaze at the Moon',
      overview: 'The student council spends an evening beneath the moon.',
      runtime: 24,
      airDate: '2020-04-25',
      tags: ['Comedy', 'Romance'],
    }),
  );
  expect(view.getByLabelText('Search favorites episodes')).toBeTruthy();
  expect(view.getByLabelText('Filter favorites episodes')).toBeTruthy();
  expect(view.getByRole('button', { name: 'Comedy' })).toBeTruthy();
});
