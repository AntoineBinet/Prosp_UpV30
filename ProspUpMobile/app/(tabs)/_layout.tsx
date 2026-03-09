import { Tabs } from "expo-router";
import { Text } from "react-native";
import { useTheme } from "../../hooks/useTheme";

function TabIcon({ emoji, focused }: { emoji: string; focused: boolean }) {
  return (
    <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.5 }}>
      {emoji}
    </Text>
  );
}

export default function TabsLayout() {
  const colors = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: "700" },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textSecondary,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Dashboard",
          tabBarIcon: ({ focused }) => (
            <TabIcon emoji={"\ud83d\udcca"} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="prospects"
        options={{
          title: "Prospects",
          tabBarIcon: ({ focused }) => (
            <TabIcon emoji={"\ud83d\udc65"} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="focus"
        options={{
          title: "Focus",
          tabBarIcon: ({ focused }) => (
            <TabIcon emoji={"\ud83c\udfaf"} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: "Recherche",
          tabBarIcon: ({ focused }) => (
            <TabIcon emoji={"\ud83d\udd0d"} focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}
