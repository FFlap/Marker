import { forwardRef, type ReactNode } from 'react';
import type { TextInputProps } from 'react-native';
import { View } from 'react-native';
import { AppDrawer, type AppDrawerHandle } from '@/components/AppDrawer';
import { SearchField } from '@/components/ui/primitives';
import { createAppStyles } from '@/lib/typography';

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
    // Without a trailing icon the search field itself ends on the 20dp gutter.
    <View style={[s.header, { maxWidth }, !trailing && s.headerPlain]}>
      <AppDrawer ref={ref} current={current} />
      <SearchField {...inputProps} />
      {trailing}
    </View>
  );
});

const s = createAppStyles(
  {
    header: {
      width: '100%',
      minHeight: 68,
      alignSelf: 'center',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingLeft: 20,
      // Trailing icon buttons are 40dp around a ~20dp glyph: 10dp here puts the glyph on
      // the 20dp gutter, the edge text actions and sheet rows end on.
      paddingRight: 10,
      paddingTop: 16,
      paddingBottom: 8,
    },
    headerPlain: { paddingRight: 20 },
  },
  [] as const,
);
