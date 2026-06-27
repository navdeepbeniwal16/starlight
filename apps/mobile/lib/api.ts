import { AdjustPlanTaskResponse, ApiResult, BlockInput, ConfirmPlanResponse, CreateDayPlanResponse, CreateDayTemplateResponse, CreateTaskInput, CreateTaskResponse, GeneratePlanResponse, GetBacklogResponse, GetDayPlanResponse, GetDayTemplateResponse, GetPlanTasksResponse, GetTaskDetailResponse, LoginResponse, MeResponse, SignupResponse, UpdateTaskInput, UpdateTaskResponse } from "./api.types";
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

  createDayPlan: async (): Promise<CreateDayPlanResponse> => {
    const token = await getToken();

    if (!token) {
      return { ok: false, error: 'No token found' };
    }

    try {
      const response = await fetch(`${API_URL}/day-plan`, {
        method: 'POST',
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

  updateTask: async (taskId: string, input: UpdateTaskInput): Promise<UpdateTaskResponse> => {
    const token = await getToken();

    if (!token) {
      return { ok: false, error: 'No token found' };
    }

    try {
      const response = await fetch(`${API_URL}/tasks/${taskId}`, {
        method: 'PATCH',
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

  getTaskDetail: async (taskId: string): Promise<GetTaskDetailResponse> => {
    const token = await getToken();

    if (!token) {
      return { ok: false, error: 'No token found' };
    }

    try {
      const response = await fetch(`${API_URL}/tasks/${taskId}`, {
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

  getPlanTasks: async (planId: string): Promise<GetPlanTasksResponse> => {
    const token = await getToken();
    if (!token) return { ok: false, error: 'No token found' };
    try {
      const response = await fetch(`${API_URL}/day-plan/${planId}/tasks`, {
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

  generatePlan: async (planId: string): Promise<GeneratePlanResponse> => {
    const token = await getToken();
    if (!token) return { ok: false, error: 'No token found' };
    try {
      const response = await fetch(`${API_URL}/day-plan/${planId}/generate`, {
        method: 'POST',
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

  adjustPlanTask: async (
    planId: string,
    taskId: string,
    body: { blockId: string | null; blockOrder: number },
  ): Promise<AdjustPlanTaskResponse> => {
    const token = await getToken();
    if (!token) return { ok: false, error: 'No token found' };
    try {
      const response = await fetch(`${API_URL}/day-plan/${planId}/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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

  confirmPlan: async (planId: string): Promise<ConfirmPlanResponse> => {
    const token = await getToken();
    if (!token) return { ok: false, error: 'No token found' };
    try {
      const response = await fetch(`${API_URL}/day-plan/${planId}/confirm`, {
        method: 'POST',
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

  deleteTask: async (taskId: string): Promise<ApiResult<null>> => {
    const token = await getToken();

    if (!token) {
      return { ok: false, error: 'No token found' };
    }

    try {
      const response = await fetch(`${API_URL}/tasks/${taskId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!response.ok) {
        const responseJson = await response.json().catch(() => ({}));
        return { ok: false, error: (responseJson as { error?: string }).error ?? `HTTP ${response.status}` };
      }

      return { ok: true, data: null };
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
