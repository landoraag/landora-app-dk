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
  // Acesso aos dados (lista de acesso em config/access):
  // "open" = proteção ainda não ativada | "member" = está na lista | "denied" = conta fora da lista
  const [access, setAccess] = useState("open");

  async function checkAccess() {
    try {
      const snap = await getDoc(doc(db, "config", "access"));
      const next = snap.exists() ? "member" : "open";
      setAccess(next);
      return next;
    } catch (e) {
      if (e?.code === "permission-denied") {
        setAccess("denied");
        return "denied";
      }
      console.warn("Não consegui conferir o acesso:", e);
      setAccess("open");
      return "open";
    }
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const acc = await checkAccess();
        if (acc === "denied") {
          setProfile({ nickname: u.displayName || u.email, email: u.email });
        } else {
          try {
            const snap = await getDoc(doc(db, "users", u.uid));
            setProfile(snap.exists() ? snap.data() : { nickname: u.email });
          } catch {
            setProfile({ nickname: u.displayName || u.email, email: u.email });
          }
        }
      } else {
        setProfile(null);
        setAccess("open");
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
    try {
      await setDoc(doc(db, "users", cred.user.uid), {
        email,
        nickname,
        createdAt: serverTimestamp(),
      });
    } catch (e) {
      // E-mail fora da lista de acesso: a conta existe, mas não vê nenhum dado.
      if (e?.code !== "permission-denied") throw e;
    }
    setProfile({ email, nickname });
    await checkAccess();
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
    <AuthContext.Provider value={{ user, profile, loading, access, checkAccess, login, register, logout, updatePhoto }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
