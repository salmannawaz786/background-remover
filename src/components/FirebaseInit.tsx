"use client";
import { useEffect } from "react";
import { getFirebaseApp } from "@/lib/firebase";
import { useStore } from "@/lib/store";

export default function FirebaseInit() {
  const setUser = useStore((s) => s.setUser);
  const setAuthChecked = useStore((s) => s.setAuthChecked);
  const updateCredits = useStore((s) => s.updateCredits);

  useEffect(() => {
    let unsubAuth: (() => void) | null = null;
    let unsubFirestore: (() => void) | null = null;

    const init = async () => {
      try {
        const app = await getFirebaseApp();
        const { getAuth, onAuthStateChanged } = await import("firebase/auth");
        const auth = getAuth(app);

        unsubAuth = onAuthStateChanged(auth, async (fbUser) => {
          if (fbUser) {
            setUser({
              uid: fbUser.uid,
              email: fbUser.email ?? "",
              displayName: fbUser.displayName ?? undefined,
              photoURL: fbUser.photoURL ?? undefined,
            });

            try {
              const { getFirestore, doc, onSnapshot, getDoc } = await import("firebase/firestore");
              const db = getFirestore(app);

              if (unsubFirestore) unsubFirestore();

              unsubFirestore = onSnapshot(doc(db, "users", fbUser.uid), (snap) => {
                if (snap.exists()) {
                  const data = snap.data();
                  updateCredits(data.credits || 0);
                }
              });

              const userDoc = await getDoc(doc(db, "users", fbUser.uid));
              if (userDoc.exists()) {
                updateCredits(userDoc.data().credits || 0);
              }
            } catch {
              // Firestore unavailable
            }
          } else {
            setUser(null);
          }
          setAuthChecked(true);
        });
      } catch {
        setUser(null);
        setAuthChecked(true);
      }
    };

    init();

    return () => {
      if (unsubAuth) unsubAuth();
      if (unsubFirestore) unsubFirestore();
    };
  }, [setUser, setAuthChecked, updateCredits]);

  return null;
}
