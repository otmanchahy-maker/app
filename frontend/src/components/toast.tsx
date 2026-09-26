import { createContext, useCallback, useContext, useEffect, useRef, useState, type PropsWithChildren } from "react";
import { Text, View } from "react-native";
import Animated, { FadeInDown, FadeOutUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CheckCircle, Warning } from "phosphor-react-native";

import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

type ToastType = "success" | "error" | "info";
type ToastState = { message: string; type: ToastType } | null;

const ToastContext = createContext<(message: string, type?: ToastType) => void>(() => {});

export function ToastProvider({ children }: PropsWithChildren) {
  const [toast, setToast] = useState<ToastState>(null);
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((message: string, type: ToastType = "info") => {
    setToast({ message, type });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast ? (
        <Animated.View
          entering={FadeInDown.springify()}
          exiting={FadeOutUp}
          style={[styles.toast, { top: insets.top + spacing.md }]}
          testID="app-toast"
          pointerEvents="none"
        >
          <View
            style={[
              styles.inner,
              {
                backgroundColor:
                  toast.type === "error"
                    ? colors.error
                    : toast.type === "success"
                    ? colors.success
                    : colors.surfaceInverse,
              },
            ]}
          >
            {toast.type === "error" ? (
              <Warning color={colors.onError} size={20} weight="fill" />
            ) : toast.type === "success" ? (
              <CheckCircle color={colors.onSuccess} size={20} weight="fill" />
            ) : null}
            <Text style={styles.text}>{toast.message}</Text>
          </View>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

const useStyles = makeStyles((colors) => ({
  toast: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    alignItems: "center",
    zIndex: 9999,
  },
  inner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    maxWidth: "100%",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  text: {
    color: colors.onSurfaceInverse,
    fontFamily: fonts.semibold,
    fontSize: 14,
    flexShrink: 1,
  },
}));
