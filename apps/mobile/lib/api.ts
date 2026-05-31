import { SignupResponse } from "./api.types";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

export const api = {
  getAppName: async (): Promise<{ name: string }> => {
    const res = await fetch(`${API_URL}/app/name`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
    return json;
  },

  signup: async (data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
  }): Promise<SignupResponse> => {
    try {
      const response = await fetch(`${API_URL}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json'},
        body: JSON.stringify(data)
      });

      const responseJson = await response.json();
      if(!response.ok) {
        return { ok: false, error: responseJson.error ?? `HTTP ${response.status}`, status: response.status };
      }

      return { ok: true, data: responseJson };
    } catch (error) {
      return { ok: false, error: 'Network error. Please check your connection.'};
    }
  }
};
