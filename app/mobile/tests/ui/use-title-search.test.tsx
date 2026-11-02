import { act, renderHook } from '@testing-library/react-native';

const mockSearch = jest.fn();
const mockShow = jest.fn();
jest.mock('convex/react', () => ({ useAction: () => mockSearch }));
jest.mock('@marker/shared/api', () => ({ api: { tmdb: { searchMulti: 'search' } } }));
jest.mock('../../src/components/ui/Toast', () => ({ useToast: () => ({ show: mockShow }) }));
import { useTitleSearch } from '../../src/hooks/use-title-search';

const advance = async () => {
  await act(async () => jest.advanceTimersByTimeAsync(300));
};
describe('title search lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockSearch.mockReset();
    mockShow.mockReset();
  });
  afterEach(() => jest.useRealTimers());
  it('debounces changes and ignores obsolete failures', async () => {
    let rejectFirst!: (error: Error) => void;
    mockSearch.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectFirst = reject;
        }),
    );
    const newest = [{ id: 2, title: 'Newest', mediaType: 'movie' }];
    mockSearch.mockResolvedValueOnce(newest);
    const { result, rerender } = await renderHook(({ query }) => useTitleSearch(query), {
      initialProps: { query: 'first' },
    });
    await advance();
    await rerender({ query: 'intermediate' });
    await rerender({ query: 'newest' });
    expect(result.current.results).toEqual([]);
    await advance();
    await act(async () => rejectFirst(new Error('obsolete')));
    expect(mockSearch.mock.calls).toEqual([[{ query: 'first' }], [{ query: 'newest' }]]);
    expect(result.current.results).toEqual(newest);
    expect(mockShow).not.toHaveBeenCalled();
  });
  it('cancels pending work when disabled or unmounted', async () => {
    mockSearch.mockResolvedValue([]);
    const { rerender, unmount } = await renderHook(
      ({ enabled }) => useTitleSearch('title', { enabled }),
      { initialProps: { enabled: true } },
    );
    await rerender({ enabled: false });
    await advance();
    expect(mockSearch).not.toHaveBeenCalled();
    await rerender({ enabled: true });
    await unmount();
    await advance();
    expect(mockSearch).not.toHaveBeenCalled();
  });
  it('retries a failed query after leaving and returning to it', async () => {
    mockSearch.mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue([]);
    const { result, rerender } = await renderHook(({ query }) => useTitleSearch(query), {
      initialProps: { query: 'title' },
    });
    await advance();
    expect(result.current.loading).toBe(false);
    expect(mockShow).toHaveBeenCalledTimes(1);
    await rerender({ query: '' });
    await rerender({ query: 'title' });
    await advance();
    expect(mockSearch).toHaveBeenCalledTimes(2);
    expect(result.current.loading).toBe(false);
  });
});
