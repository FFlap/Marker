import React from 'react';
import { render } from '@testing-library/react-native';
import { TagList } from '@/components/ui/TagList';

describe('TagList', () => {
  it('shows every tag once without an expand control', async () => {
    const view = await render(<TagList tags={['Drama', 'Anime', 'Drama', 'Romance']} />);

    expect(view.getAllByText('Drama')).toHaveLength(1);
    expect(view.getByText('Romance')).toBeTruthy();
    expect(view.queryByRole('button')).toBeNull();
  });
});
