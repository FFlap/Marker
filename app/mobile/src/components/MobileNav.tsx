import { Text, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { BookOpen, ListVideo, Tags } from 'lucide-react-native';
import { NativePressable } from '@/components/ui/NativePressable';
import { colors } from '@/constants/colors';
import { createAppStyles } from '@/lib/typography';

type Destination = 'library' | 'episodes' | 'tags';

const destinations = [
  { key: 'library', label: 'Library', href: '/(tabs)', Icon: BookOpen },
  { key: 'episodes', label: 'Episodes', href: '/episodes', Icon: ListVideo },
  { key: 'tags', label: 'Tags', href: '/tags', Icon: Tags },
] as const;

export function MobileNav({ current }: { current: Destination }) {
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
              accessibilityState={{ selected }}
              onPress={() => {
                if (!selected) router.replace(href as Href);
              }}
              style={s.item}
              pressedStyle={s.pressed}
            >
              <Icon size={19} color={selected ? colors.text : colors.muted} strokeWidth={1.8} />
              <Text style={[s.label, selected && s.labelSelected]}>{label}</Text>
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
      paddingBottom: 8,
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
      minHeight: 52,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
    },
    label: { color: colors.muted, fontSize: 9, fontWeight: '600' },
    labelSelected: { color: colors.text },
    pressed: { opacity: 0.62 },
  },
  ['label', 'labelSelected'] as const,
);
