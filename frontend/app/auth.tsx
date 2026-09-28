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
        <LinearGradient
          colors={["#160F2E", "#0A0A12", colors.surface]}
          locations={[0, 0.6, 1]}
          style={styles.scrim}
        />
        <Image source={require("../assets/images/icon.png")} style={styles.logo} contentFit="contain" transition={300} />
      </View>

      <View style={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}>
        <View style={styles.badge}>
          <Lightning color={colors.onBrandPrimary} size={18} weight="fill" />
          <Text style={styles.badgeText}>Aura AI</Text>
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
  heroWrap: { height: "52%", width: "100%", alignItems: "center", justifyContent: "center" },
  logo: { width: "80%", height: "80%" },
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
