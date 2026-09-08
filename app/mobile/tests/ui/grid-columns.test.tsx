import { act, renderHook } from '@testing-library/react-native';
import type { GridColumns } from '../../src/lib/displayPreferences';

const mockSave = jest.fn();
const mockShow = jest.fn();
jest.mock('convex/react', () => ({ useMutation: () => mockSave }));
jest.mock('../../src/components/ui/Toast', () => ({ useToast: () => ({ show: mockShow }) }));
import { useGridColumns } from '../../src/hooks/use-grid-columns';

it('releases saved pinch overrides and keeps newer requests optimistic', async () => {
  let finishFirst!: () => void;
  let finishSecond!: () => void;
  mockSave
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishSecond = resolve;
        }),
    );
  const { result, rerender } = await renderHook(
    ({ saved }: { saved: GridColumns }) => useGridColumns(saved),
    { initialProps: { saved: 3 } },
  );
  await act(async () => {
    void result.current.updateGridColumns(4);
  });
  await act(async () => {
    void result.current.updateGridColumns(5);
  });
  await act(async () => finishFirst());
  expect(result.current.gridColumns).toBe(5);
  await rerender({ saved: 5 });
  await act(async () => finishSecond());
  await rerender({ saved: 3 });
  expect(result.current.gridColumns).toBe(3);
  mockSave.mockRejectedValueOnce(new Error('offline'));
  await act(async () => {
    await result.current.updateGridColumns(4);
  });
  expect(result.current.gridColumns).toBe(3);
  expect(mockShow).toHaveBeenCalledWith('Couldn’t save grid scale');
});
