import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  getApiErrorMessage,
  getCurrentUser,
  isUnauthenticated,
  login,
  logout,
  logoutEverywhere,
  updateCurrentUser,
  type AuthUser,
} from '../services/api';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'error';

interface AuthContextValue {
  user: AuthUser | null;
  status: AuthStatus;
  error: string | null;
  reloadUser: () => Promise<void>;
  signIn: (identifier: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  signOutEverywhere: () => Promise<void>;
  updateProfile: (input: {
    fullName?: string;
    profileImageUrl?: string | null;
  }) => Promise<AuthUser>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [error, setError] = useState<string | null>(null);

  const reloadUser = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const currentUser = await getCurrentUser();
      setUser(currentUser);
      setStatus('authenticated');
    } catch (requestError) {
      setUser(null);
      if (isUnauthenticated(requestError)) {
        setStatus('unauthenticated');
      } else {
        setStatus('error');
        setError(getApiErrorMessage(requestError));
      }
    }
  }, []);

  useEffect(() => {
    void reloadUser();
  }, [reloadUser]);

  const signIn = useCallback(async (identifier: string, password: string) => {
    setError(null);
    const signedInUser = await login(identifier, password);
    setUser(signedInUser);
    setStatus('authenticated');
  }, []);

  const signOut = useCallback(async () => {
    await logout();
    setUser(null);
    setStatus('unauthenticated');
    setError(null);
  }, []);

  const signOutEverywhere = useCallback(async () => {
    await logoutEverywhere();
    setUser(null);
    setStatus('unauthenticated');
    setError(null);
  }, []);

  const updateProfile = useCallback(
    async (input: { fullName?: string; profileImageUrl?: string | null }) => {
      const updatedUser = await updateCurrentUser(input);
      setUser(updatedUser);
      setStatus('authenticated');
      return updatedUser;
    },
    [],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      error,
      reloadUser,
      signIn,
      signOut,
      signOutEverywhere,
      updateProfile,
    }),
    [user, status, error, reloadUser, signIn, signOut, signOutEverywhere, updateProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider.');
  }
  return context;
}
