import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { Redirect, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import * as Haptics from "expo-haptics";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CaretLeft, PaperPlaneRight, Sparkle } from "phosphor-react-native";

import { useToast } from "@/src/components/toast";
import { PrimaryButton } from "@/src/components/ui";
import { generatePlan, getActiveGoal, getMessages, postMessage } from "@/src/api/client";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const AI_AVATAR =
  "https://images.unsplash.com/photo-1740252117070-7aa2955b25f8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1NjZ8MHwxfHNlYXJjaHwxfHxmcmllbmRseSUyMHJvYm90JTIwZmFjZSUyMGF2YXRhciUyMDNkfGVufDB8fHx8MTc5MDQzNTMzMHww&ixlib=rb-4.1.0&q=85";

const SUGGESTIONS = ["Voglio dimagrire", "Migliorare nel lavoro", "Imparare una lingua", "Correre una 10km"];

type Message = { message_id: string; role: string; content: string };

export default function Onboarding() {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const scrollRef = useRef<ScrollView>(null);

  const [input, setInput] = useState("");
  const [ready, setReady] = useState(false);

  const goalQ = useQuery({ queryKey: ["activeGoal"], queryFn: getActiveGoal });
  const goal = goalQ.data?.goal;
  const goalId: string | undefined = goal?.goal_id;

  const msgQ = useQuery({
    queryKey: ["messages", goalId],
    queryFn: () => getMessages(goalId!),
    enabled: !!goalId,
  });
  const messages: Message[] = msgQ.data?.messages || [];

  const sendMut = useMutation({
    mutationFn: (content: string) => postMessage(goalId!, content),
    onSuccess: (data) => {
      if (data.ready_to_generate) setReady(true);
      qc.invalidateQueries({ queryKey: ["messages", goalId] });
    },
    onError: (e: any) => toast(e?.message || "Errore invio", "error"),
  });

  const planMut = useMutation({
    mutationFn: () => generatePlan(goalId!),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["activeGoal"] });
      toast("Piano creato! 🚀", "success");
      router.replace("/home");
    },
    onError: (e: any) => toast(e?.message || "Errore generazione piano", "error"),
  });

  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    return () => clearTimeout(t);
  }, [messages.length, sendMut.isPending]);

  if (goalQ.isLoading) {
    return (
      <View style={[styles.screen, styles.centered]}>
        <ActivityIndicator size="large" color={colors.brandPrimary} />
      </View>
    );
  }
  if (!goal) return <Redirect href="/home" />;
  if (goal.status === "active" && !planMut.isPending) return <Redirect href="/home" />;

  const send = (text: string) => {
    const t = text.trim();
    if (!t || sendMut.isPending) return;
    setInput("");
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // optimistic append
    qc.setQueryData(["messages", goalId], (old: any) => ({
      messages: [...(old?.messages || []), { message_id: `tmp_${Date.now()}`, role: "user", content: t }],
    }));
    sendMut.mutate(t);
  };

  return (
    <View style={styles.screen} testID="onboarding-screen">
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.replace("/home")} hitSlop={12} testID="onboarding-back">
          <CaretLeft color={colors.onSurface} size={26} weight="bold" />
        </Pressable>
        <View style={styles.headerCenter}>
          <Image source={{ uri: AI_AVATAR }} style={styles.avatar} contentFit="cover" />
          <View>
            <Text style={styles.headerTitle}>Coach</Text>
            <Text style={styles.headerSub}>Intervista iniziale</Text>
          </View>
        </View>
        <View style={{ width: 26 }} />
      </View>

      <KeyboardAvoidingView
        behavior="translate-with-padding"
        keyboardVerticalOffset={0}
        style={{ flex: 1 }}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.lg }}
          showsVerticalScrollIndicator={false}
        >
          {messages.map((m) => (
            <View
              key={m.message_id}
              testID={`msg-${m.role}`}
              style={[styles.bubbleRow, m.role === "user" ? styles.rowRight : styles.rowLeft]}
            >
              <View style={[styles.bubble, m.role === "user" ? styles.userBubble : styles.aiBubble]}>
                <Text style={[styles.bubbleText, m.role === "user" ? styles.userText : styles.aiText]}>
                  {m.content}
                </Text>
              </View>
            </View>
          ))}
          {sendMut.isPending ? (
            <View style={[styles.bubbleRow, styles.rowLeft]}>
              <View style={[styles.bubble, styles.aiBubble]}>
                <ActivityIndicator color={colors.brandPrimary} />
              </View>
            </View>
          ) : null}

          {ready ? (
            <View style={styles.readyCard} testID="ready-card">
              <Sparkle color={colors.brandPrimary} size={28} weight="fill" />
              <Text style={styles.readyTitle}>Ho tutte le informazioni!</Text>
              <Text style={styles.readyText}>Genero il tuo piano d&apos;azione quotidiano personalizzato.</Text>
              <PrimaryButton
                testID="generate-plan-button"
                label="Genera il mio piano"
                loading={planMut.isPending}
                onPress={() => planMut.mutate()}
                style={{ alignSelf: "stretch", marginTop: spacing.md }}
              />
            </View>
          ) : null}
        </ScrollView>

        {!ready ? (
          <View style={[styles.inputWrap, { paddingBottom: insets.bottom + spacing.sm }]}>
            {messages.length <= 1 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}
              >
                {SUGGESTIONS.map((s) => (
                  <Pressable key={s} onPress={() => send(s)} style={styles.suggestion} testID={`suggestion-${s}`}>
                    <Text style={styles.suggestionText}>{s}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}
            <View style={styles.inputRow}>
              <TextInput
                testID="chat-input"
                value={input}
                onChangeText={setInput}
                placeholder="Scrivi al coach..."
                placeholderTextColor={colors.muted}
                style={styles.input}
                multiline
                onSubmitEditing={() => send(input)}
              />
              <Pressable
                testID="chat-send-button"
                onPress={() => send(input)}
                disabled={!input.trim() || sendMut.isPending}
                style={[styles.sendBtn, (!input.trim() || sendMut.isPending) && styles.sendDisabled]}
              >
                <PaperPlaneRight color={colors.onBrandPrimary} size={22} weight="fill" />
              </Pressable>
            </View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
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
  headerCenter: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandSecondary },
  headerTitle: { color: colors.onSurface, fontFamily: fonts.bold, fontSize: 16 },
  headerSub: { color: colors.muted, fontFamily: fonts.medium, fontSize: 12 },

  bubbleRow: { marginBottom: spacing.md, flexDirection: "row" },
  rowLeft: { justifyContent: "flex-start" },
  rowRight: { justifyContent: "flex-end" },
  bubble: { maxWidth: "82%", borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  aiBubble: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, borderTopLeftRadius: spacing.xs },
  userBubble: { backgroundColor: colors.brandSecondary, borderTopRightRadius: spacing.xs },
  bubbleText: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 22 },
  aiText: { color: colors.onSurfaceSecondary },
  userText: { color: colors.onBrandSecondary },

  readyCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: colors.brandTertiary,
    marginTop: spacing.sm,
  },
  readyTitle: { color: colors.onSurface, fontFamily: fonts.bold, fontSize: 18, marginTop: spacing.sm },
  readyText: { color: colors.muted, fontFamily: fonts.medium, fontSize: 14, textAlign: "center", marginTop: spacing.xs },

  inputWrap: { backgroundColor: colors.surfaceSecondary, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
  suggestion: {
    backgroundColor: colors.brandSecondary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    flexShrink: 0,
  },
  suggestionText: { color: colors.onBrandSecondary, fontFamily: fonts.semibold, fontSize: 13 },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, paddingHorizontal: spacing.lg },
  input: {
    flex: 1,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    fontFamily: fonts.medium,
    fontSize: 15,
    color: colors.onSurface,
    maxHeight: 120,
  },
  sendBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendDisabled: { opacity: 0.5 },
}));
