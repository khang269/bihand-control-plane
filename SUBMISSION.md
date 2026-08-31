# Bihand — Devpost submission draft

**Event:** [All Things Agentic Hackathon](https://allthingsagentichackathon.devpost.com/)
**Track:** Fortified Enterprise Fleet
**Repo:** `<paste your GitHub/GitLab URL here after pushing this folder>`
**Architecture diagram:** `ARCHITECTURE.md` in this repo, and a standalone visual version at `<paste the artifact/exported-PNG URL here>`
**Demo video:** `<not recorded yet — see the "Demo video" checklist at the bottom>`

Copy the sections below directly into the Devpost submission form.

---

## Text description

Most "AI agents" today are a chat window with a system prompt. Bihand is a control
plane for the other kind: agents that run for hours or days, unattended, as actual
members of an org chart — a CEO, a CTO, an engineer, a support rep — each on its own
isolated cloud VM, picking up real work from a shared task board and reporting back
through a durable, encrypted database instead of a chat transcript that vanishes on
restart.

Bihand exists because "give an agent a goal and let it run in the background" turns out
to need real infrastructure the moment you take it seriously: someone has to provision
the compute, mint and rotate the agent's own credentials, keep the task/goal state alive
across the agent's restarts (or across a *different* agent picking the task back up),
enforce that an agent can only ever act as itself, and give a human an org chart and a
task board to actually manage the fleet by. That infrastructure — not one more chatbot
UI — is what this project builds.

## Features and functionality

- **Frictionless for a judge to actually try** — sign-in is email/password (no Google
  account, no OAuth app to register), and there is no credit/billing wall in front of
  any action: bring your own GCP project and LLM API key and deploy immediately. You
  pay Google Cloud and your LLM provider directly — this platform doesn't meter or
  gate on a purchased balance anywhere.
- **Fleet provisioning** — define an org chart (CEO/CTO/engineer/support/…), pick an
  agent runtime per role (Claude Code, Codex, OpenClaw, OpenCode, Hermes, NemoClaw), and
  deploy: the platform creates one isolated GCP Compute VM per agent and bootstraps its
  runtime automatically.
- **A durable task board, not a chat window** — goals, tasks, routines (cron-scheduled
  recurring work), approvals, and comments live in MongoDB with an explicit state
  machine (`backlog → todo → in_progress → in_review/blocked/failed → done`). An agent
  that crashes and restarts — or hands a task to a different agent — resumes from that
  state, not from a lost context window.
- **Machine-to-machine agent protocol** — a dedicated, token-authenticated API
  (`/api/internal/*`) lets agents check out their next task, delegate subtasks, report
  status, and post a heartbeat/watchdog signal — completely separate from the
  human-facing JWT-authenticated dashboard API.
- **Zero-trust agent identity** — every agent VM gets its own per-instance token; a
  compromised agent can only ever act as itself, never as another agent or a human user.
- **Encrypted credential vault** — every provider API key and OAuth token is protected
  with Client-Side Field Level Encryption before it reaches the database.
- **Live observability** — a WebSocket activity stream and a persistent audit trail
  (`runs`/`activity` collections) give a real-time and historical record of what every
  agent did.
- **Google Workspace + outbound social tools for agents** — short-lived, per-request
  OAuth tokens for Gmail/Calendar/Drive (refresh tokens never touch agent-VM disk), plus
  outbound posting to Reddit/Facebook/Instagram/Threads/LinkedIn/X.
- **A second, independent example of the same pattern** — an inbound customer-support
  pipeline (Messenger/Zalo) that attaches messages to a durable conversation record and
  hands them to an agent for an asynchronous, policy-governed reply.
- **Two generative-AI studios** built directly on the Gemini/Veo APIs (Architecture
  Studio for image generation, Film Studio for video) — included in this snapshot
  because they're this codebase's most direct example of the required GenAI SDK usage.

## Technologies used

Gemini API (`gemini-3.5-flash`), Vertex AI, `google-genai` Python SDK, Veo, Imagen,
Google Cloud Compute Engine, Google Kubernetes Engine, Cloud Build, Artifact Registry,
FastAPI, Uvicorn, MongoDB (Client-Side Field Level Encryption via `pymongocrypt`),
Celery, Redis, LiteLLM, React 19, TypeScript, Vite, TailwindCSS, Docker,
paramiko (SSH), PyJWT, bcrypt.

## Other data sources used

None beyond what operators/agents supply themselves at runtime — no third-party
dataset is bundled. Agents pull whatever live data their assigned task requires through
their own configured tools (Google Workspace, social platforms, whatever MCP servers or
credentials the operator attaches to that agent).

## Findings and learnings

- **The hard part of "autonomous agents" is almost entirely infrastructure, not
  prompting.** Durable state, credential scoping, and a real identity model for the
  agent turned out to matter more for "operates with little to no hand-holding" than
  any prompt-engineering choice.
- **Treating the task board as the interface — not the chat window — is what makes an
  agent restart-safe.** Once state lives in MongoDB instead of a context window, "the
  agent crashed" and "a different, better agent should finish this" become the same
  non-event.
- **Preparing this exact repo for open publication surfaced real findings worth naming
  honestly**, since judging weighs "how you secure credentials" directly: the private
  codebase had a live (now-rotated) API key committed to a compose file, a hardcoded
  admin-email allowlist, and a hardcoded OAuth client ID shipped as a frontend fallback.
  All three are fixed in this snapshot — real credentials replaced with
  operator-supplied environment variables, admin access made config-driven. That's not
  cosmetic: a hardcoded admin backdoor in particular is exactly the kind of thing "does
  it violate enterprise security policy" is asking about.
- **A hosted product's login and billing model actively fights an open-source
  submission's usability.** The private codebase required Google OAuth to sign in at
  all and gated every provisioning action behind a Stripe-purchased credit balance —
  fine for a hosted SaaS, actively hostile to "a judge clones this and tries it in five
  minutes." Both are removed here: local email/password auth is the default (Google is
  now an optional extra), and every credit/balance check across instance, fleet, and
  studio provisioning was removed rather than just raised to a generous limit — so
  nothing quietly starts blocking again later.
