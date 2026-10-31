import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, type Href } from 'expo-router';
import Bell from 'lucide-react-native/icons/bell';
import CalendarDays from 'lucide-react-native/icons/calendar-days';
import Compass from 'lucide-react-native/icons/compass';
import Settings from 'lucide-react-native/icons/settings';
import { useStartupQuery as useQuery } from '@/hooks/useStartupQuery';
import { useAccountLoading } from '@/hooks/useAccountLoading';
import { SkeletonShimmer } from './SkeletonShimmer';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '@marker/shared/api';
import { NativePressable } from '@/components/ui/NativePressable';
import { colors } from '@/constants/colors';
import { createAppStyles } from '@/lib/typography';
import { ProfileAvatar } from './ProfileAvatar';

type Destination =
  'library' | 'episodes' | 'tags' | 'explore' | 'notifications' | 'calendar' | 'settings';

const destinations = [
  { key: 'explore', label: 'Explore', href: '/explore', Icon: Compass },
  { key: 'notifications', label: 'Notifications', href: '/notifications', Icon: Bell },
  { key: 'calendar', label: 'Calendar', href: '/calendar', Icon: CalendarDays },
  { key: 'settings', label: 'Settings', href: '/(tabs)/settings', Icon: Settings },
] as const;

export type AppDrawerHandle = {
  open: () => void;
};

