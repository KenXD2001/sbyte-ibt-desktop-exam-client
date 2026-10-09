export interface LoginPayload {
  rollNumber: string;
  dateOfBirth: string;
}

export interface LoginResponse {
  status: string;
  message: string;
  data: {
    accessToken: string;
    user: {
      id: number;
      name: string;
      email: string;
      role: string;
      candidateProfile?: {
        id: number;
        rollNumber: string;
        firstLoginCompleted: boolean;
      };
    };
  };
}

const BASE_URL = import.meta.env.VITE_API_BASE_URL;

if (!BASE_URL) {
  throw new Error('VITE_API_BASE_URL environment variable is required');
}

export const authAPI = {
  async login(payload: LoginPayload): Promise<LoginResponse> {
    const response = await fetch(`${BASE_URL}/auth/candidate-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'Login failed');
    }
    return response.json();
  },
};
