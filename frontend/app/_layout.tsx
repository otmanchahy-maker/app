import { QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { LogBox, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/src/components/error-boundary";
import { ToastProvider } from "@/src/components/toast";
import { AuthProvider } from "@/src/context/auth";
import { queryClient } from "@/src/query-client";
import { themes } from "@/src/theme";

LogBox.ignoreAllLogs(true);

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    "Jakarta-Regular": require("../assets/fonts/PlusJakartaSans-Regular.ttf"),
    "Jakarta-Medium": require("../assets/fonts/PlusJakartaSans-Medium.ttf"),
    "Jakarta-SemiBold": require("../assets/fonts/PlusJakartaSans-SemiBold.ttf"),
    "Jakarta-Bold": require("../assets/fonts/PlusJakartaSans-Bold.ttf"),
    "Jakarta-ExtraBold": require("../assets/fonts/PlusJakartaSans-ExtraBold.ttf"),
  });

  // Prewarm: keep native surfaces on the shipped scheme.
  useEffect(() => {}, []);

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: themes.light.surface }} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <KeyboardProvider>
              <AuthProvider>
                <ToastProvider>
                  <StatusBar style="dark" />
                  <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: themes.light.surface } }} />
                </ToastProvider>
              </AuthProvider>
            </KeyboardProvider>
          </QueryClientProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
