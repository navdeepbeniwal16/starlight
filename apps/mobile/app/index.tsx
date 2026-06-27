import { useRouter } from "expo-router";
import { useEffect } from "react";
import { api } from "../lib/api";
import { ActivityIndicator, View } from "react-native";
import { getToken } from "../lib/auth-token";
import { useAuthStore } from "../stores/auth.store";

export default function HomeScreen() {
  const router = useRouter();
  const setAuth = useAuthStore((state) => state.setAuth);
  
  useEffect(() => {
    const checkSession = async () => {
      const result = await api.getMe();
      
      if(result.ok) {
        const token = await getToken();
        await setAuth(result.data, token!);
        router.replace('/(onboarding)');
      } else {
        router.replace('/(auth)/signup');
      }
    }
    
    checkSession();
  }, []);
  
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator />
    </View>
  );
}
