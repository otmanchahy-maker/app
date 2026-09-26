# AI Personal Coach — PRD

## Original Problem Statement
Mobile app acting as a universal AI Personal Coach (in Italian). It must:
- **Fase 1 — Intervista:** conduct a guided interview to collect the goal, timeline, personal params, budget/resources, time availability, preferences/limits.
- **Fase 2 — Fattibilità & Tappe:** assess feasibility (adjust if unrealistic) and define measurable weekly milestones.
- **Fase 3 — Piano giornaliero:** generate concrete daily tasks with times, quantities and verifiable metrics.
- **Fase 4 — Feedback & adattamento:** daily check-in where the coach recalibrates based on real progress.

## User Choices
- AI model: **Claude Sonnet 5** (via Emergent LLM key)
- Auth: **Google login** (Emergent-managed OAuth)
- Goals: **any type** (fitness, business, study, languages…)
- Style: **energetic & motivating** (Tactile/Playful light theme, vibrant orange #FF6B35, Plus Jakarta Sans)
- Daily check-in reminder: yes (in-app check-in flow)

## Architecture
- **Frontend:** Expo Router (React Native). Tabs: Piano (home), Progressi, Coach, Profilo. Full-screen Onboarding chat + Check-in screens. React Query for all server state. Custom theme in `src/theme.ts`.
- **Backend:** FastAPI + MongoDB (motor). Claude Sonnet 5 via `emergentintegrations` (non-streaming). Emergent Google OAuth (session_token Bearer, 7-day).
- **Collections:** users, user_sessions, goals, messages, task_logs, checkins.

## User Personas
- Anyone with a concrete goal who wants a precise, adaptive daily action plan and accountability.

## Implemented (2026-06)
- Google sign-in (auth screen + auth context, web + mobile flows).
- Create goal → AI interview chat (suggested prompts, [PRONTO] readiness) → **Genera piano**.
- Structured plan generation: feasibility note, target summary, weekly milestones, daily tasks with metrics.
- Home: goal hero + circular progress ring + days left + today's tasks with check + metric input modal + Check-in FAB.
- Progress: streak, stats, 14-day completion bar chart, milestones timeline (toggle done).
- Coach: ongoing chat with the coach for active goal.
- Daily check-in: mood + summary + obstacles → AI feedback (recalibration message).
- Profile: user info, goals list, new goal, logout.
- Backend tested: 16/16 passing incl. real Claude interview→plan→checkin.

## Backlog
- P1: Edit/regenerate plan; per-metric progress charts (e.g. weight over time).
- P1: Streak/reminder notifications (needs native build).
- P2: Multiple concurrent goals switching; share/export plan; weekly review summary.

## Next tasks
- Metric history charts on Progress.
- Allow adjusting the plan after several check-ins (dynamic recalculation of daily tasks).
