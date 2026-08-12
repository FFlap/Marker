import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const isDemoMode = () => {
  if (import.meta.env.VITE_DEMO_MODE === 'true') return true;
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  if (new URLSearchParams(window.location.search).get('demo') === '1') {
    window.sessionStorage.setItem('marker-demo', '1');
    return true;
  }
  return window.sessionStorage.getItem('marker-demo') === '1';
};

export const posterUrl = (path?: string) =>
  path && /^\/[A-Za-z0-9._/-]+$/u.test(path)
    ? `https://image.tmdb.org/t/p/w500${path}`
    : undefined;

export const safeInternalPath = (value: string | undefined, fallback = '/') => {
  if (
    !value ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    /[\\\r\n]/u.test(value)
  ) return fallback;
  return value;
};
