import { BlockInput, CreateDayTemplateResponse, CreateTaskInput, CreateTaskResponse, GetBacklogResponse, GetDayPlanResponse, GetDayTemplateResponse, LoginResponse, MeResponse, SignupResponse } from "./api.types";
import { getToken } from "./auth-token";

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

      return { ok: true, data: responseJson.data };
    } catch (error) {
      return { ok: false, error: 'Network error. Please check your connection.'};
    }
  },

  login: async (data: {
    email: string;
    password: string;
  }): Promise<LoginResponse> => {
    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json'},
        body: JSON.stringify(data)
      });

      const responseJson = await response.json();
      if(!response.ok) {
        return { ok: false, error: responseJson.error ?? `HTTP ${response.status}`, status: response.status };
      }

      return { ok: true, data: responseJson.data };
    } catch (error) {
      return { ok: false, error: 'Network error. Please check your connection.'};
    }
  },

  getDayTemplate: async (): Promise<GetDayTemplateResponse> => {
    const token = await getToken();

    if (!token) {
      return { ok: false, error: 'No token found' };
    }

    try {
      const response = await fetch(`${API_URL}/day-template`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` },
      });

      const responseJson = await response.json();
      if (!response.ok) {
        return { ok: false, error: responseJson.error ?? `HTTP ${response.status}`, status: response.status };
      }

      return { ok: true, data: responseJson.data };
    } catch (error) {
      return { ok: false, error: 'Network error. Please check your connection.' };
    }
  },

  createDayTemplate: async (payload: { wakeTime: string; sleepTime: string; blocks: BlockInput[] }): Promise<CreateDayTemplateResponse> => {
    const token = await getToken();

    if (!token) {
      return { ok: false, error: 'No token found' };
    }

    try {
      const response = await fetch(`${API_URL}/day-template`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const responseJson = await response.json();
      if (!response.ok) {
        return { ok: false, error: responseJson.error ?? `HTTP ${response.status}`, status: response.status };
      }

      return { ok: true, data: responseJson.data };
    } catch (error) {
      return { ok: false, error: 'Network error. Please check your connection.' };
    }
  },

  getDayPlan: async (): Promise<GetDayPlanResponse> => {
    const token = await getToken();

    if (!token) {
      return { ok: false, error: 'No token found' };
    }

    try {
      const response = await fetch(`${API_URL}/day-plan`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Timezone-Offset': String(-new Date().getTimezoneOffset()),
        },
      });

      const responseJson = await response.json();
      if (!response.ok) {
        return { ok: false, error: responseJson.error ?? `HTTP ${response.status}`, status: response.status };
      }

      return { ok: true, data: responseJson.data };
    } catch (error) {
      return { ok: false, error: 'Network error. Please check your connection.' };
    }
  },

  createTask: async (input: CreateTaskInput): Promise<CreateTaskResponse> => {
    const token = await getToken();

    if (!token) {
      return { ok: false, error: 'No token found' };
    }

    try {
      const response = await fetch(`${API_URL}/tasks`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });

      const responseJson = await response.json();
      if (!response.ok) {
        return { ok: false, error: responseJson.error ?? `HTTP ${response.status}`, status: response.status };
      }

      return { ok: true, data: responseJson.data };
    } catch (error) {
      return { ok: false, error: 'Network error. Please check your connection.' };
    }
  },

  getBacklog: async (): Promise<GetBacklogResponse> => {
    const token = await getToken();

    if (!token) {
      return { ok: false, error: 'No token found' };
    }

    try {
      const response = await fetch(`${API_URL}/tasks`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` },
      });

      const responseJson = await response.json();
      if (!response.ok) {
        return { ok: false, error: responseJson.error ?? `HTTP ${response.status}`, status: response.status };
      }

      return { ok: true, data: responseJson.data };
    } catch (error) {
      return { ok: false, error: 'Network error. Please check your connection.' };
    }
  },

  getMe: async (): Promise<MeResponse> => {
    const token = await getToken();

    if(!token) {
      return { ok: false, error: 'No token found' };
    }

    try {
      const response = await fetch(`${API_URL}/auth/me`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` },
      });

      const responseJson = await response.json();
      if(!response.ok) {
        return { ok: false, error: responseJson.error ?? `HTTP ${response.status}`, status: response.status };
      }

      return { ok: true, data: responseJson.data };
    } catch (error) {
      return { ok: false, error: 'Network error. Please check your connection.'};
    }
  },
};
