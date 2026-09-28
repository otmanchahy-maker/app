import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LinearGradient } from "expo-linear-gradient";
import { Redirect, useRouter } from "expo-router";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CheckCircle, Crown, Lightning } from "phosphor-react-native";

import { useToast } from "@/src/components/toast";
import { PrimaryButton } from "@/src/components/ui";
import { activateDemo, subscriptionStatus } from "@/src/api/client";
import { useAuth } from "@/src/context/auth";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const BENEFITS = [
  "Piani d'azione giornalieri illimitati",
  "Coach AI sempre disponibile",
  "Coach di emergenza SOS",
  "Check-in vocali e analisi progressi",
  "Badge, streak e report PDF",
];

export default function Paywall() {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const { logout } = useAuth();

  const statusQ = useQuery({ queryKey: ["subscription"], queryFn: subscriptionStatus });
  const access = statusQ.data;

  const activateMut = useMutation({
    mutationFn: activateDemo,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["subscription"] });
      toast("Abbonamento attivato! 🎉", "success");
      router.replace("/home");
    },
    onError: (e: any) => toast(e?.message || "Errore", "error"),
  });

  // If access already granted (creator / premium / trial), don't show paywall.
  if (access && !access.paywall) return <Redirect href="/home" />;

  return (
    <View style={styles.screen} testID="paywall-screen">
      <LinearGradient colors={[colors.brandPrimary, "#D84C10"]} style={styles.hero}>
        <View style={[styles.heroInner, { paddingTop: insets.top + spacing["2xl"] }]}>
          <View style={styles.crown}>
            <Crown color={colors.brandPrimary} size={38} weight="fill" />
          </View>
          <Text style={styles.heroTitle}>Sblocca AI Personal Coach</Text>
          <Text style={styles.heroSub}>La tua prova gratuita di 15 giorni è terminata.</Text>
        </View>
      </LinearGradient>

      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: insets.bottom + spacing.xl }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.priceCard}>
          <View style={styles.badgePop}>
            <Lightning color={colors.onBrandPrimary} size={14} weight="fill" />
            <Text style={styles.badgePopText}>PREMIUM</Text>
          </View>
          <Text style={styles.price}>9,99€<Text style={styles.priceMonth}> /mese</Text></Text>
          <Text style={styles.priceNote}>Disdici quando vuoi</Text>
        </View>

        <View style={styles.benefits}>
          {BENEFITS.map((b) => (
            <View key={b} style={styles.benefitRow}>
              <CheckCircle color={colors.success} size={22} weight="fill" />
              <Text style={styles.benefitText}>{b}</Text>
            </View>
          ))}
        </View>

        <PrimaryButton
          testID="paywall-subscribe-button"
          label="Sblocca ora"
          loading={activateMut.isPending}
          onPress={() => activateMut.mutate()}
          style={{ marginTop: spacing.xl }}
        />
        <Text style={styles.demoNote}>Modalità demo: l&apos;abbonamento reale in-app sarà disponibile dopo la pubblicazione.</Text>

        <Text testID="paywall-logout" onPress={logout} style={styles.logout}>Esci</Text>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.surface },
  hero: { borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg },
  heroInner: { alignItems: "center", padding: spacing.xl, paddingBottom: spacing["2xl"] },
  crown: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.onBrandPrimary, alignItems: "center", justifyContent: "center", marginBottom: spacing.lg },
  heroTitle: { color: colors.onBrandPrimary, fontFamily: fonts.extrabold, fontSize: 24, textAlign: "center" },
  heroSub: { color: colors.onBrandPrimary, fontFamily: fonts.medium, fontSize: 14, textAlign: "center", marginTop: spacing.sm, opacity: 0.95 },

  priceCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: "center",
    borderWidth: 2,
    borderColor: colors.brandTertiary,
  },
  badgePop: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill },
  badgePopText: { color: colors.onBrandPrimary, fontFamily: fonts.extrabold, fontSize: 11, letterSpacing: 1 },
  price: { color: colors.onSurface, fontFamily: fonts.extrabold, fontSize: 42, marginTop: spacing.md },
  priceMonth: { fontFamily: fonts.semibold, fontSize: 18, color: colors.muted },
  priceNote: { color: colors.muted, fontFamily: fonts.medium, fontSize: 13, marginTop: spacing.xs },

  benefits: { marginTop: spacing.xl, gap: spacing.md },
  benefitRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  benefitText: { color: colors.onSurface, fontFamily: fonts.semibold, fontSize: 15, flex: 1 },

  demoNote: { color: colors.muted, fontFamily: fonts.regular, fontSize: 12, textAlign: "center", marginTop: spacing.md, lineHeight: 18 },
  logout: { color: colors.muted, fontFamily: fonts.bold, fontSize: 15, textAlign: "center", marginTop: spacing.xl, paddingVertical: spacing.md },
}));
