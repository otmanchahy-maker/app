import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CaretRight, FilePdf, PaperPlaneTilt, Plus, SignOut, Target, UsersThree } from "phosphor-react-native";

import { useToast } from "@/src/components/toast";
import { PrimaryButton } from "@/src/components/ui";
import { createGoal, getActiveGoal, getGamification, getPartner, listGoals, setPartner, shareProgress } from "@/src/api/client";
import { useAuth } from "@/src/context/auth";
import { usesNativeTabs } from "@/src/navigation";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

function escapeHtml(s: string) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

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

  const gamQ = useQuery({ queryKey: ["gamification"], queryFn: getGamification });
  const activeQ = useQuery({ queryKey: ["activeGoal"], queryFn: getActiveGoal });
  const partnerQ = useQuery({ queryKey: ["partner"], queryFn: getPartner });

  const [partnerEmail, setPartnerEmail] = useState("");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (partnerQ.data?.partner_email) setPartnerEmail(partnerQ.data.partner_email);
  }, [partnerQ.data]);

  const savePartnerMut = useMutation({
    mutationFn: () => setPartner(partnerEmail.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["partner"] });
      toast("Partner salvato ✅", "success");
    },
    onError: (e: any) => toast(e?.message || "Email non valida", "error"),
  });

  const shareMut = useMutation({
    mutationFn: shareProgress,
    onSuccess: () => toast("Progressi inviati al partner 📧", "success"),
    onError: (e: any) => toast(e?.message || "Invio fallito", "error"),
  });

  const exportPdf = async () => {
    const active = activeQ.data?.goal;
    const g = gamQ.data;
    if (!active) {
      toast("Nessun obiettivo attivo da esportare.", "error");
      return;
    }
    setExporting(true);
    try {
      const badges = (g?.badges || []).filter((b: any) => b.unlocked).map((b: any) => `${b.emoji} ${b.title}`).join(" · ") || "Nessuno ancora";
      const html = `
        <html><head><meta charset="utf-8"/><style>
          body{font-family:-apple-system,Helvetica,Arial;padding:32px;color:#111418}
          h1{color:#FF6B35;margin:0 0 4px} .sub{color:#60646C;margin:0 0 24px}
          .row{display:flex;gap:12px;margin:16px 0}
          .card{flex:1;background:#F4F0E8;border-radius:12px;padding:16px;text-align:center}
          .num{font-size:30px;font-weight:800;color:#FF6B35} .lbl{font-size:12px;color:#60646C}
          .box{background:#FFF;border:1px solid #EBE7DF;border-radius:12px;padding:16px;margin-top:16px}
        </style></head><body>
          <h1>Report Progressi</h1>
          <p class="sub">${escapeHtml(user?.name || "")} — AI Personal Coach</p>
          <div class="box"><strong>Obiettivo:</strong> ${escapeHtml(active.title || "")}<br/>${escapeHtml(active.target_summary || "")}</div>
          <div class="row">
            <div class="card"><div class="num">${g?.streak ?? 0}</div><div class="lbl">giorni di fila</div></div>
            <div class="card"><div class="num">${g?.total_completed ?? 0}</div><div class="lbl">task completati</div></div>
            <div class="card"><div class="num">${g?.points ?? 0}</div><div class="lbl">punti</div></div>
          </div>
          <div class="box"><strong>Badge sbloccati:</strong><br/>${escapeHtml(badges)}</div>
        </body></html>`;
      const { uri } = await Print.printToFileAsync({ html });
      if (Platform.OS === "web") {
        toast("Report generato.", "success");
      } else if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: "Report Progressi" });
      } else {
        toast("Condivisione non disponibile.", "error");
      }
    } catch {
      toast("Impossibile generare il PDF.", "error");
    } finally {
      setExporting(false);
    }
  };

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

        <Text style={styles.section}>Strumenti</Text>
        <Pressable testID="export-pdf-button" onPress={exportPdf} style={styles.toolRow} disabled={exporting}>
          <View style={styles.toolIcon}>
            {exporting ? <ActivityIndicator color={colors.brandPrimary} /> : <FilePdf color={colors.brandPrimary} size={22} weight="fill" />}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.toolTitle}>Esporta report PDF</Text>
            <Text style={styles.toolSub}>Salva o condividi i tuoi progressi</Text>
          </View>
          <CaretRight color={colors.muted} size={18} weight="bold" />
        </Pressable>

        <View style={styles.partnerCard}>
          <View style={styles.toolRowInner}>
            <View style={styles.toolIcon}>
              <UsersThree color={colors.brandPrimary} size={22} weight="fill" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.toolTitle}>Partner di responsabilità</Text>
              <Text style={styles.toolSub}>Invia i tuoi progressi via email</Text>
            </View>
          </View>
          <TextInput
            testID="partner-email-input"
            value={partnerEmail}
            onChangeText={setPartnerEmail}
            placeholder="email@partner.com"
            placeholderTextColor={colors.muted}
            keyboardType="email-address"
            autoCapitalize="none"
            style={styles.partnerInput}
          />
          <View style={styles.partnerBtns}>
            <PrimaryButton
              testID="partner-save-button"
              label="Salva"
              variant="secondary"
              loading={savePartnerMut.isPending}
              disabled={!partnerEmail.trim()}
              onPress={() => savePartnerMut.mutate()}
              style={{ flex: 1 }}
            />
            <PrimaryButton
              testID="partner-share-button"
              label="Invia progressi"
              icon={<PaperPlaneTilt color={colors.onBrandPrimary} size={18} weight="fill" />}
              loading={shareMut.isPending}
              onPress={() => shareMut.mutate()}
              style={{ flex: 1.4 }}
            />
          </View>
        </View>

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
  toolRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  toolRowInner: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  toolIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center" },
  toolTitle: { color: colors.onSurface, fontFamily: fonts.bold, fontSize: 15 },
  toolSub: { color: colors.muted, fontFamily: fonts.medium, fontSize: 12, marginTop: 2 },
  partnerCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  partnerInput: {
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontFamily: fonts.medium,
    fontSize: 15,
    color: colors.onSurface,
  },
  partnerBtns: { flexDirection: "row", gap: spacing.sm },
}));
