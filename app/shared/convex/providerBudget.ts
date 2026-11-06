type BudgetState =
  | { state: 'empty' }
  | { state: 'reserving'; pending: Promise<void> }
  | { state: 'available'; slots: number; expiresAt: number }
  | { state: 'denied'; until: number };

/** Action-local prepaid slots. One reservation owns all concurrent waiters.
 * Unused slots remain charged until the distributed window expires.
 */
export function batchedProviderBudget(
  reserve: () => Promise<{ amount: number; expiresAt: number }>,
) {
  let budget: BudgetState = { state: 'empty' };
  return async (): Promise<boolean> => {
    for (;;) {
      switch (budget.state) {
        case 'available':
          if (budget.slots > 0 && Date.now() < budget.expiresAt) {
            budget = { ...budget, slots: budget.slots - 1 };
            return true;
          }
          budget = { state: 'empty' };
          break;
        case 'denied':
          if (Date.now() < budget.until) return false;
          budget = { state: 'empty' };
          break;
        case 'empty': {
          const pending = Promise.resolve()
            .then(reserve)
            .then(
              (reservation) => {
                budget =
                  reservation.amount > 0
                    ? {
                        state: 'available',
                        slots: reservation.amount,
                        expiresAt: reservation.expiresAt,
                      }
                    : { state: 'denied', until: reservation.expiresAt };
              },
              (error) => {
                budget = { state: 'empty' };
                throw error;
              },
            );
          budget = { state: 'reserving', pending };
          await pending;
          break;
        }
        case 'reserving':
          await budget.pending;
          break;
      }
    }
  };
}
