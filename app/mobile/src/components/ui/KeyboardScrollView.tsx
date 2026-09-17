import {
  KeyboardAwareScrollView,
  type KeyboardAwareScrollViewProps,
} from 'react-native-keyboard-controller';

// Android draws edge to edge, so the window no longer resizes for the keyboard.
// Scrollable forms lift the focused field above it themselves, leaving this gap.
export const KEYBOARD_FIELD_GAP = 24;

export function KeyboardScrollView(props: KeyboardAwareScrollViewProps) {
  return (
    <KeyboardAwareScrollView
      bottomOffset={KEYBOARD_FIELD_GAP}
      keyboardShouldPersistTaps="handled"
      {...props}
    />
  );
}
