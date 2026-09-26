import * as Haptics from "expo-haptics";
import { ActivityIndicator, Platform, Pressable, StyleProp, Text, View, ViewStyle } from "react-native";

import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

export function PrimaryButton({
  label,
  onPress,
  loading,
  disabled,
  testID,
  variant = "primary",
  style,
  icon,
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
  variant?: "primary" | "secondary";
  style?: StyleProp<ViewStyle>;
  icon?: React.ReactNode;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const isSecondary = variant === "secondary";
  const handlePress = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onPress();
  };
  return (
    <Pressable
      testID={testID}
      onPress={handlePress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        isSecondary ? styles.buttonSecondary : styles.buttonPrimary,
        (disabled || loading) && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isSecondary ? colors.onBrandSecondary : colors.onBrandPrimary} />
      ) : (
        <View style={styles.buttonRow}>
          {icon}
          <Text style={[styles.buttonText, isSecondary ? styles.textSecondary : styles.textPrimary]}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

export function Card({ children, style, testID }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  const styles = useStyles();
  return (
    <View testID={testID} style={[styles.card, style]}>
      {children}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  button: {
    height: 56,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  buttonPrimary: {
    backgroundColor: colors.brandPrimary,
    shadowColor: colors.brandPrimary,
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  buttonSecondary: {
    backgroundColor: colors.brandSecondary,
  },
  buttonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  buttonText: {
    fontFamily: fonts.bold,
    fontSize: 16,
  },
  textPrimary: { color: colors.onBrandPrimary },
  textSecondary: { color: colors.onBrandSecondary },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
}));
