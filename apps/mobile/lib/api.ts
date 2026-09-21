import { ApiResult, BlockInput, ConfirmAssignment, ConfirmPlanResponse, CreateDayTemplateResponse, CreateProjectInput, CreateTaskInput, CreateTaskResponse, GeneratePlanResponse, GetAllTasksResponse, GetBacklogResponse, GetDayPlanResponse, GetDayTemplateResponse, GetProjectsResponse, GetReviewTasksResponse, GetTaskDetailResponse, OnboardingResponse, ProjectResponse, UpdateDayTemplateResponse, UpdateProjectInput, UpdateTaskInput, UpdateTaskResponse } from "./api.types";
import { getToken } from "./clerk";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

export const api = {
  getAppName: async (): Promise<{ name: string }> => {
    const res = await fetch(`${API_URL}/app/name`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
    return json;
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

  updateDayTemplate: async (payload: { wakeTime: string; sleepTime: string; blocks: BlockInput[] }): Promise<UpdateDayTemplateResponse> => {
    const token = await getToken();

    if (!token) {
      return { ok: false, error: 'No token found' };
    }

    try {
      const response = await fetch(`${API_URL}/day-template`, {
        method: 'PUT',
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
      const response = await fetch(`${API_URL}/tasks/backlog`, {
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

  getAllTasks: async (cursor?: string): Promise<GetAllTasksResponse> => {
    const token = await getToken();

    if (!token) {
      return { ok: false, error: 'No token found' };
    }

    try {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
      const response = await fetch(`${API_URL}/tasks${query}`, {
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

  getReviewTasks: async (): Promise<GetReviewTasksResponse> => {
    const token = await getToken();
    if (!token) return { ok: false, error: 'No token found' };
    try {
      const response = await fetch(`${API_URL}/day-plan/review-tasks`, {
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

  // Returns a plan proposal; nothing is persisted server-side. The proposal is
  // held client-side during review and sent back via confirmPlan.
  generatePlan: async (signal?: AbortSignal): Promise<GeneratePlanResponse> => {
    const token = await getToken();
    if (!token) return { ok: false, error: 'No token found' };
    try {
      const response = await fetch(`${API_URL}/day-plan/generate`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Timezone-Offset': String(-new Date().getTimezoneOffset()),
        },
        signal,
      });
      const responseJson = await response.json();
      if (!response.ok) {
        return { ok: false, error: responseJson.error ?? `HTTP ${response.status}`, status: response.status, code: responseJson.code };
      }
      return { ok: true, data: responseJson.data };
    } catch (error) {
      return { ok: false, error: 'Network error. Please check your connection.' };
    }
  },

  confirmPlan: async (assignments: ConfirmAssignment[]): Promise<ConfirmPlanResponse> => {
    const token = await getToken();
    if (!token) return { ok: false, error: 'No token found' };
    try {
      const response = await fetch(`${API_URL}/day-plan/confirm`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Timezone-Offset': String(-new Date().getTimezoneOffset()),
        },
        body: JSON.stringify({ assignments }),
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

  getProjects: async (): Promise<GetProjectsResponse> => {
    const token = await getToken();
    if (!token) return { ok: false, error: 'No token found' };
    try {
      const response = await fetch(`${API_URL}/projects`, {
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

  createProject: async (input: CreateProjectInput): Promise<ProjectResponse> => {
    const token = await getToken();
    if (!token) return { ok: false, error: 'No token found' };
    try {
      const response = await fetch(`${API_URL}/projects`, {
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

  updateProject: async (projectId: string, input: UpdateProjectInput): Promise<ProjectResponse> => {
    const token = await getToken();
    if (!token) return { ok: false, error: 'No token found' };
    try {
      const response = await fetch(`${API_URL}/projects/${projectId}`, {
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

  // Toggles a project's in-focus flag. The max-3 cap is enforced server-side and
  // surfaces as a 409, so the client's own guard is a UX affordance, not the source of truth.
  setProjectFocus: async (projectId: string, inFocus: boolean): Promise<ProjectResponse> => {
    const token = await getToken();
    if (!token) return { ok: false, error: 'No token found' };
    try {
      const response = await fetch(`${API_URL}/projects/${projectId}/focus`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ inFocus }),
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

  deleteProject: async (projectId: string): Promise<ApiResult<null>> => {
    const token = await getToken();
    if (!token) return { ok: false, error: 'No token found' };
    try {
      const response = await fetch(`${API_URL}/projects/${projectId}`, {
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

  getOnboarding: async (): Promise<OnboardingResponse> => {
    const token = await getToken();

    if(!token) {
      return { ok: false, error: 'No token found' };
    }

    try {
      const response = await fetch(`${API_URL}/me/onboarding`, {
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

  completeOnboarding: async (): Promise<OnboardingResponse> => {
    const token = await getToken();

    if(!token) {
      return { ok: false, error: 'No token found' };
    }

    try {
      const response = await fetch(`${API_URL}/me/onboarding`, {
        method: 'PUT',
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
