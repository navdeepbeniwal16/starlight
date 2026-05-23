const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

export const api = {
  getAppName: async (): Promise<{ name: string }> => {
    const res = await fetch(`${API_URL}/app/name`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
    return json;
  },
};
