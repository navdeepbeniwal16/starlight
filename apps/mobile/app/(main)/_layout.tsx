import { Redirect, Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@clerk/expo";
import { colors } from "../../lib/theme";

export default function MainLayout() {
    const insets = useSafeAreaInsets();
    const { isLoaded, isSignedIn } = useAuth();

    if (!isLoaded) return null;
    // Declarative sign-out: when logout clears the Clerk session this guard
    // redirects to auth — no imperative navigation on the logout button.
    if (!isSignedIn) return <Redirect href="/(auth)/login" />;

    return (
        <Tabs
            screenOptions={{
                headerShown: false,
                tabBarActiveTintColor: colors.text.primary,
                tabBarInactiveTintColor: colors.text.secondary,
                tabBarStyle: {
                    backgroundColor: colors.surface.raised,
                    borderTopColor: colors.border.hairline,
                    borderTopWidth: 1,
                    height: 52 + insets.bottom,
                    paddingTop: 8,
                    paddingBottom: insets.bottom + 6,
                },
                tabBarLabelStyle: {
                    fontSize: 12,
                    fontWeight: '500',
                },
            }}
        >
            <Tabs.Screen
                name="index"
                options={{
                    title: 'Today',
                    tabBarIcon: ({ color, focused }) => (
                        <Ionicons name={focused ? 'today' : 'today-outline'} size={24} color={color} />
                    ),
                }}
            />
            <Tabs.Screen
                name="backlog"
                options={{
                    title: 'Backlog',
                    tabBarIcon: ({ color, focused }) => (
                        <Ionicons name={focused ? 'list' : 'list-outline'} size={24} color={color} />
                    ),
                }}
            />
            {/* PROTOTYPE (proto/sta-16-backlog-projects-merge): Projects is merged into
                the Backlog tab, so its standalone tab is hidden. `href: null` keeps the
                route valid while removing it from the bar. Restore this block to undo. */}
            <Tabs.Screen
                name="projects"
                options={{
                    href: null,
                    title: 'Projects',
                    tabBarIcon: ({ color, focused }) => (
                        <Ionicons name={focused ? 'folder' : 'folder-outline'} size={24} color={color} />
                    ),
                }}
            />
            <Tabs.Screen
                name="settings"
                options={{
                    title: 'Settings',
                    tabBarIcon: ({ color, focused }) => (
                        <Ionicons name={focused ? 'settings' : 'settings-outline'} size={24} color={color} />
                    ),
                }}
            />
        </Tabs>
    );
}
