import type { ReactNode } from 'react';
import { View } from 'react-native';
import { colors } from '@/constants/colors';
import { radius } from '@/constants/theme';
import { createAppStyles } from '@/lib/typography';

/** Round leading icon for a settings row. */
export function SettingIcon({ children }: { children: ReactNode }) {
  return <View style={s.icon}>{children}</View>;
}

const s = createAppStyles(
  {
    icon: {
      width: 34,
      height: 34,
      borderRadius: radius.pill,
      backgroundColor: colors.elevated,
      alignItems: 'center',
      justifyContent: 'center',
    },
  },
  [] as const,
);
