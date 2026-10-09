import type { User } from "@sbyte/types";
import { create } from "zustand";

type AuthState = {
  user: User | null;
  setUser: (u: User | null) => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
}));
