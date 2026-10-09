import { useState } from 'react';

interface CandidateUser {
  id: number;
  name: string;
  email: string;
  role: string;
  candidateProfile?: {
    id: number;
    rollNumber: string;
    firstLoginCompleted: boolean;
  };
}

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: CandidateUser | null;
  token: string | null;
  login: (token: string, user: CandidateUser) => void;
  logout: () => void;
}

export function useAuth(): AuthContextType {
  const [state, setState] = useState<AuthContextType>(() => {
    const storedToken = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    const storedUser = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
    const parsedUser = storedUser ? (() => { try { return JSON.parse(storedUser); } catch { return null; } })() : null;

    return {
      isAuthenticated: !!storedToken,
      isLoading: false,
      user: parsedUser,
      token: storedToken,
      login: (token: string, user: CandidateUser) => {
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(user));
        setState(prev => ({ ...prev, isAuthenticated: true, user, token }));
      },
      logout: () => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setState(prev => ({ ...prev, isAuthenticated: false, user: null, token: null }));
      },
    };
  });

  return state;
}
