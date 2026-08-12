import { ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { ProfileForm } from '@/components/ProfileForm';
import { colors } from '@/constants/colors';
import { createStyles } from '@/lib/typography';

export default function ProfileSetup() {
  return (
    <View style={s.root}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
        <View>
          <Text style={s.kicker}>MARKER</Text>
          <Text style={s.title}>Create your profile</Text>
          <Text style={s.lede}>Choose how you’ll appear and who can see your watch activity.</Text>
        </View>
        <ProfileForm setup onSaved={() => router.replace('/(tabs)/profile')} />
      </ScrollView>
    </View>
  );
}

const s = createStyles({
  root: { flex: 1, backgroundColor: colors.bg },
  content: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingTop: 64,
    paddingBottom: 48,
    gap: 52,
  },
  kicker: { color: colors.muted, fontSize: 10, fontWeight: '700', letterSpacing: 1.5 },
  title: {
    color: colors.text,
    fontSize: 34,
    lineHeight: 39,
    fontWeight: '700',
    letterSpacing: -1.1,
    marginTop: 14,
  },
  lede: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 10, maxWidth: 400 },
});