- **What we'd build next** (see `ROADMAP.md`): pluggable Docker/Kubernetes agent
  backends so the platform runs with zero cloud account for local development, and a
  real automated test suite — there is currently none.

---

## Required-tech checklist (per hackathon rules)

- [x] **Gemini 3.5 or newer**, via the Gemini API — `fastapp/controllers/llmController.py`
      force-maps every proxied inference call to `gemini-3.5-flash`.
- [x] **A Google Agent Framework / GenAI SDK** — `google-genai` (`from google import
      genai`), used directly in `fastapp/services/generationService.py`,
      `fastapp/utils/utils.py`, and `fastapp/tasks.py` for both the Gemini API and
      Vertex AI paths.
- [x] **A Google Cloud infrastructure service** — deployed as 4 containers on **GKE**
      (`cloudbuild.yaml`, `Dockerfile.api/.worker/.beat/.litellm`, pushed to Artifact
      Registry); agent workloads run on isolated **Compute Engine** VMs.
- [x] **Bonus: Veo / Gemma / Lyria integration** — Film Studio drives **Veo**
      (`veo-3.1-fast-generate-preview` / `veo-3.1-generate-preview`) for video
      generation; Architecture Studio drives Gemini image models for stills.

## Spin-up instructions

See `README.md` → "Getting started (local)". Summary: `cp .env.template .env` and
`cp fastapp/.env.example fastapp/.env`, fill in a free Gemini API key plus two generated
secrets, then `docker compose -f docker-compose.test.yml up --build` — MongoDB and Redis
run as bundled local containers, so no cloud account is required just to boot the
control plane and explore the dashboard/API. Open the frontend and sign up with any
email/password (no Google account, no invite). This was verified end-to-end while
preparing this snapshot: the API boots, runs its DB migrations, serves real requests
against a local `mongo:7` container with zero external accounts, and `POST
/api/auth/register` → `/api/auth/login` → `GET /api/auth/me` were exercised directly
against a running instance and confirmed to issue a working JWT with no password hash
leaking into the response.

## Demo video checklist (record before submitting — not done yet)

- [ ] ~4 minutes. Screen-record, don't edit-cut the live demo portion.
- [ ] Open with the problem in one sentence + who has it (state it the way the "Text
      description" above does).
- [ ] Show the org-chart/fleet dashboard, deploy a fleet, show an agent VM actually
      picking up and completing a real task end-to-end.
- [ ] Show the **Google Cloud proof**: the GKE workload/Cloud Run dashboard, or Cloud
      Build history, or Vertex AI / Gemini API logs, or the `.run`/GKE URL the demo is
      hitting — the rules require this to be visible in the video, not just claimed.
- [ ] Close with the value proposition in one sentence.

## Bonus points (optional, both cheap given what's already true)

- [ ] Publish a short public write-up (Medium/dev.to/YouTube) on how this was built,
      stating explicitly it was written for this hackathon.
- [ ] One social post on X/LinkedIn/Instagram/Facebook with `#AllThingsAgenticHackathon`.
