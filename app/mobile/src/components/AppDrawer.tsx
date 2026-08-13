import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, type Href } from 'expo-router';
import { Bell, CalendarDays, Compass, Settings } from 'lucide-react-native';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { NativePressable } from '@/components/ui/NativePressable';
import { colors } from '@/constants/colors';
import { createStyles } from '@/lib/typography';
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
  const [motionReduced, setMotionReduced] = useState(false);
  const [progress] = useState(() => new Animated.Value(0));
  const pendingClose = useRef<(() => void) | undefined>(undefined);
  const profile = useQuery(api.profiles.me);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setMotionReduced);
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setMotionReduced,
    );
    return () => subscription.remove();
  }, []);

  const openDrawer = useCallback(() => {
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
          useNativeDriver: Platform.OS !== 'web',
        }).start();
      });
    }
  }, [motionReduced, progress]);

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
        useNativeDriver: Platform.OS !== 'web',
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
        accessibilityState={{ expanded: visible }}
        hitSlop={4}
        onPress={openDrawer}
        style={s.trigger}
        pressedStyle={s.pressed}
      >
        <ProfileAvatar username={profile?.username} avatarUrl={profile?.avatarUrl} size={36} />
      </NativePressable>

      <Modal
        visible={visible}
        transparent
        animationType="none"
        statusBarTranslucent
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
            accessibilityViewIsModal
            style={[
              s.drawer,
              {
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

const s = createStyles({
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
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 28,
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
});
