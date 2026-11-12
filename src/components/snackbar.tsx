import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Alpha, Shape, Spacing, withAlpha } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { AppText, Tappable } from './ui';

interface SnackAction {
  label: string;
  onPress: () => void;
}

interface Snack {
  id: number;
  message: string;
  action?: SnackAction;
}

type ShowSnack = (message: string, action?: SnackAction) => void;

const SnackbarContext = createContext<ShowSnack>(() => {});
/** Asks for the snackbar to sit above a FAB; returns how to take the request back. */
const AboveFabContext = createContext<() => () => void>(() => () => {});

export function useSnackbar(): ShowSnack {
  return useContext(SnackbarContext);
}

/**
 * For a screen with an extended FAB: while the screen is mounted and `active` (pass whether it is
 * the focused screen), snackbars sit above the FAB instead of covering it, as Material asks.
 */
export function useSnackbarAboveFab(active = true): void {
  const raise = useContext(AboveFabContext);
  useEffect(() => (active ? raise() : undefined), [active, raise]);
}

const DURATION_MS = 4500;
/** Keeps the snackbar above the M3 navigation bar (80dp). */
const NAV_BAR_CLEARANCE = 88;
/** A FAB is 56dp tall and sits 16dp above the navigation bar; the snackbar keeps 8dp above it. */
const FAB_LIFT = 72;

/** M3 snackbar: inverse surface, extra-small corners, action in inverse primary. */
export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [snack, setSnack] = useState<Snack | null>(null);
  // How many screens on show have a FAB under the snackbar's usual place.
  const [fabs, setFabs] = useState(0);
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const show = useCallback<ShowSnack>((message, action) => {
    setSnack({ id: Date.now(), message, action });
  }, []);

  const raise = useCallback(() => {
    setFabs((n) => n + 1);
    return () => setFabs((n) => n - 1);
  }, []);

  useEffect(() => {
    if (!snack) return;
    const t = setTimeout(() => setSnack((s) => (s?.id === snack.id ? null : s)), DURATION_MS);
    return () => clearTimeout(t);
  }, [snack]);

  return (
    <SnackbarContext.Provider value={show}>
      <AboveFabContext.Provider value={raise}>{children}</AboveFabContext.Provider>
      {snack ? (
        <View
          pointerEvents="box-none"
          style={[styles.wrap, { bottom: insets.bottom + NAV_BAR_CLEARANCE + (fabs > 0 ? FAB_LIFT : 0) }]}
          accessibilityLiveRegion="polite">
          <View style={[styles.snack, { backgroundColor: colors.inverseSurface }]}>
            <AppText variant="bodyMedium" color={colors.inverseOnSurface} style={{ flex: 1 }}>
              {snack.message}
            </AppText>
            {snack.action ? (
              <Tappable
                hitSlop={8}
                rippleColor={withAlpha(colors.inversePrimary, Alpha.pressed)}
                style={styles.action}
                onPress={() => {
                  snack.action?.onPress();
                  setSnack(null);
                }}>
                <AppText variant="labelLarge" color={colors.inversePrimary}>
                  {snack.action.label}
                </AppText>
              </Tappable>
            ) : null}
          </View>
        </View>
      ) : null}
    </SnackbarContext.Provider>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: Spacing.lg, right: Spacing.lg },
  snack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: 48,
    paddingLeft: Spacing.lg,
    paddingRight: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: Shape.extraSmall,
    elevation: 3,
  },
  action: { minHeight: 40, justifyContent: 'center', paddingHorizontal: Spacing.md, borderRadius: Shape.full },
});