export const AppDrawer = forwardRef<AppDrawerHandle, { current?: Destination }>(function AppDrawer(
  { current = 'library' },
  ref,
) {
  const [visible, setVisible] = useState(false);
  const motionReduced = useReducedMotion();
  const [progress] = useState(() => new Animated.Value(0));
  const pendingClose = useRef<(() => void) | undefined>(undefined);
  const { profileReady } = useAccountLoading();
  const profile = useQuery(api.profiles.me, profileReady ? {} : 'skip');
  const canOpen = !!profile;
  const insets = useSafeAreaInsets();

  const openDrawer = useCallback(() => {
    if (!canOpen) return;
    if (pendingClose.current) {
      progress.stopAnimation();
      setVisible(false);
      const callback = pendingClose.current;
      pendingClose.current = undefined;
      callback();
      return;
    }
    progress.stopAnimation();
    progress.setValue(motionReduced ? 1 : 0);
    setVisible(true);
    if (!motionReduced) {
      requestAnimationFrame(() => {
        Animated.timing(progress, {
          toValue: 1,
          duration: 240,
          easing: Easing.bezier(0.22, 1, 0.36, 1),
          useNativeDriver: true,
        }).start();
      });
    }
  }, [canOpen, motionReduced, progress]);

  const closeDrawer = useCallback(
    (onClosed?: () => void) => {
      pendingClose.current = onClosed ?? pendingClose.current;
      progress.stopAnimation();
      if (motionReduced) {
        progress.setValue(0);
        setVisible(false);
        const callback = pendingClose.current;
        pendingClose.current = undefined;
        callback?.();
        return;
      }
      Animated.timing(progress, {
        toValue: 0,
        duration: 170,
        easing: Easing.bezier(0.25, 1, 0.5, 1),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (!finished) return;
        setVisible(false);
        const callback = pendingClose.current;
        pendingClose.current = undefined;
        callback?.();
      });
    },
    [motionReduced, progress],
  );

  useImperativeHandle(ref, () => ({ open: openDrawer }), [openDrawer]);

  const navigate = (href: Href) => closeDrawer(() => router.push(href));

  return (
    <>
      <NativePressable
        accessibilityRole="button"
        accessibilityLabel="Open account menu"
        accessibilityState={{ expanded: visible, disabled: !canOpen }}
        disabled={!canOpen}
        hitSlop={4}
        onPress={openDrawer}
        style={s.trigger}
        pressedStyle={s.pressed}
      >
        {profile === undefined ? (
          <View
            accessibilityLabel="Loading profile"
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              overflow: 'hidden',
              backgroundColor: colors.surface,
            }}
          >
            <SkeletonShimmer />
          </View>
        ) : (
          <ProfileAvatar username={profile?.username} avatarUrl={profile?.avatarUrl} size={36} />
        )}
      </NativePressable>

      <Modal
        visible={visible}
        transparent
        animationType="none"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => closeDrawer()}
      >
        <View style={s.overlay}>
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              s.scrim,
              {
                opacity: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, 0.6],
                }),
              },
            ]}
          />
          <Animated.View
            testID="account-menu-panel"
            accessibilityViewIsModal
            style={[
              s.drawer,
              {
                paddingTop: insets.top + DRAWER_TOP_GAP,
                paddingBottom: insets.bottom + DRAWER_BOTTOM_GAP,
                paddingLeft: insets.left + DRAWER_SIDE_GAP,
                transform: [
                  {
                    translateX: progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-336, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            <View style={s.drawerHead}>
              <NativePressable
                accessibilityRole="button"
                accessibilityLabel="View profile"
                onPress={() => navigate('/(tabs)/profile')}
                style={s.identity}
                pressedStyle={s.pressed}
              >
                <ProfileAvatar
                  username={profile?.username}
                  avatarUrl={profile?.avatarUrl}
                  size={48}
                />
                <View>
                  <Text style={s.name}>@{profile?.username ?? 'profile'}</Text>
                  <Text style={s.eyebrow}>View Profile</Text>
                </View>
              </NativePressable>
            </View>

            <View accessibilityRole="menu" style={s.navigation}>
              {destinations.map(({ key, label, href, Icon }) => {
                const selected = current === key;
                return (
                  <NativePressable
                    key={key}
                    accessibilityRole="menuitem"
                    accessibilityLabel={label}
                    accessibilityState={{ selected }}
                    onPress={() => navigate(href)}
                    style={[
                      s.menuItem,
                      key === 'settings' && s.settingsItem,
                      selected && s.menuItemSelected,
                    ]}
                    pressedStyle={s.pressed}
                  >
                    <Icon size={19} color={selected ? colors.bg : colors.text} strokeWidth={1.7} />
                    <Text style={[s.menuLabel, selected && s.menuLabelSelected]}>{label}</Text>
                  </NativePressable>
                );
              })}
            </View>
          </Animated.View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close account menu"
            onPress={() => closeDrawer()}
            style={s.backdrop}
          />
        </View>
      </Modal>
    </>
  );
});

const DRAWER_TOP_GAP = 16;
const DRAWER_BOTTOM_GAP = 20;
const DRAWER_SIDE_GAP = 20;

const s = createAppStyles(
  {
    trigger: {
      width: 36,
      height: 36,
      flexShrink: 0,
      borderRadius: 18,
      backgroundColor: 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
    },
    pressed: { opacity: 0.62 },
    overlay: { flex: 1, flexDirection: 'row' },
    scrim: { backgroundColor: '#000' },
    backdrop: { flex: 1 },
    drawer: {
      width: '82%',
      maxWidth: 320,
      height: '100%',
      backgroundColor: colors.bg,
      borderRightWidth: 1,
      borderRightColor: colors.border,
      paddingRight: DRAWER_SIDE_GAP,
    },
    drawerHead: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingBottom: 28,
    },
    identity: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    eyebrow: {
      color: colors.muted,
      fontSize: 10,
      fontWeight: '600',
      letterSpacing: 0.2,
      marginTop: 4,
    },
    name: { color: colors.text, fontSize: 17, fontWeight: '700' },
    navigation: { flex: 1, gap: 8 },
    settingsItem: { marginTop: 'auto' },
    menuItem: {
      minHeight: 52,
      borderRadius: 12,
      paddingHorizontal: 16,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
    },
    menuItemSelected: { backgroundColor: colors.text },
    menuLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
    menuLabelSelected: { color: colors.bg },
  },
  ['eyebrow', 'name', 'menuLabel', 'menuLabelSelected'] as const,
);
