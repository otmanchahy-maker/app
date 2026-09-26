import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CheckCircle, Circle, Fire, Flag, Trophy } from "phosphor-react-native";

import { getActiveGoal, getProgress, toggleMilestone } from "@/src/api/client";
import { usesNativeTabs } from "@/src/navigation";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const DAYS = ["D", "L", "M", "M", "G", "V", "S"];

export default function ProgressScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const goalQ = useQuery({ queryKey: ["activeGoal"], queryFn: getActiveGoal });
  const goal = goalQ.data?.goal;
  const goalId: string | undefined = goal?.goal_id;
  const isActive = goal?.status === "active";

  const progQ = useQuery({
    queryKey: ["progress", goalId],
    queryFn: () => getProgress(goalId!),
    enabled: !!goalId && isActive,
  });

  const toggleMut = useMutation({
    mutationFn: (msId: string) => toggleMilestone(goalId!, msId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["progress", goalId] }),
  });

  const bottomChrome = usesNativeTabs ? insets.bottom : 0;

  const Header = (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      <Text style={styles.headerTitle}>I tuoi progressi</Text>
    </View>
  );

  if (goalQ.isLoading || (isActive && progQ.isLoading)) {
    return (
      <View style={styles.screen}>
        {Header}
        <View style={styles.centered}><ActivityIndicator size="large" color={colors.brandPrimary} /></View>
      </View>
    );
  }

  if (!goal || !isActive) {
    return (
      <View style={styles.screen}>
        {Header}
        <View style={styles.centered}>
          <Trophy color={colors.muted} size={44} />
          <Text style={styles.emptyText}>Inizia a completare i task per vedere i tuoi progressi.</Text>
        </View>
      </View>
    );
  }

  const data = progQ.data;
  const series: { date: string; pct: number }[] = data?.series || [];
  const maxPct = Math.max(100, ...series.map((s) => s.pct));
  const milestones = data?.milestones || [];

  return (
    <View style={styles.screen} testID="progress-screen">
      {Header}
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] + bottomChrome }}
        showsVerticalScrollIndicator={false}
      >
        {/* Stats */}
        <View style={styles.statsRow}>
          <View style={[styles.statCard, { backgroundColor: colors.brandPrimary }]}>
            <Fire color={colors.onBrandPrimary} size={26} weight="fill" />
            <Text style={styles.statNumBig}>{data?.streak || 0}</Text>
            <Text style={styles.statLabelLight}>giorni di fila</Text>
          </View>
          <View style={styles.statCol}>
            <View style={styles.statCard}>
              <Text style={styles.statNum}>{data?.total_completed || 0}</Text>
              <Text style={styles.statLabel}>task completati</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statNum}>{data?.active_days || 0}</Text>
              <Text style={styles.statLabel}>giorni attivi</Text>
            </View>
          </View>
        </View>

        {/* 14 day chart */}
        <Text style={styles.sectionTitle}>Ultimi 14 giorni</Text>
        <View style={styles.chartCard}>
          <View style={styles.chart}>
            {series.map((s, i) => {
              const h = Math.max(4, (s.pct / maxPct) * 120);
              const d = new Date(s.date);
              return (
                <View key={s.date} style={styles.barCol}>
                  <View style={styles.barTrack}>
                    <View
                      style={[
                        styles.bar,
                        { height: h, backgroundColor: s.pct >= 100 ? colors.success : colors.brandPrimary },
                      ]}
                    />
                  </View>
                  {i % 2 === 0 ? <Text style={styles.barLabel}>{DAYS[d.getDay()]}</Text> : <Text style={styles.barLabel}> </Text>}
                </View>
              );
            })}
          </View>
        </View>

        {/* Milestones */}
        <Text style={styles.sectionTitle}>Tappe (milestones)</Text>
        {milestones.length === 0 ? (
          <Text style={styles.emptyText}>Nessuna tappa definita.</Text>
        ) : (
          <View style={styles.timeline}>
            {milestones.map((m: any, i: number) => (
              <Pressable
                key={m.milestone_id}
                testID={`milestone-${m.milestone_id}`}
                onPress={() => toggleMut.mutate(m.milestone_id)}
                style={styles.msRow}
              >
                <View style={styles.msNodeWrap}>
                  {m.done ? (
                    <CheckCircle color={colors.success} size={30} weight="fill" />
                  ) : (
                    <Circle color={colors.borderStrong} size={30} weight="regular" />
                  )}
                  {i < milestones.length - 1 ? <View style={styles.msLine} /> : null}
                </View>
                <View style={[styles.msCard, m.done && styles.msCardDone]}>
                  <View style={styles.msHead}>
                    <Flag color={colors.brandPrimary} size={15} weight="fill" />
                    <Text style={styles.msWeek}>Settimana {m.week}</Text>
                  </View>
                  <Text style={[styles.msTitle, m.done && styles.msDoneText]}>{m.title}</Text>
                  {m.target ? <Text style={styles.msTarget}>🎯 {m.target}</Text> : null}
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.surface },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  emptyText: { color: colors.muted, fontFamily: fonts.medium, fontSize: 15, textAlign: "center", lineHeight: 22 },
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, backgroundColor: colors.surface },
  headerTitle: { color: colors.onSurface, fontFamily: fonts.extrabold, fontSize: 26 },

  statsRow: { flexDirection: "row", gap: spacing.md },
  statCol: { flex: 1, gap: spacing.md },
  statCard: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: "center",
  },
  statNumBig: { color: colors.onBrandPrimary, fontFamily: fonts.extrabold, fontSize: 44, marginTop: spacing.sm },
  statLabelLight: { color: colors.onBrandPrimary, fontFamily: fonts.semibold, fontSize: 13, opacity: 0.9 },
  statNum: { color: colors.onSurface, fontFamily: fonts.extrabold, fontSize: 26 },
  statLabel: { color: colors.muted, fontFamily: fonts.medium, fontSize: 12, marginTop: 2 },

  sectionTitle: { color: colors.onSurface, fontFamily: fonts.extrabold, fontSize: 18, marginTop: spacing.xl, marginBottom: spacing.md },
  chartCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chart: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", height: 150 },
  barCol: { flex: 1, alignItems: "center" },
  barTrack: { height: 120, justifyContent: "flex-end" },
  bar: { width: 10, borderRadius: 5 },
  barLabel: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 10, marginTop: spacing.xs },

  timeline: { marginTop: spacing.xs },
  msRow: { flexDirection: "row", gap: spacing.md },
  msNodeWrap: { alignItems: "center", width: 30 },
  msLine: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 2 },
  msCard: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  msCardDone: { backgroundColor: colors.surfaceTertiary },
  msHead: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  msWeek: { color: colors.brandPrimary, fontFamily: fonts.bold, fontSize: 12 },
  msTitle: { color: colors.onSurface, fontFamily: fonts.bold, fontSize: 15, marginTop: spacing.xs },
  msDoneText: { textDecorationLine: "line-through", color: colors.muted },
  msTarget: { color: colors.onSurfaceTertiary, fontFamily: fonts.medium, fontSize: 13, marginTop: spacing.xs },
}));
