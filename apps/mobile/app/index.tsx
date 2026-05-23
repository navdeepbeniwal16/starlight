import { View, Text, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import { trpc } from "../lib/trpc";

export default function HomeScreen() {
  const { data: appName, isLoading, error } = trpc.appName.useQuery();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>
        {isLoading ? "Loading..." : error ? "Error" : appName}
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
