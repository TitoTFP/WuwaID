import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { fetchMe, loginUser, loginAdmin, logoutUser } from './api';

export interface AuthContextValue {
  role: string;
  username: string;
  loading: boolean;
  login: (password?: string) => Promise<any>;
  adminLogin: (password?: string) => Promise<any>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function useAuthState(): AuthContextValue {
  const [role, setRole] = useState<string>(() => localStorage.getItem('wuwaid_role') || 'reader');
  const [username, setUsername] = useState<string>('Guest');
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    fetchMe()
      .then((data) => {
        setRole(data.role);
        setUsername(data.username);
      })
      .catch(() => {
        setRole('reader');
      })
      .finally(() => setLoading(false));
  }, []);

  const handleLogin = async (password?: string) => {
    const data = await loginUser(password);
    setRole(data.role);
    setUsername(data.username);
    return data;
  };

  const handleAdminLogin = async (password?: string) => {
    const data = await loginAdmin(password);
    setRole(data.role);
    setUsername(data.username);
    return data;
  };

  const handleLogout = async () => {
    await logoutUser();
    setRole('reader');
    setUsername('Guest');
  };

  return {
    role,
    username,
    loading,
    login: handleLogin,
    adminLogin: handleAdminLogin,
    logout: handleLogout,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  return createElement(AuthContext.Provider, { value: useAuthState() }, children);
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
}
