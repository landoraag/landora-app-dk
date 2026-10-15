import { createContext, useContext, useEffect, useState } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  updateProfile,
} from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../lib/firebase";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const snap = await getDoc(doc(db, "users", u.uid));
        setProfile(snap.exists() ? snap.data() : { nickname: u.email });
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  async function login(email, password) {
    await signInWithEmailAndPassword(auth, email, password);
  }

  async function register(email, password, nickname) {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: nickname });
    await setDoc(doc(db, "users", cred.user.uid), {
      email,
      nickname,
      createdAt: serverTimestamp(),
    });
    setProfile({ email, nickname });
  }

  async function updatePhoto(photoURL) {
    const u = auth.currentUser;
    if (!u) return;
    const value = photoURL || null;
    await setDoc(
      doc(db, "users", u.uid),
      { photoURL: value, email: u.email, nickname: profile?.nickname || u.displayName || u.email },
      { merge: true }
    );
    try {
      await updateProfile(u, { photoURL: value });
    } catch {
      /* o Firestore já guarda a foto; isto é só um complemento */
    }
    setProfile((p) => ({ ...(p || {}), photoURL: value }));
  }

  async function logout() {
    await signOut(auth);
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, login, register, logout, updatePhoto }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
