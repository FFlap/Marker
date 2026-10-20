import { getLocales } from 'expo-localization';

export type { CalendarEvent } from '../../../shared/calendar';

export const deviceRegion = () => {
  const region = getLocales()[0]?.regionCode?.toUpperCase();
  return region && /^[A-Z]{2}$/.test(region) ? region : 'US';
};
