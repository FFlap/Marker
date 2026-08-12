import { forwardRef, type ReactNode } from 'react';
import type { TextInputProps } from 'react-native';
import { View } from 'react-native';
import { AppDrawer, type AppDrawerHandle } from '@/components/AppDrawer';
import { Input } from '@/components/ui/primitives';
import { colors } from '@/constants/colors';
import { createStyles } from '@/lib/typography';

type TabHeaderProps = Pick<
  TextInputProps,
  'accessibilityLabel' | 'onChangeText' | 'placeholder' | 'returnKeyType' | 'testID' | 'value'
> & {
  current?: 'library' | 'episodes' | 'tags';
  maxWidth: number;
  trailing?: ReactNode;
};

export const TabHeader = forwardRef<AppDrawerHandle, TabHeaderProps>(function TabHeader(
  { current = 'library', maxWidth, trailing, ...inputProps },
  ref,
) {
  return (
    <View style={[s.header, { maxWidth }]}>
      <AppDrawer ref={ref} current={current} />
      <Input {...inputProps} compact hitSlop={{ top: 4, bottom: 4 }} style={s.searchInput} />
      {trailing}
    </View>
  );
});

const s = createStyles({
  header: {
    width: '100%',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    height: 36,
    borderWidth: 0,
    backgroundColor: colors.surface,
    fontSize: 14,
  },
});
