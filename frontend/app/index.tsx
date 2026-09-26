import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";

import { useAuth } from "@/src/context/auth";
import { useTheme } from "@/src/theme";

export default function Index() {
  const { user, loading } = useAuth();
  const { colors } = useTheme();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface }}>
        <ActivityIndicator size="large" color={colors.brandPrimary} />
      </View>
    );
  }

  if (!user) return <Redirect href="/auth" />;
  return <Redirect href="/home" />;
}
