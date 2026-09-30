import { Ban, Bookmark, Clock3, Eye } from 'lucide-react-native';
import type { Status } from '@/types';

const ICON_SIZE = 17;

/** Status choices for library entries, with a glyph that hints at each state. */
export const ENTRY_STATUS_OPTIONS = [
  {
    label: 'Watched',
    value: 'watched',
    icon: (color: string) => <Eye size={ICON_SIZE} color={color} strokeWidth={1.8} />,
  },
  {
    label: 'Watching',
    value: 'watching',
    icon: (color: string) => <Clock3 size={ICON_SIZE} color={color} strokeWidth={1.8} />,
  },
  {
    label: 'Watchlist',
    value: 'watchlist',
    icon: (color: string) => <Bookmark size={ICON_SIZE} color={color} strokeWidth={1.8} />,
  },
  {
    label: 'Dropped',
    value: 'dropped',
    icon: (color: string) => <Ban size={ICON_SIZE} color={color} strokeWidth={1.8} />,
  },
] as const satisfies readonly { label: string; value: Status; icon: (color: string) => unknown }[];
