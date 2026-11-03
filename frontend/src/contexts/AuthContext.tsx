import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { adminLogin, getAdminStats, type AdminStats } from '../services/api'
import { storeStorageKey, storeStorageKeyFor } from '../lib/installation'
import { TENANT_SLUG, tenantPath } from '../lib/tenant'
import { isOfflineDemoAuthEnabled } from '../lib/authMode'
import { IS_PUBLIC_DEMO } from '../lib/publicDemo'

const DEMO_TOKEN = 'demo-local'
const OFFLINE_DEMO_AUTH = isOfflineDemoAuthEnabled(import.meta.env.DEV, import.meta.env.VITE_ALLOW_DEMO_AUTH)

interface AuthContextValue {
  token: string | null
  email: string | null
  isAuthenticated: boolean
  isDemoSession: boolean
  isLoading: boolean
  stats: AdminStats | null
  /** 'superadmin' for the platform administrator, 'user' for store teams. */
  role: string | null
  login: (email: string, password: string) => Promise<{ error?: string }>
  /** Saves a session obtained outside the login form (account activation). */
  adoptSession: (session: { token: string; email: string; role?: string }, tenantSlug: string | null) => void
  logout: () => void
  refreshStats: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

const TOKEN_KEY = storeStorageKey('catalogo-lite-admin-token')
const EMAIL_KEY = storeStorageKey('catalogo-lite-admin-email')
const ROLE_KEY = storeStorageKey('catalogo-lite-admin-role')

function saveSessionFor(tenantSlug: string | null, session: { token: string; email: string; role?: string }) {
  localStorage.setItem(storeStorageKeyFor(tenantSlug, 'catalogo-lite-admin-token'), session.token)
  localStorage.setItem(storeStorageKeyFor(tenantSlug, 'catalogo-lite-admin-email'), session.email)
  localStorage.setItem(storeStorageKeyFor(tenantSlug, 'catalogo-lite-admin-role'), session.role || 'user')
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null)
  const [email, setEmail] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [role, setRole] = useState<string | null>(null)

  // Restore session on mount
  useEffect(() => {
    let active = true
    const restoreSession = async () => {
      if (IS_PUBLIC_DEMO) {
        setIsLoading(false)
        return
      }
      const storedToken = localStorage.getItem(TOKEN_KEY)
      const storedEmail = localStorage.getItem(EMAIL_KEY)
      if (!storedToken || !storedEmail) {
        setIsLoading(false)
        return
      }
      if (storedToken === DEMO_TOKEN) {
        if (OFFLINE_DEMO_AUTH) {
          setToken(storedToken)
          setEmail(storedEmail)
        } else {
          localStorage.removeItem(TOKEN_KEY)
          localStorage.removeItem(EMAIL_KEY)
        }
        setIsLoading(false)
        return
      }
      try {
        await getAdminStats(storedToken)
        if (active) {
          setToken(storedToken)
          setEmail(storedEmail)
          setRole(localStorage.getItem(ROLE_KEY))
        }
      } catch {
        localStorage.removeItem(TOKEN_KEY)
        localStorage.removeItem(EMAIL_KEY)
        localStorage.removeItem(ROLE_KEY)
      } finally {
        if (active) setIsLoading(false)
      }
    }
    void restoreSession()
    return () => { active = false }
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
    if (IS_PUBLIC_DEMO) return { error: 'El acceso administrativo está desactivado en esta demo.' }
    try {
      const response = await adminLogin(loginEmail, password)
      // Store teams log in from any URL; send them to a store they belong to.
      if (response.role === 'user' && response.stores?.length) {
        const here = response.stores.find((store) => (TENANT_SLUG ? store.slug === TENANT_SLUG : store.storeId === 1))
        if (!here) {
          const target = response.stores[0]!
          const targetSlug = target.storeId === 1 ? null : target.slug
          saveSessionFor(targetSlug, { token: response.token, email: response.email, role: 'user' })
          window.location.assign(tenantPath(targetSlug, '/admin'))
          return {}
        }
      }
      setToken(response.token)
      setEmail(response.email)
      setRole(response.role || 'superadmin')
      saveSessionFor(TENANT_SLUG, { token: response.token, email: response.email, role: response.role || 'superadmin' })
      return {}
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed'
      const backendDown = message.includes('Backend no disponible') || message.includes('Failed to fetch') || message.includes('fetch')
      if (backendDown && OFFLINE_DEMO_AUTH && loginEmail.trim() && password) {
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
    setRole(null)
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(EMAIL_KEY)
    localStorage.removeItem(ROLE_KEY)
  }

  const adoptSession = (session: { token: string; email: string; role?: string }, tenantSlug: string | null) => {
    saveSessionFor(tenantSlug, session)
    if (tenantSlug === TENANT_SLUG) {
      setToken(session.token)
      setEmail(session.email)
      setRole(session.role || 'user')
    }
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
        role,
        adoptSession,
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
