"use client";
import { useEffect, useState } from "react";
import { getFirebaseApp } from "@/lib/firebase";

export default function FirebaseInit() {
  const [inited, setInited] = useState(false);

  useEffect(() => {
    getFirebaseApp()
      .then(() => setInited(true))
      .catch((err) => console.error("Firebase init failed:", err));
  }, []);

  if (!inited) return null;
  return null;
}
