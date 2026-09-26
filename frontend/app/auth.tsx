import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Redirect } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Lightning } from "phosphor-react-native";

import { PrimaryButton } from "@/src/components/ui";
import { useToast } from "@/src/components/toast";
import { useAuth } from "@/src/context/auth";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";

const HERO =
  "https://images.unsplash.com/photo-1552674605-db6ffd4facb5?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA2MTJ8MHwxfHNlYXJjaHwxfHxtb3RpdmF0aW5nJTI0d29ya291dCUyMHJ1bm5pbmclMjBicmlnaHQlMjBzdW5saWdodHxlbnwwfHx8fDE3OTA0MzUzMzB8MA&ixlib=rb-4.1.0&q=85";

export default function AuthScreen() {
  const { user, login } = useAuth();
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [loading, setLoading] = useState(false);

  if (user) return <Redirect href="/home" />;

  const handleLogin = async () => {
    setLoading(true);
    try {
      await login();
    } catch (e: any) {
      toast(e?.message || "Accesso non riuscito, riprova.", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container} testID="auth-screen">
      <View style={styles.heroWrap}>
        <Image source={{ uri: HERO }} style={styles.hero} contentFit="cover" transition={300} />
        <LinearGradient
          colors={["transparent", "rgba(17,20,24,0.3)", colors.surface]}
          locations={[0, 0.5, 1]}
          style={styles.scrim}
        />
      </View>

      <View style={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}>
        <View style={styles.badge}>
          <Lightning color={colors.onBrandPrimary} size={18} weight="fill" />
          <Text style={styles.badgeText}>AI Personal Coach</Text>
        </View>
        <Text style={styles.title}>Raggiungi i tuoi{"\n"}obiettivi, più in fretta</Text>
        <Text style={styles.subtitle}>
          Il tuo coach personale con IA trasforma qualsiasi meta in un piano d&apos;azione quotidiano,
          concreto e misurabile.
        </Text>

        <PrimaryButton
          testID="google-signin-button"
          label="Continua con Google"
          onPress={handleLogin}
          loading={loading}
          style={styles.cta}
        />
        <Text style={styles.legal}>Accedendo accetti di iniziare il tuo percorso con il coach.</Text>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surface },
  heroWrap: { height: "52%", width: "100%" },
  hero: { flex: 1 },
  scrim: { ...StyleSheetAbsolute() },
  content: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    justifyContent: "flex-start",
    marginTop: -spacing["2xl"],
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    alignSelf: "flex-start",
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    marginBottom: spacing.lg,
  },
  badgeText: { color: colors.onBrandPrimary, fontFamily: fonts.bold, fontSize: 13 },
  title: { color: colors.onSurface, fontFamily: fonts.extrabold, fontSize: 34, lineHeight: 40 },
  subtitle: {
    color: colors.muted,
    fontFamily: fonts.medium,
    fontSize: 16,
    lineHeight: 24,
    marginTop: spacing.md,
  },
  cta: { marginTop: "auto" },
  legal: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 12,
    textAlign: "center",
    marginTop: spacing.md,
  },
}));

function StyleSheetAbsolute() {
  return { position: "absolute" as const, left: 0, right: 0, top: 0, bottom: 0 };
}
