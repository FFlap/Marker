import { Text, View } from 'react-native';
import { useAccountLoading } from '@/hooks/useAccountLoading';
import { router, type Href } from 'expo-router';
import BookOpen from 'lucide-react-native/icons/book-open';
import ListVideo from 'lucide-react-native/icons/list-video';
import Tags from 'lucide-react-native/icons/tags';
import { NativePressable } from '@/components/ui/NativePressable';
import { colors } from '@/constants/colors';
import { radius } from '@/constants/theme';
import { createAppStyles } from '@/lib/typography';

type Destination = 'library' | 'episodes' | 'tags';

const destinations = [
  { key: 'library', label: 'Library', href: '/(tabs)', Icon: BookOpen },
  { key: 'episodes', label: 'Episodes', href: '/episodes', Icon: ListVideo },
  { key: 'tags', label: 'Tags', href: '/tags', Icon: Tags },
] as const;

export function MobileNav({ current }: { current: Destination }) {
  const { libraryReady } = useAccountLoading();
  return (
    <View accessibilityRole="tablist" style={s.shell}>
      <View style={s.navigation}>
        {destinations.map(({ key, label, href, Icon }) => {
          const selected = current === key;
          return (
            <NativePressable
              key={key}
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={{ selected, disabled: !libraryReady }}
              disabled={!libraryReady}
              onPress={() => {
                if (!selected) router.replace(href as Href);
              }}
              style={s.item}
              pressedStyle={s.pressed}
            >
              <View style={[s.indicator, selected && s.indicatorSelected]}>
                <Icon
                  size={20}
                  color={selected ? colors.text : colors.muted}
                  strokeWidth={selected ? 2 : 1.8}
                />
              </View>
              <Text numberOfLines={1} style={[s.label, selected && s.labelSelected]}>
                {label}
              </Text>
            </NativePressable>
          );
        })}
      </View>
    </View>
  );
}

const s = createAppStyles(
  {
    shell: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 30,
      backgroundColor: colors.bg,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: 2,
      paddingBottom: 6,
    },
    navigation: {
      width: '100%',
      maxWidth: 520,
      alignSelf: 'center',
      height: 58,
      flexDirection: 'row',
    },
    item: {
      flex: 1,
      height: 58,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 3,
    },
    indicator: {
      width: 56,
      height: 30,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    indicatorSelected: { backgroundColor: colors.elevated },
    label: { color: colors.muted, fontSize: 11, lineHeight: 14, fontWeight: '600' },
    labelSelected: { color: colors.text },
    pressed: { opacity: 0.62 },
  },
  ['label', 'labelSelected'] as const,
);
