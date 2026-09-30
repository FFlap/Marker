import { createContext, useContext, useEffect, useState } from 'react';
import {
  KeyboardAwareScrollView,
  type KeyboardAwareScrollViewProps,
} from 'react-native-keyboard-controller';

// Android draws edge to edge, so the window no longer resizes for the keyboard.
// Scrollable forms lift the focused field above it themselves, leaving this gap.
export const KEYBOARD_FIELD_GAP = 24;

const FieldSpaceContext = createContext<((space: number) => void) | undefined>(undefined);

/**
 * Reserves room below the focused field, so anything a field reveals — such as
 * an autocomplete list — is lifted clear of the keyboard along with it.
 */
export function useKeyboardFieldSpace(space: number) {
  const setSpace = useContext(FieldSpaceContext);
  useEffect(() => {
    setSpace?.(space);
    return () => setSpace?.(0);
  }, [setSpace, space]);
}

export function KeyboardScrollView(props: KeyboardAwareScrollViewProps) {
  const [fieldSpace, setFieldSpace] = useState(0);
  return (
    <FieldSpaceContext value={setFieldSpace}>
      <KeyboardAwareScrollView
        bottomOffset={KEYBOARD_FIELD_GAP + fieldSpace}
        keyboardShouldPersistTaps="handled"
        {...props}
      />
    </FieldSpaceContext>
  );
}
