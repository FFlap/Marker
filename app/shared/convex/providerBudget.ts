/** Action-local prepaid slots. Parallel HTTP attempts share a single reservation
 * instead of contending on the distributed limiter row for every request.
 * Unused slots are charged and expire with the original distributed window.
 */
export function batchedProviderBudget(
  reserve: () => Promise<{ amount: number; expiresAt: number }>,
) {
  let slots = 0;
  let expiresAt = 0;
  let pending: Promise<void> | undefined;
  let deniedUntil = 0;
  return async (): Promise<boolean> => {
    for (;;) {
      if (slots > 0 && Date.now() < expiresAt) {
        slots--;
        return true;
      }
      if (Date.now() < deniedUntil) return false;
      if (!pending) {
        pending = (async () => {
          const reservation = await reserve();
          slots = reservation.amount;
          expiresAt = reservation.expiresAt;
          deniedUntil = slots === 0 ? expiresAt : 0;
        })().finally(() => {
          pending = undefined;
        });
      }
      await pending;
    }
  };
}
