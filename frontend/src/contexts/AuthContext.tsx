import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { adminLogin, getAdminStats, type AdminStats } from '../services/api'

const DEMO_TOKEN = 'demo-local'

interface AuthContextValue {
  token: string | null
  email: string | null
  isAuthenticated: boolean
  isDemoSession: boolean
  isLoading: boolean
  stats: AdminStats | null
  login: (email: string, password: string) => Promise<{ error?: string }>
  logout: () => void
  refreshStats: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

const TOKEN_KEY = 'catalogo-lite-admin-token'
const EMAIL_KEY = 'catalogo-lite-admin-email'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null)
  const [email, setEmail] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [stats, setStats] = useState<AdminStats | null>(null)

  // Restore session on mount
  useEffect(() => {
    const storedToken = localStorage.getItem(TOKEN_KEY)
    const storedEmail = localStorage.getItem(EMAIL_KEY)
    if (storedToken && storedEmail) {
      setToken(storedToken)
      setEmail(storedEmail)
    }
    setIsLoading(false)
  }, [])

  // Fetch stats when authenticated
  useEffect(() => {
    if (token) {
      refreshStats()
    } else {
      setStats(null)
    }
  }, [token])

  const login = async (loginEmail: string, password: string): Promise<{ error?: string }> => {
    try {
      const response = await adminLogin(loginEmail, password)
      setToken(response.token)
      setEmail(response.email)
      localStorage.setItem(TOKEN_KEY, response.token)
      localStorage.setItem(EMAIL_KEY, response.email)
      return {}
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed'
      const backendDown = message.includes('Backend no disponible') || message.includes('Failed to fetch') || message.includes('fetch')
      if (backendDown && loginEmail && password) {
        setToken(DEMO_TOKEN)
        setEmail(loginEmail)
        localStorage.setItem(TOKEN_KEY, DEMO_TOKEN)
        localStorage.setItem(EMAIL_KEY, loginEmail)
        return {}
      }
      return { error: message }
    }
  }

  const logout = () => {
    setToken(null)
    setEmail(null)
    setStats(null)
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(EMAIL_KEY)
  }

  const refreshStats = async () => {
    if (!token) return
    try {
      const data = await getAdminStats(token)
      setStats(data)
    } catch {
      // Stats fetch failed; keep previous value or null
    }
  }

  return (
    <AuthContext.Provider
      value={{
        token,
        email,
        isAuthenticated: !!token,
        isDemoSession: token === DEMO_TOKEN,
        isLoading,
        stats,
        login,
        logout,
        refreshStats,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}