// API client for the AI Personal Coach backend.
const BASE = `${process.env.EXPO_PUBLIC_BACKEND_URL}/api`;

let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

async function apiFetch(path: string, options: RequestInit = {}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (res.status === 401) {
    const err = new Error("Unauthorized");
    (err as any).status = 401;
    throw err;
  }
  if (!res.ok) {
    let detail = "Errore di rete";
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {}
    const err = new Error(detail);
    (err as any).status = res.status;
    throw err;
  }
  return res.json();
}

const get = (p: string) => apiFetch(p);
const post = (p: string, body?: any) =>
  apiFetch(p, { method: "POST", body: body ? JSON.stringify(body) : undefined });
const del = (p: string) => apiFetch(p, { method: "DELETE" });

// ---- Auth ----
export const authSession = (session_id: string) => post("/auth/session", { session_id });
export const authMe = () => get("/auth/me");
export const authLogout = () => post("/auth/logout");

// ---- Goals ----
export const getActiveGoal = () => get("/goals/active");
export const listGoals = () => get("/goals");
export const createGoal = () => post("/goals");
export const getGoal = (id: string) => get(`/goals/${id}`);
export const deleteGoal = (id: string) => del(`/goals/${id}`);

// ---- Chat ----
export const getMessages = (id: string) => get(`/goals/${id}/messages`);
export const postMessage = (id: string, content: string) =>
  post(`/goals/${id}/messages`, { content });
export const generatePlan = (id: string) => post(`/goals/${id}/generate-plan`);

// ---- Daily tasks ----
export const getToday = (id: string, date?: string) =>
  get(`/goals/${id}/today${date ? `?date=${date}` : ""}`);
export const logTask = (
  id: string,
  taskId: string,
  body: { date: string; completed: boolean; metric_value?: number | null },
) => post(`/goals/${id}/tasks/${taskId}/log`, body);

// ---- Progress ----
export const getProgress = (id: string) => get(`/goals/${id}/progress`);
export const toggleMilestone = (id: string, msId: string) =>
  post(`/goals/${id}/milestones/${msId}/toggle`);

// ---- Check-in ----
export const createCheckin = (
  id: string,
  body: { date: string; summary: string; mood: string; obstacles?: string },
) => post(`/goals/${id}/checkin`, body);
export const listCheckins = (id: string) => get(`/goals/${id}/checkins`);

// ---- Subscription / access ----
export const subscriptionStatus = () => get("/subscription/status");
export const activateDemo = () => post("/subscription/activate-demo");

// ---- Gamification ----
export const getGamification = () => get("/gamification");

// ---- Emergency SOS coach ----
export const coachSos = (issue: string) => post("/coach/sos", { issue });

// ---- Accountability partner ----
export const getPartner = () => get("/accountability/partner");
export const setPartner = (email: string) => post("/accountability/partner", { email });
export const shareProgress = () => post("/accountability/share");

// ---- Voice transcription (multipart) ----
export async function transcribeVoice(fileUri: string, isWeb: boolean): Promise<{ text: string; sentiment: string }> {
  const form = new FormData();
  if (isWeb) {
    const blob = await (await fetch(fileUri)).blob();
    form.append("file", new File([blob], "recording.webm", { type: blob.type || "audio/webm" }));
  } else {
    form.append("file", { uri: fileUri, name: "recording.m4a", type: "audio/m4a" } as any);
  }
  const headers: Record<string, string> = {};
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
  const res = await fetch(`${BASE}/voice/transcribe`, { method: "POST", body: form, headers });
  if (!res.ok) {
    let detail = "Trascrizione fallita";
    try {
      detail = (await res.json()).detail || detail;
    } catch {}
    throw new Error(detail);
  }
  return res.json();
}
