import { createContext, useContext, useEffect, useState } from 'react';
import {
  KeyboardAwareScrollView,
  type KeyboardAwareScrollViewProps,
} from 'react-native-keyboard-controller';

export const KEYBOARD_FIELD_GAP = 24;

const FieldSpaceContext = createContext<((space: number) => void) | undefined>(undefined);

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
