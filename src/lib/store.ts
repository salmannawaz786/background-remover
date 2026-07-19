import { create } from "zustand";

interface User {
  uid: string;
  email: string;
  credits?: number;
}

interface AppStore {
  // Image state
  uploadedImage: string | null;       // DataURL of original image
  uploadedFile: File | null;
  resultImage: string | null;         // DataURL of processed result
  setUploadedImage: (img: string | null, file?: File | null) => void;
  setResultImage: (img: string | null) => void;
  clearImages: () => void;

  // Auth state
  user: User | null;
  setUser: (user: User | null) => void;
  updateCredits: (credits: number) => void;

  // Guest fast mode tracking (3 free uses without login)
  guestFastUses: number;
  incrementGuestFastUses: () => void;
  guestFastRemaining: () => number;

  // Model preference
  selectedModel: "fast" | "pro";
  setSelectedModel: (model: "fast" | "pro") => void;
}

const GUEST_FAST_LIMIT = 3;

export const useStore = create<AppStore>((set, get) => ({
  uploadedImage: null,
  uploadedFile: null,
  resultImage: null,
  setUploadedImage: (img, file = null) =>
    set({ uploadedImage: img, uploadedFile: file, resultImage: null }),
  setResultImage: (img) => set({ resultImage: img }),
  clearImages: () => set({ uploadedImage: null, uploadedFile: null, resultImage: null }),

  user: null,
  setUser: (user) => set({ user }),
  updateCredits: (credits) =>
    set((state) => ({ user: state.user ? { ...state.user, credits } : null })),

  guestFastUses: (() => {
    if (typeof window === "undefined") return 0;
    return parseInt(localStorage.getItem("guestFastUses") || "0", 10);
  })(),
  incrementGuestFastUses: () => {
    const current = get().guestFastUses;
    const next = current + 1;
    localStorage.setItem("guestFastUses", String(next));
    set({ guestFastUses: next });
  },
  guestFastRemaining: () => GUEST_FAST_LIMIT - get().guestFastUses,

  selectedModel: "fast",
  setSelectedModel: (model) => set({ selectedModel: model }),
}));
