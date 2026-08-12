import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const posterUrl = (path?: string) =>
  path && /^\/[A-Za-z0-9._/-]+$/u.test(path)
    ? `https://image.tmdb.org/t/p/w500${path}`
    : undefined;

export const safeInternalPath = (value: string | undefined, fallback = '/') => {
  const hasControlCharacter = value
    ? Array.from(value).some((character) => {
        const code = character.charCodeAt(0);
        return code <= 0x1f || code === 0x7f;
      })
    : false;
  const pathname = value?.split(/[?#]/u, 1)[0];
  if (
    !value ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    hasControlCharacter ||
    pathname === '/login' ||
    pathname === '/setup'
  ) return fallback;
  return value;
};
