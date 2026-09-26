import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
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
import { ChatCircleDots, PaperPlaneRight } from "phosphor-react-native";

import { useToast } from "@/src/components/toast";
import { PrimaryButton } from "@/src/components/ui";
import { getActiveGoal, getMessages, postMessage } from "@/src/api/client";
import { usesNativeTabs } from "@/src/navigation";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

type Message = { message_id: string; role: string; content: string };

export default function CoachScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const scrollRef = useRef<ScrollView>(null);
  const [input, setInput] = useState("");

  const goalQ = useQuery({ queryKey: ["activeGoal"], queryFn: getActiveGoal });
  const goal = goalQ.data?.goal;
  const goalId: string | undefined = goal?.goal_id;
  const isActive = goal?.status === "active";

  const msgQ = useQuery({
    queryKey: ["messages", goalId],
    queryFn: () => getMessages(goalId!),
    enabled: !!goalId && isActive,
  });
  const messages: Message[] = msgQ.data?.messages || [];

  const sendMut = useMutation({
    mutationFn: (content: string) => postMessage(goalId!, content),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["messages", goalId] }),
    onError: (e: any) => toast(e?.message || "Errore invio", "error"),
  });

  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    return () => clearTimeout(t);
  }, [messages.length, sendMut.isPending]);

  const bottomChrome = usesNativeTabs ? insets.bottom : 0;

  const Header = (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      <Text style={styles.headerTitle}>Il tuo Coach</Text>
      <Text style={styles.headerSub}>Chiedi consigli e resta motivato</Text>
    </View>
  );

  if (goalQ.isLoading) {
    return (
      <View style={styles.screen}>
        {Header}
        <View style={styles.centered}><ActivityIndicator size="large" color={colors.brandPrimary} /></View>
      </View>
    );
  }

  if (!goal) {
    return (
      <View style={styles.screen}>
        {Header}
        <View style={styles.centered}>
          <ChatCircleDots color={colors.muted} size={44} />
          <Text style={styles.emptyText}>Crea prima un obiettivo dalla schermata Piano.</Text>
        </View>
      </View>
    );
  }

  if (!isActive) {
    return (
      <View style={styles.screen}>
        {Header}
        <View style={styles.centered}>
          <ChatCircleDots color={colors.brandPrimary} size={44} weight="fill" />
          <Text style={styles.emptyText}>Completa prima la configurazione con il coach.</Text>
          <PrimaryButton
            testID="coach-goto-onboarding"
            label="Riprendi configurazione"
            onPress={() => router.push("/onboarding")}
            style={{ marginTop: spacing.lg, alignSelf: "stretch" }}
          />
        </View>
      </View>
    );
  }

  const send = () => {
    const t = input.trim();
    if (!t || sendMut.isPending) return;
    setInput("");
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    qc.setQueryData(["messages", goalId], (old: any) => ({
      messages: [...(old?.messages || []), { message_id: `tmp_${Date.now()}`, role: "user", content: t }],
    }));
    sendMut.mutate(t);
  };

  return (
    <View style={styles.screen} testID="coach-screen">
      {Header}
      <KeyboardAvoidingView behavior="translate-with-padding" style={{ flex: 1 }}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ padding: spacing.lg }}
          showsVerticalScrollIndicator={false}
        >
          {messages.map((m) => (
            <View key={m.message_id} style={[styles.bubbleRow, m.role === "user" ? styles.rowRight : styles.rowLeft]}>
              <View style={[styles.bubble, m.role === "user" ? styles.userBubble : styles.aiBubble]}>
                <Text style={[styles.bubbleText, m.role === "user" ? styles.userText : styles.aiText]}>{m.content}</Text>
              </View>
            </View>
          ))}
          {sendMut.isPending ? (
            <View style={[styles.bubbleRow, styles.rowLeft]}>
              <View style={[styles.bubble, styles.aiBubble]}><ActivityIndicator color={colors.brandPrimary} /></View>
            </View>
          ) : null}
        </ScrollView>

        <View style={[styles.inputRow, { paddingBottom: bottomChrome + spacing.sm }]}>
          <TextInput
            testID="coach-input"
            value={input}
            onChangeText={setInput}
            placeholder="Scrivi al coach..."
            placeholderTextColor={colors.muted}
            style={styles.input}
            multiline
          />
          <Pressable
            testID="coach-send-button"
            onPress={send}
            disabled={!input.trim() || sendMut.isPending}
            style={[styles.sendBtn, (!input.trim() || sendMut.isPending) && styles.sendDisabled]}
          >
            <PaperPlaneRight color={colors.onBrandPrimary} size={22} weight="fill" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.surface },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  emptyText: { color: colors.muted, fontFamily: fonts.medium, fontSize: 15, textAlign: "center", lineHeight: 22 },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: { color: colors.onSurface, fontFamily: fonts.extrabold, fontSize: 22 },
  headerSub: { color: colors.muted, fontFamily: fonts.medium, fontSize: 13 },

  bubbleRow: { marginBottom: spacing.md, flexDirection: "row" },
  rowLeft: { justifyContent: "flex-start" },
  rowRight: { justifyContent: "flex-end" },
  bubble: { maxWidth: "82%", borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  aiBubble: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, borderTopLeftRadius: spacing.xs },
  userBubble: { backgroundColor: colors.brandSecondary, borderTopRightRadius: spacing.xs },
  bubbleText: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 22 },
  aiText: { color: colors.onSurfaceSecondary },
  userText: { color: colors.onBrandSecondary },

  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    backgroundColor: colors.surfaceSecondary,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontFamily: fonts.medium,
    fontSize: 15,
    color: colors.onSurface,
    maxHeight: 120,
  },
  sendBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  sendDisabled: { opacity: 0.5 },
}));
