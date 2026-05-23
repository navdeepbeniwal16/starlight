import { View, Text, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

export default function HomeScreen() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["appName"],
    queryFn: api.getAppName,
  });
  const appName = data?.name;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>
        {isLoading
          ? "Loading..."
          : error
          ? String(error)
          : appName}
      </Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
  },
});
