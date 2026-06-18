import { Tabs, useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "../../stores/auth.store";

export default function MainLayout() {
    const router = useRouter();
    const user = useAuthStore(state => state.user);
    const prevUserRef = useRef(user);

    useEffect(() => {
        // Only redirect when user transitions from set → null (i.e. after logout).
        // Skipping the initial-mount case avoids a spurious redirect if this layout
        // somehow renders before app/index.tsx has finished calling setAuth.
        if (prevUserRef.current !== null && user === null) {
            router.replace('/(auth)/login');
        }
        prevUserRef.current = user;
    }, [user, router]);

    return (
        <Tabs
            screenOptions={{
                headerShown: false,
                tabBarActiveTintColor: '#2a2621',
                tabBarInactiveTintColor: '#7a736a',
                tabBarStyle: {
                    backgroundColor: 'rgba(255,254,249,0.5)',
                    borderTopColor: 'rgba(42,38,33,0.10)',
                    borderTopWidth: 1,
                    height: 70,
                },
                tabBarLabelStyle: {
                    fontSize: 12,
                    fontWeight: '500',
                    marginBottom: 8,
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
