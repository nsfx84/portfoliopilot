import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import {
  createUserWithEmailAndPassword,
  deleteUser,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
} from 'firebase/auth'
import { doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { auth, db } from '../lib/firebase'

export const INVITE_CONTACT_EMAIL = 'nsfx84@gmail.com'

export const NOT_INVITED_MESSAGE =
  `This app is invite-only. Your email is not on the allowlist — email ${INVITE_CONTACT_EMAIL} to request access.`

export class NotInvitedError extends Error {
  constructor() {
    super(NOT_INVITED_MESSAGE)
    this.name = 'NotInvitedError'
    this.code = 'auth/not-invited'
  }
}

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(() => Boolean(auth))

  useEffect(() => {
    if (!auth) {
      return
    }
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u)
      setLoading(false)
    })
    return () => unsub()
  }, [])

  const signIn = useCallback(async (email, password) => {
    if (!auth) throw new Error('Firebase Auth is not configured.')
    await signInWithEmailAndPassword(auth, email, password)
  }, [])

  const signUp = useCallback(async (email, password) => {
    if (!auth) throw new Error('Firebase Auth is not configured.')
    if (!db) throw new Error('Firestore is not configured.')

    const cred = await createUserWithEmailAndPassword(auth, email, password)

    try {
      await setDoc(doc(db, 'users', cred.user.uid), {
        email: cred.user.email,
        createdAt: serverTimestamp(),
      })
    } catch (err) {
      try {
        await deleteUser(cred.user)
      } catch {
        await firebaseSignOut(auth)
      }
      if (err?.code === 'permission-denied') {
        throw new NotInvitedError()
      }
      throw err
    }
  }, [])

  const signOut = useCallback(async () => {
    if (!auth) return
    await firebaseSignOut(auth)
  }, [])

  const value = useMemo(
    () => ({ user, loading, signIn, signUp, signOut }),
    [user, loading, signIn, signUp, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

/** @returns {{ user: import('firebase/auth').User | null, loading: boolean, signIn: Function, signUp: Function, signOut: Function }} */
// eslint-disable-next-line react-refresh/only-export-components -- hook colocated with provider
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}
