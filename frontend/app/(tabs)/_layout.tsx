import { Redirect, Tabs } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { Platform } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { ChartLineUp, ChatCircleDots, House, User } from "phosphor-react-native";

import { subscriptionStatus } from "@/src/api/client";
import { useAuth } from "@/src/context/auth";
import { usesNativeTabs } from "@/src/navigation";
import { fonts, useTheme } from "@/src/theme";

export default function TabsLayout() {
  const { user, loading } = useAuth();
  const { colors } = useTheme();

  const statusQ = useQuery({
    queryKey: ["subscription"],
    queryFn: subscriptionStatus,
    enabled: !!user,
  });

  if (loading) return null;
  if (!user) return <Redirect href="/auth" />;
  if (statusQ.data?.paywall) return <Redirect href="/paywall" />;

  if (usesNativeTabs) {
    return (
      <NativeTabs>
        <NativeTabs.Trigger name="home">
          <NativeTabs.Trigger.Icon sf="house.fill" />
          <NativeTabs.Trigger.Label>Piano</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="progress">
          <NativeTabs.Trigger.Icon sf="chart.line.uptrend.xyaxis" />
          <NativeTabs.Trigger.Label>Progressi</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="coach">
          <NativeTabs.Trigger.Icon sf="bubble.left.and.bubble.right.fill" />
          <NativeTabs.Trigger.Label>Coach</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="profile">
          <NativeTabs.Trigger.Icon sf="person.fill" />
          <NativeTabs.Trigger.Label>Profilo</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      </NativeTabs>
    );
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brandPrimary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surfaceSecondary,
          borderTopColor: colors.border,
          ...(Platform.OS === "web" ? { height: 64 } : {}),
        },
        tabBarItemStyle: { alignSelf: "center" },
        tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 11 },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: "Piano",
          tabBarIcon: ({ color, focused }) => <House color={color} size={26} weight={focused ? "fill" : "regular"} />,
        }}
      />
      <Tabs.Screen
        name="progress"
        options={{
          title: "Progressi",
          tabBarIcon: ({ color, focused }) => <ChartLineUp color={color} size={26} weight={focused ? "fill" : "regular"} />,
        }}
      />
      <Tabs.Screen
        name="coach"
        options={{
          title: "Coach",
          tabBarIcon: ({ color, focused }) => <ChatCircleDots color={color} size={26} weight={focused ? "fill" : "regular"} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profilo",
          tabBarIcon: ({ color, focused }) => <User color={color} size={26} weight={focused ? "fill" : "regular"} />,
        }}
      />
    </Tabs>
  );
}
