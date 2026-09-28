import { useMutation } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CaretLeft, Lightning } from "phosphor-react-native";

import { useToast } from "@/src/components/toast";
import { PrimaryButton } from "@/src/components/ui";
import { coachSos } from "@/src/api/client";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const QUICK = [
  "Non ho voglia di iniziare",
  "Mi sento sopraffatto",
  "Ho perso la motivazione",
  "Non ho tempo oggi",
];

export default function SosScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const [issue, setIssue] = useState("");
  const [result, setResult] = useState<string | null>(null);

  const sosMut = useMutation({
    mutationFn: (text: string) => coachSos(text),
    onSuccess: (data) => {
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setResult(data.coaching);
    },
    onError: (e: any) => toast(e?.message || "Errore", "error"),
  });

  const run = (text: string) => {
    const t = text.trim();
    if (!t) return;
    setIssue(t);
    sosMut.mutate(t);
  };

  return (
    <View style={styles.screen} testID="sos-screen">
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="sos-back">
          <CaretLeft color={colors.onSurface} size={26} weight="bold" />
        </Pressable>
        <View style={styles.headerBadge}>
          <Lightning color={colors.onError} size={16} weight="fill" />
          <Text style={styles.headerBadgeText}>SOS Coach</Text>
        </View>
        <View style={{ width: 26 }} />
      </View>

      {result ? (
        <ScrollView contentContainerStyle={{ padding: spacing.xl, paddingBottom: insets.bottom + spacing.xl }}>
          <View style={styles.resultIcon}>
            <Lightning color={colors.brandPrimary} size={38} weight="fill" />
          </View>
          <Text style={styles.resultTitle}>Sessione lampo (2 min)</Text>
          <View style={styles.resultCard}>
            <Text style={styles.resultText}>{result}</Text>
          </View>
          <PrimaryButton
            testID="sos-again-button"
            label="Un'altra situazione"
            variant="secondary"
            onPress={() => { setResult(null); setIssue(""); }}
            style={{ marginTop: spacing.lg }}
          />
          <PrimaryButton
            testID="sos-done-button"
            label="Torna al piano"
            onPress={() => router.back()}
            style={{ marginTop: spacing.md }}
          />
        </ScrollView>
      ) : (
        <KeyboardAwareScrollView
          bottomOffset={20}
          contentContainerStyle={{ padding: spacing.xl, paddingBottom: insets.bottom + spacing.xl }}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.title}>Cosa ti blocca adesso?</Text>
          <Text style={styles.sub}>Il coach ti dà una spinta immediata e una micro-azione da fare subito.</Text>

          <View style={styles.chips}>
            {QUICK.map((q) => (
              <Pressable key={q} onPress={() => run(q)} style={styles.chip} testID={`sos-quick-${q}`}>
                <Text style={styles.chipText}>{q}</Text>
              </Pressable>
            ))}
          </View>

          <TextInput
            testID="sos-input"
            value={issue}
            onChangeText={setIssue}
            placeholder="Descrivi la tua situazione..."
            placeholderTextColor={colors.muted}
            style={styles.input}
            multiline
          />
          <PrimaryButton
            testID="sos-run-button"
            label="Ricevi coaching ⚡"
            loading={sosMut.isPending}
            disabled={!issue.trim()}
            onPress={() => run(issue)}
            style={{ marginTop: spacing.lg }}
          />
        </KeyboardAwareScrollView>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.surface },
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
  headerBadge: { flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: colors.error, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill },
  headerBadgeText: { color: colors.onError, fontFamily: fonts.bold, fontSize: 13 },

  title: { color: colors.onSurface, fontFamily: fonts.extrabold, fontSize: 24 },
  sub: { color: colors.muted, fontFamily: fonts.medium, fontSize: 15, marginTop: spacing.sm, lineHeight: 22 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.xl },
  chip: { backgroundColor: colors.brandSecondary, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.pill },
  chipText: { color: colors.onBrandSecondary, fontFamily: fonts.semibold, fontSize: 13 },
  input: {
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    padding: spacing.lg,
    fontFamily: fonts.medium,
    fontSize: 15,
    color: colors.onSurface,
    minHeight: 100,
    textAlignVertical: "top",
    marginTop: spacing.xl,
  },

  resultIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center", alignSelf: "center", marginBottom: spacing.lg },
  resultTitle: { color: colors.onSurface, fontFamily: fonts.extrabold, fontSize: 20, textAlign: "center", marginBottom: spacing.lg },
  resultCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.xl, borderWidth: 1.5, borderColor: colors.brandTertiary },
  resultText: { color: colors.onSurfaceSecondary, fontFamily: fonts.medium, fontSize: 16, lineHeight: 25 },
}));
