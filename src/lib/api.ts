const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001").replace(/\/$/, "");

export type BgModel = "fast" | "pro";
export type BgFormat = "png" | "webp";

export interface RemoveBackgroundResult {
  ok: boolean;
  blob?: Blob;
  error?: string;
  trialUsed?: boolean;
  creditsRemaining?: number;
  processingTime?: number;
  requiresAuth?: boolean;
  proRequired?: boolean;
  retryAfter?: number;
  usedClientSide?: boolean;
}

async function getFirebaseAuthToken(): Promise<string | null> {
  try {
    const { getFirebaseApp } = await import("./firebase");
    const app = await getFirebaseApp();
    const { getAuth, onAuthStateChanged } = await import("firebase/auth");
    const auth = getAuth(app);

    const user = auth.currentUser;
    if (user) return await user.getIdToken(false);

    return await new Promise((resolve) => {
      const unsub = onAuthStateChanged(auth, (u) => {
        unsub();
        if (u) u.getIdToken(false).then(resolve).catch(() => resolve(null));
        else resolve(null);
      });
    });
  } catch {
    return null;
  }
}

/**
 * Server-side background removal via Flask /upload endpoint.
 */
export async function removeBackground(
  imageFile: File | Blob,
  model: BgModel = "fast",
  format: BgFormat = "png",
  fingerprint = ""
): Promise<RemoveBackgroundResult> {
  const form = new FormData();
  const filename = imageFile instanceof File ? imageFile.name : "image.png";
  form.append("image_file", imageFile, filename);
  form.append("model", model);
  form.append("format", format);
  if (fingerprint) form.append("fingerprint", fingerprint);

  const headers: Record<string, string> = {};
  const idToken = await getFirebaseAuthToken();
  if (idToken) headers["Authorization"] = `Bearer ${idToken}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/upload`, { method: "POST", body: form, headers });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? `Network error: ${err.message}` : "Network error — is the server running?",
    };
  }

  if (res.status === 403 || res.status === 401) {
    const data = await res.json().catch(() => ({}));
    return { ok: false, error: data.error || "access_denied", requiresAuth: data.requiresAuth ?? false, proRequired: data.proRequired ?? false };
  }
  if (res.status === 429) {
    const data = await res.json().catch(() => ({}));
    return { ok: false, error: data.error || "Rate limit exceeded.", requiresAuth: data.requiresAuth ?? false, retryAfter: data.retryAfter };
  }
  if (res.status === 413) {
    const data = await res.json().catch(() => ({}));
    return { ok: false, error: data.error || "File is too large.", requiresAuth: data.requiresAuth ?? false };
  }
  if (res.status === 503) {
    const data = await res.json().catch(() => ({}));
    return { ok: false, error: data.error || "Server is at capacity.", retryAfter: data.retryAfter };
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return { ok: false, error: data.error || `Server error ${res.status}` };
  }

  const blob = await res.blob();
  return {
    ok: true,
    blob,
    processingTime: res.headers.get("X-Processing-Time") != null ? Number(res.headers.get("X-Processing-Time")) : undefined,
  };
}

/**
 * Client-side background removal using the browser's ONNX Runtime.
 * Tries local processing first, returns null result if model not ready
 * (caller should fall back to server).
 */
export async function removeBackgroundClient(
  imageFile: File | Blob,
  model: BgModel = "fast"
): Promise<RemoveBackgroundResult> {
  try {
    const w = window as unknown as Record<string, unknown>;
    const processor = w.ClientProcessor as {
      init: () => Promise<void>;
      processImage: (img: HTMLImageElement, mode: string) => Promise<{ success: boolean; dataUrl?: string; model?: string; mode?: string; error?: string }>;
      isModelReady: () => boolean;
      isMobile: () => boolean;
    } | undefined;

    if (!processor) return { ok: false, error: "Client processor not loaded" };

    await processor.init();

    if (model === "fast") {
      return { ok: false, error: "fast_server_only" };
    }

    if (!processor.isModelReady()) {
      return { ok: false, error: "model_not_ready" };
    }

    const img = new Image();
    img.crossOrigin = "anonymous";
    const url = URL.createObjectURL(imageFile);
    img.src = url;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Failed to load image"));
    });

    const result = await processor.processImage(img, model);
    URL.revokeObjectURL(url);

    if (result.success && result.dataUrl) {
      const blob = await (await fetch(result.dataUrl)).blob();
      return { ok: true, blob, usedClientSide: true };
    }

    return { ok: false, error: result.error || "client_processing_failed" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Client processing error" };
  }
}

export async function downloadProModel(onProgress?: (pct: number) => void): Promise<void> {
  try {
    const w = window as unknown as Record<string, unknown>;
    const processor = w.ClientProcessor as {
      init: () => Promise<void>;
      downloadProModel: (onProgress?: (pct: number) => void) => Promise<void>;
    } | undefined;
    if (!processor) return;
    await processor.init();
    await processor.downloadProModel(onProgress);
  } catch (e) {
    console.error("Failed to download pro model:", e);
  }
}

export function isClientProModelReady(): boolean {
  try {
    const w = window as unknown as Record<string, unknown>;
    const processor = w.ClientProcessor as { isModelReady: () => boolean } | undefined;
    return processor?.isModelReady() ?? false;
  } catch { return false; }
}

export function isClientMobile(): boolean {
  try {
    const w = window as unknown as Record<string, unknown>;
    const processor = w.ClientProcessor as { isMobile: () => boolean } | undefined;
    return processor?.isMobile() ?? /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  } catch { return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent); }
}

export async function sendOtp(email: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${API_BASE}/api/send-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const data = await res.json();
  return { ok: res.ok, error: data.error };
}

export async function verifyOtp(email: string, otp: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${API_BASE}/api/verify-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, otp }),
  });
  const data = await res.json();
  return { ok: res.ok, error: data.error };
}

export async function getModels(): Promise<{ models: Record<string, unknown>; default: string }> {
  try {
    const res = await fetch(`${API_BASE}/api/models`);
    if (!res.ok) return { models: {}, default: "fast" };
    return await res.json();
  } catch { return { models: {}, default: "fast" }; }
}

export async function getHealth(): Promise<{ status: string; memory_usage?: string } | null> {
  try {
    const res = await fetch(`${API_BASE}/health`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}
