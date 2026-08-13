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
  const locale = Intl.DateTimeFormat().resolvedOptions().locale;
  const region = new Intl.Locale(locale).region?.toUpperCase();
  return region && /^[A-Z]{2}$/.test(region) ? region : 'US';
};
