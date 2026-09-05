import { getLocales } from 'expo-localization';

export type CalendarEvent = {
  id: string;
  date: string;
  kind: 'movie' | 'episode';
  title: string;
  season?: number;
  episode?: number;
  episodeName?: string;
};

export const deviceRegion = () => {
  const region = getLocales()[0]?.regionCode?.toUpperCase();
  return region && /^[A-Z]{2}$/.test(region) ? region : 'US';
};
