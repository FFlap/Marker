import { colors } from '@/constants/colors';
import { radius } from '@/constants/theme';
import { createAppStyles } from '@/lib/typography';

export const TOOLBAR_HEIGHT = 68;
export const MOBILE_NAV_HEIGHT = 66;

export const libraryScreenStyles = createAppStyles(
  {
    root: { flex: 1, backgroundColor: colors.bg },
    content: {
      width: '100%',
      maxWidth: 880,
      alignSelf: 'center',
      padding: 20,
      paddingTop: TOOLBAR_HEIGHT,
      paddingBottom: 120,
    },
    toolbar: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 10,
      backgroundColor: colors.bg,
    },

    hintRow: {
      minHeight: 40,
      marginTop: 8,
      paddingLeft: 16,
      paddingRight: 4,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      borderRadius: radius.pill,
      backgroundColor: colors.surface,
    },
    hint: { flex: 1, color: colors.secondary, fontSize: 13, fontWeight: '500' },
    hintAction: {
      height: 32,
      paddingHorizontal: 14,
      borderRadius: radius.pill,
      justifyContent: 'center',
      backgroundColor: colors.elevated,
    },
    hintActionPressed: { opacity: 0.7 },
    hintActionText: { color: colors.text, fontSize: 13, fontWeight: '600' },
    section: { marginTop: 28 },
    categoryDropActive: { backgroundColor: colors.surface, borderRadius: radius.lg },
    sectionHead: { marginBottom: 12 },
    emptySection: {
      height: 56,
      borderRadius: radius.md,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptySectionText: { color: colors.muted, fontSize: 13 },
    emptyLine: { color: colors.muted, fontSize: 13, paddingVertical: 4 },
    grid: { paddingTop: 4, paddingBottom: 4 },
  },
  ['hint', 'hintActionText', 'emptySectionText', 'emptyLine'] as const,
);
