import { Platform } from 'react-native';
import { AlbertSans_400Regular } from '@expo-google-fonts/albert-sans/400Regular';
import { AlbertSans_500Medium } from '@expo-google-fonts/albert-sans/500Medium';
import { AlbertSans_600SemiBold } from '@expo-google-fonts/albert-sans/600SemiBold';
import { AlbertSans_700Bold } from '@expo-google-fonts/albert-sans/700Bold';

// Embedded fonts use their PostScript names on iOS and filenames on Android.
// Runtime loading (Expo Go or an older native build) uses the same names.
export const fontFamilies = {
  regular: Platform.OS === 'ios' ? 'AlbertSans-Regular' : 'AlbertSans_400Regular',
  medium: Platform.OS === 'ios' ? 'AlbertSans-Medium' : 'AlbertSans_500Medium',
  semibold: Platform.OS === 'ios' ? 'AlbertSans-SemiBold' : 'AlbertSans_600SemiBold',
  bold: Platform.OS === 'ios' ? 'AlbertSans-Bold' : 'AlbertSans_700Bold',
} as const;

export const fontSources = {
  [fontFamilies.regular]: AlbertSans_400Regular,
  [fontFamilies.medium]: AlbertSans_500Medium,
  [fontFamilies.semibold]: AlbertSans_600SemiBold,
  [fontFamilies.bold]: AlbertSans_700Bold,
};
