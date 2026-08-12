import { Authenticated, AuthLoading, Unauthenticated } from 'convex/react';
import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { colors } from '@/constants/colors';
export default function Gate() {
  return (
    <>
      <AuthLoading>
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.bg,
          }}
        >
          <ActivityIndicator color={colors.accent} />
        </View>
      </AuthLoading>
      <Authenticated>
        <Redirect href="/(tabs)" />
      </Authenticated>
      <Unauthenticated>
        <Redirect href="/sign-in" />
      </Unauthenticated>
    </>
  );
}
