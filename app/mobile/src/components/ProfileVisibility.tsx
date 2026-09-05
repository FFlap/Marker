import { Globe2, LockKeyhole } from 'lucide-react-native';
import { Text, View } from 'react-native';
import { NativePressable } from '@/components/ui/NativePressable';
import { colors } from '@/constants/colors';
import { createAppStyles } from '@/lib/typography';

const choices = [
  {
    value: true,
    title: 'Public',
    detail: 'Anyone can view your profile and watch statistics.',
    Icon: Globe2,
  },
  {
    value: false,
    title: 'Private',
    detail: 'Only you can see your profile activity.',
    Icon: LockKeyhole,
  },
] as const;

export function ProfileVisibility({
  value,
  onChange,
  disabled = false,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View accessibilityRole="radiogroup" style={s.group}>
      {choices.map(({ value: choice, title, detail, Icon }) => {
        const selected = value === choice;
        return (
          <NativePressable
            key={title}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected, disabled }}
            disabled={disabled}
            onPress={() => onChange(choice)}
            style={[s.choice, selected && s.choiceSelected]}
            pressedStyle={s.pressed}
          >
            <View style={[s.icon, selected && s.iconSelected]}>
              <Icon size={18} color={selected ? colors.bg : colors.text} strokeWidth={1.7} />
            </View>
            <View style={s.copy}>
              <Text style={s.title}>{title}</Text>
              <Text style={s.detail}>{detail}</Text>
            </View>
            <View style={[s.radio, selected && s.radioSelected]}>
              {selected && <View style={s.radioDot} />}
            </View>
          </NativePressable>
        );
      })}
    </View>
  );
}

const s = createAppStyles(
  {
    group: { gap: 10 },
    choice: {
      minHeight: 78,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      padding: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: colors.surface,
    },
    choiceSelected: { borderColor: colors.text },
    pressed: { opacity: 0.72 },
    icon: {
      width: 38,
      height: 38,
      borderRadius: 19,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconSelected: { backgroundColor: colors.text, borderColor: colors.text },
    copy: { flex: 1 },
    title: { color: colors.text, fontSize: 14, fontWeight: '700' },
    detail: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 3 },
    radio: {
      width: 18,
      height: 18,
      borderRadius: 9,
      borderWidth: 1,
      borderColor: colors.muted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    radioSelected: { borderColor: colors.text },
    radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.text },
  },
  ['title', 'detail'] as const,
);
