const usernamePattern = /^[A-Za-z0-9_]{3,24}$/;

export function usernameError(username: string) {
  const value = username.trim();
  if (!value) return 'Choose a username.';
  if (value.length < 3) return 'Use at least 3 characters.';
  if (value.length > 24) return 'Keep it to 24 characters or fewer.';
  if (!usernamePattern.test(value)) return 'Use only letters, numbers, and underscores.';
  return '';
}
