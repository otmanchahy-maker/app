import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CaretRight, Plus, SignOut, Target } from "phosphor-react-native";

import { useToast } from "@/src/components/toast";
import { PrimaryButton } from "@/src/components/ui";
import { createGoal, listGoals } from "@/src/api/client";
import { useAuth } from "@/src/context/auth";
import { usesNativeTabs } from "@/src/navigation";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

export default function ProfileScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const { user, logout } = useAuth();

  const goalsQ = useQuery({ queryKey: ["goals"], queryFn: listGoals });
  const goals = goalsQ.data?.goals || [];

  const createMut = useMutation({
    mutationFn: createGoal,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["activeGoal"] });
      await qc.invalidateQueries({ queryKey: ["goals"] });
      router.push("/onboarding");
    },
    onError: (e: any) => toast(e?.message || "Errore", "error"),
  });

  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const initial = (user?.name || user?.email || "?").charAt(0).toUpperCase();

  return (
    <View style={styles.screen} testID="profile-screen">
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + spacing.lg, paddingBottom: spacing["3xl"] + bottomChrome }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Profilo</Text>

        <View style={styles.userCard}>
          {user?.picture ? (
            <Image source={{ uri: user.picture }} style={styles.avatar} contentFit="cover" />
          ) : (
            <View style={styles.avatarFallback}>
              <Text style={styles.avatarInitial}>{initial}</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.name} numberOfLines={1}>{user?.name || "Utente"}</Text>
            <Text style={styles.email} numberOfLines={1}>{user?.email}</Text>
          </View>
        </View>

        <PrimaryButton
          testID="new-goal-button"
          label="Nuovo obiettivo"
          loading={createMut.isPending}
          onPress={() => createMut.mutate()}
          icon={<Plus color={colors.onBrandPrimary} size={20} weight="bold" />}
          style={{ marginTop: spacing.xl }}
        />

        <Text style={styles.section}>I tuoi obiettivi</Text>
        {goalsQ.isLoading ? (
          <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.lg }} />
        ) : goals.length === 0 ? (
          <Text style={styles.empty}>Nessun obiettivo ancora.</Text>
        ) : (
          goals.map((g: any) => (
            <View key={g.goal_id} style={styles.goalRow} testID={`goal-row-${g.goal_id}`}>
              <View style={styles.goalIcon}>
                <Target color={colors.brandPrimary} size={22} weight="fill" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.goalTitle} numberOfLines={1}>{g.title}</Text>
                <Text style={styles.goalStatus}>
                  {g.status === "active" ? "Attivo" : g.status === "interviewing" ? "In configurazione" : g.status}
                </Text>
              </View>
              <CaretRight color={colors.muted} size={18} weight="bold" />
            </View>
          ))
        )}

        <Pressable testID="logout-button" onPress={logout} style={styles.logout}>
          <SignOut color={colors.error} size={20} weight="bold" />
          <Text style={styles.logoutText}>Esci</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.surface },
  title: { color: colors.onSurface, fontFamily: fonts.extrabold, fontSize: 26, marginBottom: spacing.lg },
  userCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  avatar: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.brandSecondary },
  avatarFallback: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  avatarInitial: { color: colors.onBrandPrimary, fontFamily: fonts.extrabold, fontSize: 26 },
  name: { color: colors.onSurface, fontFamily: fonts.bold, fontSize: 18 },
  email: { color: colors.muted, fontFamily: fonts.medium, fontSize: 14, marginTop: 2 },

  section: { color: colors.onSurface, fontFamily: fonts.extrabold, fontSize: 18, marginTop: spacing.xl, marginBottom: spacing.md },
  empty: { color: colors.muted, fontFamily: fonts.medium, fontSize: 14 },
  goalRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  goalIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center" },
  goalTitle: { color: colors.onSurface, fontFamily: fonts.bold, fontSize: 15 },
  goalStatus: { color: colors.muted, fontFamily: fonts.medium, fontSize: 12, marginTop: 2 },

  logout: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    marginTop: spacing["2xl"],
    paddingVertical: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  logoutText: { color: colors.error, fontFamily: fonts.bold, fontSize: 16 },
}));
