import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useState } from "react";
import * as Haptics from "expo-haptics";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CheckCircle, ChatCircleDots, Circle, ClipboardText, Clock, Fire, Lightning, Target } from "phosphor-react-native";

import { ProgressRing } from "@/src/components/progress-ring";
import { useToast } from "@/src/components/toast";
import { PrimaryButton } from "@/src/components/ui";
import {
  createGoal,
  getActiveGoal,
  getProgress,
  getToday,
  logTask,
  subscriptionStatus,
} from "@/src/api/client";
import { useAuth } from "@/src/context/auth";
import { usesNativeTabs } from "@/src/navigation";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const HERO_BG =
  "https://images.unsplash.com/photo-1548504773-429e84f586d2?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDk1ODB8MHwxfHNlYXJjaHwxfHxhYnN0cmFjdCUyMG9yYW5nZSUyMGVuZXJnZXRpYyUyMHZpYnJhbnQlMjB3YXZlcyUyMGJhY2tncm91bmR8ZW58MHx8fHwxNzkwNDM1MzMwfDA&ixlib=rb-4.1.0&q=85";

type Task = {
  task_id: string;
  time: string;
  title: string;
  description: string;
  metric_label: string;
  metric_target: number | null;
  metric_unit: string;
  completed: boolean;
  metric_value: number | null;
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function HomeScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();

  const goalQ = useQuery({ queryKey: ["activeGoal"], queryFn: getActiveGoal });
  const goal = goalQ.data?.goal;
  const goalId: string | undefined = goal?.goal_id;
  const isActive = goal?.status === "active";

  const subQ = useQuery({ queryKey: ["subscription"], queryFn: subscriptionStatus });

  const todayQ = useQuery({
    queryKey: ["today", goalId],
    queryFn: () => getToday(goalId!),
    enabled: !!goalId && isActive,
  });
  const progressQ = useQuery({
    queryKey: ["progress", goalId],
    queryFn: () => getProgress(goalId!),
    enabled: !!goalId && isActive,
  });

  const createMut = useMutation({
    mutationFn: createGoal,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["activeGoal"] });
      router.push("/onboarding");
    },
    onError: (e: any) => toast(e?.message || "Errore", "error"),
  });

  const logMut = useMutation({
    mutationFn: ({ taskId, completed, value }: { taskId: string; completed: boolean; value: number | null }) =>
      logTask(goalId!, taskId, { date: todayISO(), completed, metric_value: value }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["today", goalId] });
      qc.invalidateQueries({ queryKey: ["progress", goalId] });
    },
  });

  const [metricTask, setMetricTask] = useState<Task | null>(null);
  const [metricValue, setMetricValue] = useState("");

  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const firstName = user?.name?.split(" ")[0] || "Campione";

  const handleToggle = (task: Task) => {
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (!task.completed && task.metric_label) {
      setMetricTask(task);
      setMetricValue(task.metric_value != null ? String(task.metric_value) : "");
      return;
    }
    logMut.mutate({ taskId: task.task_id, completed: !task.completed, value: task.metric_value });
  };

  const saveMetric = () => {
    if (!metricTask) return;
    const v = parseFloat(metricValue.replace(",", "."));
    logMut.mutate({ taskId: metricTask.task_id, completed: true, value: isNaN(v) ? null : v });
    setMetricTask(null);
  };

  // ---------- render header ----------
  const Header = (
    <View style={[styles.topbar, { paddingTop: insets.top + spacing.sm }]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.hello}>Ciao, {firstName} 👋</Text>
        <Text style={styles.date}>{new Date().toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" })}</Text>
      </View>
      <Pressable testID="home-sos-button" onPress={() => router.push(subQ.data?.paywall ? "/paywall" : "/sos")} style={styles.sosPill}>
        <Lightning color={colors.onError} size={16} weight="fill" />
        <Text style={styles.sosText}>SOS</Text>
      </Pressable>
      {isActive && progressQ.data ? (
        <View style={styles.streakPill} testID="streak-pill">
          <Fire color={colors.brandPrimary} size={18} weight="fill" />
          <Text style={styles.streakText}>{progressQ.data.streak}</Text>
        </View>
      ) : null}
    </View>
  );

  const TrialBanner =
    subQ.data?.level === "trial" && subQ.data?.days_left != null ? (
      <View style={styles.trialBanner} testID="trial-banner">
        <Text style={styles.trialText}>
          Prova gratuita: {subQ.data.days_left} {subQ.data.days_left === 1 ? "giorno rimasto" : "giorni rimasti"}
        </Text>
      </View>
    ) : null;

  if (goalQ.isLoading) {
    return (
      <View style={styles.screen}>
        {Header}
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
        </View>
      </View>
    );
  }

  // ---------- no goal ----------
  if (!goal) {
    return (
      <View style={styles.screen} testID="home-empty">
        {Header}
        <View style={styles.centered}>
          <Image source={require("../../assets/images/icon.png")} style={styles.emptyImg} contentFit="contain" />
          <Text style={styles.emptyTitle}>Definisci il tuo primo obiettivo</Text>
          <Text style={styles.emptyText}>
            Parla con il coach: farà qualche domanda e creerà per te un piano quotidiano su misura.
          </Text>
          <PrimaryButton
            testID="create-goal-button"
            label="Inizia con il coach"
            loading={createMut.isPending}
            onPress={() => createMut.mutate()}
            style={{ marginTop: spacing.xl, alignSelf: "stretch" }}
          />
        </View>
      </View>
    );
  }

  // ---------- interviewing ----------
  if (goal.status === "interviewing") {
    return (
      <View style={styles.screen} testID="home-interviewing">
        {Header}
        <View style={styles.centered}>
          <View style={styles.iconCircle}>
            <ChatCircleDots color={colors.brandPrimary} size={40} weight="fill" />
          </View>
          <Text style={styles.emptyTitle}>Completa la configurazione</Text>
          <Text style={styles.emptyText}>
            Il coach ha bisogno di qualche informazione in più per creare il tuo piano d&apos;azione.
          </Text>
          <PrimaryButton
            testID="continue-onboarding-button"
            label="Riprendi con il coach"
            onPress={() => router.push("/onboarding")}
            style={{ marginTop: spacing.xl, alignSelf: "stretch" }}
          />
        </View>
      </View>
    );
  }

  // ---------- active plan ----------
  const tasks: Task[] = todayQ.data?.tasks || [];
  const completed = todayQ.data?.completed || 0;
  const total = todayQ.data?.total || 0;
  const pct = total ? completed / total : 0;

  let daysLeft = 0;
  if (goal.target_date) {
    const diff = Math.ceil((new Date(goal.target_date).getTime() - Date.now()) / 86400000);
    daysLeft = Math.max(0, diff);
  }

  return (
    <View style={styles.screen} testID="home-active">
      {Header}
      {TrialBanner}
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] + bottomChrome }}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <View style={styles.hero} testID="goal-hero">
          <Image source={{ uri: HERO_BG }} style={styles.heroBg} contentFit="cover" />
          <LinearGradient
            colors={["rgba(139,92,246,0.85)", "rgba(79,70,229,0.92)"]}
            style={styles.heroScrim}
          />
          <View style={styles.heroContent}>
            <View style={{ flex: 1, paddingRight: spacing.md }}>
              <View style={styles.heroBadge}>
                <Target color={colors.onBrandPrimary} size={14} weight="fill" />
                <Text style={styles.heroBadgeText}>Obiettivo</Text>
              </View>
              <Text style={styles.heroTitle} numberOfLines={3}>{goal.title}</Text>
              <Text style={styles.heroDays}>{daysLeft} giorni rimasti</Text>
            </View>
            <ProgressRing
              size={104}
              strokeWidth={10}
              progress={pct}
              label={`${Math.round(pct * 100)}%`}
              sublabel="oggi"
            />
          </View>
        </View>

        {goal.target_summary ? (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryText}>{goal.target_summary}</Text>
          </View>
        ) : null}

        {/* Today tasks */}
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Oggi</Text>
          <Text style={styles.sectionCount}>{completed}/{total}</Text>
        </View>

        {todayQ.isLoading ? (
          <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} />
        ) : tasks.length === 0 ? (
          <View style={styles.noTasks}>
            <ClipboardText color={colors.muted} size={32} />
            <Text style={styles.emptyText}>Nessuna attività per oggi.</Text>
          </View>
        ) : (
          tasks.map((task) => (
            <Pressable
              key={task.task_id}
              testID={`task-card-${task.task_id}`}
              onPress={() => handleToggle(task)}
              style={({ pressed }) => [styles.taskCard, pressed && styles.taskPressed]}
            >
              <Pressable
                onPress={() => handleToggle(task)}
                hitSlop={12}
                testID={`task-check-${task.task_id}`}
                style={styles.checkBox}
              >
                {task.completed ? (
                  <CheckCircle color={colors.success} size={34} weight="fill" />
                ) : (
                  <Circle color={colors.borderStrong} size={34} weight="regular" />
                )}
              </Pressable>
              <View style={{ flex: 1 }}>
                <Text style={[styles.taskTitle, task.completed && styles.taskDone]} numberOfLines={2}>
                  {task.title}
                </Text>
                {task.description ? (
                  <Text style={styles.taskDesc} numberOfLines={2}>{task.description}</Text>
                ) : null}
                <View style={styles.taskMeta}>
                  {task.time ? (
                    <View style={styles.metaPill}>
                      <Clock color={colors.onSurfaceTertiary} size={13} weight="bold" />
                      <Text style={styles.metaText}>{task.time}</Text>
                    </View>
                  ) : null}
                  {task.metric_label ? (
                    <View style={styles.metricPill}>
                      <Text style={styles.metricText}>
                        {task.metric_value != null ? `${task.metric_value}` : "0"}
                        {task.metric_target != null ? `/${task.metric_target}` : ""} {task.metric_unit}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </Pressable>
          ))
        )}
      </ScrollView>

      {/* Check-in FAB */}
      <Pressable
        testID="checkin-fab"
        onPress={() => router.push("/checkin")}
        style={({ pressed }) => [styles.fab, { bottom: bottomChrome + spacing.lg }, pressed && styles.taskPressed]}
      >
        <ClipboardText color={colors.onBrandPrimary} size={22} weight="fill" />
        <Text style={styles.fabText}>Check-in</Text>
      </Pressable>

      {/* Metric input modal */}
      <Modal visible={!!metricTask} transparent animationType="fade" onRequestClose={() => setMetricTask(null)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.modalOverlay}
        >
          <Pressable style={styles.modalBackdrop} onPress={() => setMetricTask(null)} />
          <View style={styles.modalCard} testID="metric-modal">
            <Text style={styles.modalTitle}>{metricTask?.title}</Text>
            <Text style={styles.modalLabel}>{metricTask?.metric_label}</Text>
            <TextInput
              testID="metric-input"
              value={metricValue}
              onChangeText={setMetricValue}
              keyboardType="numeric"
              placeholder={metricTask?.metric_target != null ? `Obiettivo: ${metricTask?.metric_target}` : "0"}
              placeholderTextColor={colors.muted}
              style={styles.modalInput}
              autoFocus
            />
            <PrimaryButton testID="metric-save-button" label="Salva" onPress={saveMetric} />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.surface },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  topbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    backgroundColor: colors.surface,
  },
  hello: { color: colors.onSurface, fontFamily: fonts.extrabold, fontSize: 22 },
  date: { color: colors.muted, fontFamily: fonts.medium, fontSize: 13, textTransform: "capitalize" },
  sosPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.error,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  sosText: { color: colors.onError, fontFamily: fonts.extrabold, fontSize: 13 },
  trialBanner: {
    backgroundColor: colors.brandTertiary,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    alignItems: "center",
  },
  trialText: { color: colors.onBrandTertiary, fontFamily: fonts.bold, fontSize: 13 },
  streakPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.brandSecondary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  streakText: { color: colors.onBrandSecondary, fontFamily: fonts.extrabold, fontSize: 15 },

  emptyImg: { width: 96, height: 96, marginBottom: spacing.lg },
  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.brandSecondary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  emptyTitle: { color: colors.onSurface, fontFamily: fonts.bold, fontSize: 22, textAlign: "center" },
  emptyText: {
    color: colors.muted,
    fontFamily: fonts.medium,
    fontSize: 15,
    textAlign: "center",
    marginTop: spacing.sm,
    lineHeight: 22,
  },

  hero: {
    borderRadius: radius.lg,
    overflow: "hidden",
    minHeight: 150,
    justifyContent: "center",
  },
  heroBg: { ...abs() },
  heroScrim: { ...abs() },
  heroContent: { flexDirection: "row", alignItems: "center", padding: spacing.lg },
  heroBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.25)",
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  heroBadgeText: { color: colors.onBrandPrimary, fontFamily: fonts.bold, fontSize: 11 },
  heroTitle: { color: colors.onBrandPrimary, fontFamily: fonts.extrabold, fontSize: 20, marginTop: spacing.sm, lineHeight: 25 },
  heroDays: { color: colors.onBrandPrimary, fontFamily: fonts.semibold, fontSize: 13, marginTop: spacing.xs, opacity: 0.9 },

  summaryCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  summaryText: { color: colors.onSurfaceSecondary, fontFamily: fonts.medium, fontSize: 14, lineHeight: 21 },

  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  sectionTitle: { color: colors.onSurface, fontFamily: fonts.extrabold, fontSize: 20 },
  sectionCount: { color: colors.brandPrimary, fontFamily: fonts.bold, fontSize: 16 },

  noTasks: { alignItems: "center", padding: spacing.xl, gap: spacing.sm },

  taskCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  taskPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  checkBox: { width: 40, alignItems: "center", justifyContent: "center" },
  taskTitle: { color: colors.onSurface, fontFamily: fonts.bold, fontSize: 16 },
  taskDone: { textDecorationLine: "line-through", color: colors.muted },
  taskDesc: { color: colors.muted, fontFamily: fonts.regular, fontSize: 13, marginTop: 2, lineHeight: 18 },
  taskMeta: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm, flexWrap: "wrap" },
  metaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.surfaceTertiary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  metaText: { color: colors.onSurfaceTertiary, fontFamily: fonts.semibold, fontSize: 12 },
  metricPill: {
    backgroundColor: colors.brandSecondary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  metricText: { color: colors.onBrandSecondary, fontFamily: fonts.bold, fontSize: 12 },

  fab: {
    position: "absolute",
    right: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    shadowColor: colors.brandPrimary,
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  fabText: { color: colors.onBrandPrimary, fontFamily: fonts.bold, fontSize: 15 },

  modalOverlay: { flex: 1, justifyContent: "center", padding: spacing.xl },
  modalBackdrop: { ...abs(), backgroundColor: "rgba(17,20,24,0.5)" },
  modalCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.md,
  },
  modalTitle: { color: colors.onSurface, fontFamily: fonts.bold, fontSize: 18 },
  modalLabel: { color: colors.muted, fontFamily: fonts.medium, fontSize: 14 },
  modalInput: {
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontFamily: fonts.bold,
    fontSize: 24,
    color: colors.onSurface,
    textAlign: "center",
  },
}));

function abs() {
  return { position: "absolute" as const, left: 0, right: 0, top: 0, bottom: 0 };
}
