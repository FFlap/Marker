import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { colors } from '@/constants/colors';
import { createStyles } from '@/lib/typography';

type Props = React.PropsWithChildren<{ message?: string }>;

export function ScreenErrorBoundary({ children, message = 'Something went wrong.' }: Props) {
  const [generation, setGeneration] = React.useState(0);
  return (
    <ErrorBoundaryContent
      key={generation}
      message={message}
      onRetry={() => setGeneration((value) => value + 1)}
    >
      {children}
    </ErrorBoundaryContent>
  );
}

class ErrorBoundaryContent extends React.Component<
  Props & { onRetry: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ScreenErrorBoundary]', error, info.componentStack);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View style={styles.root}>
        <Text style={styles.title}>{this.props.message}</Text>
        <Text style={styles.detail}>Please try again.</Text>
        <Pressable accessibilityRole="button" onPress={this.props.onRetry} style={styles.button}>
          <Text style={styles.buttonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = createStyles({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 24,
    backgroundColor: colors.bg,
  },
  title: { color: colors.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  detail: { color: colors.muted, fontSize: 13, textAlign: 'center' },
  button: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 999,
    paddingHorizontal: 22,
    paddingVertical: 10,
  },
  buttonText: { color: colors.accent, fontSize: 13, fontWeight: '700' },
});
