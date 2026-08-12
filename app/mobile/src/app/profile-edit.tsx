import { ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { ProfileForm } from '@/components/ProfileForm';
import { SecondaryHeader } from '@/components/BackButton';
import { colors } from '@/constants/colors';
import { createStyles } from '@/lib/typography';

export default function ProfileEdit() {
  const finish = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/profile');
  };
  return (
    <View style={s.root}>
      <SecondaryHeader title="Edit profile" maxWidth={620} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
        <ProfileForm onSaved={finish} />
      </ScrollView>
    </View>
  );
}

const s = createStyles({
  root: { flex: 1, backgroundColor: colors.bg },
  content: {
    width: '100%',
    maxWidth: 620,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 96,
    paddingBottom: 56,
  },
});
