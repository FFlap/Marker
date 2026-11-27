import { View } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';
import { UnderlineTabs } from '@/components/ui/UnderlineTabs';

export type ProfileTab = 'collection' | 'stats';

// Text-only, like the Episodes tabs.
const tabs = [
  { value: 'collection', label: 'Collection' },
  { value: 'stats', label: 'Stats' },
] as const;

export function ProfileTabs({
  value,
  onChange,
  position,
}: {
  value: ProfileTab;
  onChange: (value: ProfileTab) => void;
  position?: SharedValue<number>;
}) {
  return (
    <View style={{ marginBottom: 24 }}>
      <UnderlineTabs tabs={tabs} value={value} onChange={onChange} position={position} />
    </View>
  );
}
