export const normalizeUsername = (username: string) => username.trim().toLowerCase();

export function validateUsername(value: string) {
  const username = value.trim();
  if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) {
    throw new Error('Username must be 3–24 characters using letters, numbers, or underscores');
  }
  return { username, normalizedUsername: normalizeUsername(username) };
}
