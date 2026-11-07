import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { CastSection } from '../../src/features/title/components/CastSection';

jest.mock('../../src/hooks/use-reduced-motion', () => ({ useReducedMotion: () => true }));
jest.mock('../../src/hooks/useStartupQuery', () => ({ useStartupData: () => undefined }));
const member = {
  name: 'Hero',
  character: 'Actor',
  characterImageUrl: 'https://example.com/hero.jpg',
};

it('reserves the cast section while metadata is pending and removes it for a confirmed empty cast', async () => {
  const view = await render(<CastSection members={[]} loading />);
  expect(view.getByText('Cast')).toBeTruthy();
  expect(view.getByLabelText('Loading cast')).toBeTruthy();
  await view.rerender(<CastSection members={[]} loading={false} />);
  expect(view.queryByText('Cast')).toBeNull();
});

it('keeps the artwork skeleton until the image is displayed and resets it for a changed URL', async () => {
  const view = await render(<CastSection members={[member]} loading={false} />);
  expect(view.getByLabelText('Loading artwork for Hero')).toBeTruthy();
  await fireEvent(view.getByTestId('cast-portrait-Hero'), 'display');
  expect(view.queryByLabelText('Loading artwork for Hero')).toBeNull();
  await view.rerender(
    <CastSection
      members={[{ ...member, characterImageUrl: 'https://example.com/new.jpg' }]}
      loading={false}
    />,
  );
  expect(view.getByLabelText('Loading artwork for Hero')).toBeTruthy();
});

it('ends the artwork skeleton and shows the normal placeholder after an image error', async () => {
  const view = await render(<CastSection members={[member]} loading={false} />);
  await fireEvent(view.getByTestId('cast-portrait-Hero'), 'error', {
    nativeEvent: { error: 'Image unavailable' },
  });
  expect(view.queryByLabelText('Loading artwork for Hero')).toBeNull();
  expect(view.getByText('H')).toBeTruthy();
});

it('keeps existing cast visible during a refresh without an image skeleton when no URL exists', async () => {
  const view = await render(
    <CastSection members={[{ name: 'Actor', character: 'Role' }]} loading />,
  );
  expect(view.getByText('Actor')).toBeTruthy();
  expect(view.queryByLabelText('Loading cast')).toBeNull();
  expect(view.queryByLabelText('Loading artwork for Actor')).toBeNull();
});
