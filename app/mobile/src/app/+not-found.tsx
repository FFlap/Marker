import { Redirect } from 'expo-router';

// Unknown cold-entry links must reach an app screen that can release the splash.
export default function NotFound() {
  return <Redirect href="/(tabs)" />;
}
