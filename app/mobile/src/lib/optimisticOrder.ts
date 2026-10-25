export function isOrderAcknowledged(optimistic: readonly string[], saved: readonly string[]) {
  // Membership can change before the saved query renders. Compare the relative
  // order of surviving titles so additions and removals cannot pin an old order.
  const positions = new Map(optimistic.map((id, index) => [id, index]));
  let previous = -1;
  for (const id of saved) {
    const position = positions.get(id);
    if (position === undefined) continue;
    if (position <= previous) return false;
    previous = position;
  }
  return true;
}
