import { useState } from 'react';
import {
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

export type NativePressableProps = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
  pressedStyle?: StyleProp<ViewStyle>;
};

/**
 * Keeps the style prop concrete for NativeWind's Fabric interop. Function-based
 * Pressable styles can lose registered layout and surface styles on native.
 */
export function NativePressable({
  style,
  pressedStyle,
  disabled,
  onPressIn,
  onPressOut,
  ...props
}: NativePressableProps) {
  const [pressed, setPressed] = useState(false);

  const handlePressIn = (event: GestureResponderEvent) => {
    setPressed(true);
    onPressIn?.(event);
  };

  const handlePressOut = (event: GestureResponderEvent) => {
    setPressed(false);
    onPressOut?.(event);
  };

  return (
    <Pressable
      {...props}
      disabled={disabled}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[style, pressed && !disabled && pressedStyle]}
    />
  );
}
