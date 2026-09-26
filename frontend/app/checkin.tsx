import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CaretLeft, CheckCircle, Sparkle } from "phosphor-react-native";

import { useToast } from "@/src/components/toast";
import { PrimaryButton } from "@/src/components/ui";
import { createCheckin, getActiveGoal, getToday } from "@/src/api/client";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const MOODS = [
  { key: "great", emoji: "🔥", label: "Alla grande" },
  { key: "good", emoji: "🙂", label: "Bene" },
  { key: "ok", emoji: "😐", label: "Così così" },
  { key: "tired", emoji: "😮‍💨", label: "Stanco" },
  { key: "bad", emoji: "😞", label: "Male" },
];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function CheckinScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();

  const goalQ = useQuery({ queryKey: ["activeGoal"], queryFn: getActiveGoal });
  const goal = goalQ.data?.goal;
  const goalId: string | undefined = goal?.goal_id;

  const todayQ = useQuery({
    queryKey: ["today", goalId],
    queryFn: () => getToday(goalId!),
    enabled: !!goalId,
  });

  const [mood, setMood] = useState<string>("");
  const [summary, setSummary] = useState("");
  const [obstacles, setObstacles] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);

  const checkinMut = useMutation({
    mutationFn: () =>
      createCheckin(goalId!, { date: todayISO(), summary, mood, obstacles }),
    onSuccess: (data) => {
      setFeedback(data.checkin.ai_feedback);
      qc.invalidateQueries({ queryKey: ["messages", goalId] });
      qc.invalidateQueries({ queryKey: ["progress", goalId] });
    },
    onError: (e: any) => toast(e?.message || "Errore check-in", "error"),
  });

  if (goalQ.isLoading) {
    return <View style={[styles.screen, styles.centered]}><ActivityIndicator size="large" color={colors.brandPrimary} /></View>;
  }
  if (!goal || goal.status !== "active") return <Redirect href="/home" />;

  const completed = todayQ.data?.completed || 0;
  const total = todayQ.data?.total || 0;

  if (feedback) {
    return (
      <View style={styles.screen} testID="checkin-result">
        <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
          <View style={{ width: 26 }} />
          <Text style={styles.headerTitle}>Check-in</Text>
          <View style={{ width: 26 }} />
        </View>
        <View style={styles.resultContent}>
          <View style={styles.resultIcon}>
            <Sparkle color={colors.brandPrimary} size={40} weight="fill" />
          </View>
          <Text style={styles.resultTitle}>Il feedback del coach</Text>
          <View style={styles.feedbackCard}>
            <Text style={styles.feedbackText}>{feedback}</Text>
          </View>
          <PrimaryButton
            testID="checkin-done-button"
            label="Torna al piano"
            onPress={() => router.replace("/home")}
            style={{ alignSelf: "stretch", marginTop: spacing.xl }}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen} testID="checkin-screen">
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="checkin-back">
          <CaretLeft color={colors.onSurface} size={26} weight="bold" />
        </Pressable>
        <Text style={styles.headerTitle}>Check-in di oggi</Text>
        <View style={{ width: 26 }} />
      </View>

      <KeyboardAwareScrollView
        bottomOffset={20}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.progressCard}>
          <CheckCircle color={colors.success} size={28} weight="fill" />
          <Text style={styles.progressText}>Hai completato {completed} di {total} attività oggi</Text>
        </View>

        <Text style={styles.label}>Come ti senti?</Text>
        <View style={styles.moodRow}>
          {MOODS.map((m) => (
            <Pressable
              key={m.key}
              testID={`mood-${m.key}`}
              onPress={() => setMood(m.key)}
              style={[styles.moodChip, mood === m.key && styles.moodChipActive]}
            >
              <Text style={styles.moodEmoji}>{m.emoji}</Text>
              <Text style={[styles.moodLabel, mood === m.key && styles.moodLabelActive]}>{m.label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Com&apos;è andata oggi?</Text>
        <TextInput
          testID="checkin-summary"
          value={summary}
          onChangeText={setSummary}
          placeholder="Raccontami la tua giornata..."
          placeholderTextColor={colors.muted}
          style={styles.input}
          multiline
        />

        <Text style={styles.label}>Ostacoli incontrati? (opzionale)</Text>
        <TextInput
          testID="checkin-obstacles"
          value={obstacles}
          onChangeText={setObstacles}
          placeholder="Cosa ti ha rallentato?"
          placeholderTextColor={colors.muted}
          style={styles.input}
          multiline
        />

        <PrimaryButton
          testID="checkin-submit-button"
          label="Invia al coach"
          loading={checkinMut.isPending}
          disabled={!mood || !summary.trim()}
          onPress={() => checkinMut.mutate()}
          style={{ marginTop: spacing.xl }}
        />
      </KeyboardAwareScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.surface },
  centered: { alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: { color: colors.onSurface, fontFamily: fonts.bold, fontSize: 17 },

  progressCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  progressText: { flex: 1, color: colors.onSurface, fontFamily: fonts.semibold, fontSize: 15 },

  label: { color: colors.onSurface, fontFamily: fonts.bold, fontSize: 15, marginTop: spacing.xl, marginBottom: spacing.md },
  moodRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  moodChip: {
    alignItems: "center",
    gap: 2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1.5,
    borderColor: colors.border,
    minWidth: 66,
  },
  moodChipActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandSecondary },
  moodEmoji: { fontSize: 22 },
  moodLabel: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 11 },
  moodLabelActive: { color: colors.onBrandSecondary },

  input: {
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    padding: spacing.lg,
    fontFamily: fonts.medium,
    fontSize: 15,
    color: colors.onSurface,
    minHeight: 90,
    textAlignVertical: "top",
  },

  resultContent: { flex: 1, padding: spacing.xl, alignItems: "center", justifyContent: "center" },
  resultIcon: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center", marginBottom: spacing.lg },
  resultTitle: { color: colors.onSurface, fontFamily: fonts.extrabold, fontSize: 22, marginBottom: spacing.lg },
  feedbackCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 1.5,
    borderColor: colors.brandTertiary,
    alignSelf: "stretch",
  },
  feedbackText: { color: colors.onSurfaceSecondary, fontFamily: fonts.medium, fontSize: 15, lineHeight: 23 },
}));
