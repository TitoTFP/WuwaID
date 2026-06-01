import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

const ME_KEY = ["me"] as const;

export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: () => api.me(),
    staleTime: 30_000,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return async (password: string) => {
    await api.login(password);
    await qc.invalidateQueries({ queryKey: ME_KEY });
  };
}

export function useLogout() {
  const qc = useQueryClient();
  return async () => {
    await api.logout();
    await qc.invalidateQueries({ queryKey: ME_KEY });
  };
}
