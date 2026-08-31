# Bihand — Devpost submission draft

**Event:** [All Things Agentic Hackathon](https://allthingsagentichackathon.devpost.com/)
**Track:** Fortified Enterprise Fleet
**Repo:** `<paste your GitHub/GitLab URL here after pushing this folder>`
**Architecture diagram:** `ARCHITECTURE.md` in this repo, and a standalone visual version at `<paste the artifact/exported-PNG URL here>`
**Demo video:** `<not recorded yet — see the "Demo video" checklist at the bottom>`

Copy the sections below directly into the Devpost submission form.

---

## Elevator pitch

> Bihand hires AI agents as real employees — CEO, CTO, engineer, support rep — each
> running for days on its own GCP VM with durable state and zero-trust identity, not
> one more chatbot that forgets everything when the tab closes.

A tighter, tagline-length cut if the field is character-limited:

> The control plane that runs a company of AI agents — not a chat window, a payroll.

---

## Project story

### Inspiration

Every "AI agent" demo looks the same: open a chat window, type a goal, watch it think
out loud, close the tab, lose everything. That's fine for a five-minute trick. It's not
what "autonomous" is supposed to mean. We wanted to know what actually breaks the moment
you take "agents that work in the background for days" literally — and it turns out
almost none of it is prompting. It's the boring infrastructure nobody demos: who
provisions the compute, who owns the agent's credentials, where does "what was this
agent doing when it crashed" live, and how do you stop one compromised agent from acting
as every other agent in the fleet. Bihand is what we built to answer those questions —
an actual org chart of AI employees, not a chatbot with a system prompt.

### What it does

Bihand provisions and runs *fleets* of autonomous AI agents — CEO, CTO, engineer,
support rep — as long-lived, cross-session "employees," each on its own isolated GCP
Compute VM, running one of six agent runtimes (Claude Code, Codex, OpenClaw, OpenCode,
Hermes, NemoClaw). A human designs the org chart and a task board in a React dashboard;
agents pick up real work from that board over a dedicated machine-to-machine API, using
their own per-instance identity token, and report back into a durable state machine that
survives an agent restart, a crash, or a different agent picking up the same task
mid-flight. Two more things ride the same "durable state + an agent acting on it
asynchronously" shape: an inbound customer-support pipeline (Messenger/Zalo → an agent
drafts or auto-sends a reply), and two Gemini/Veo-powered creative studios for generated
imagery and video. Every credential — provider API keys, OAuth tokens, agent tokens — is
protected with Client-Side Field Level Encryption before it ever reaches the database.

### How we built it

FastAPI + MongoDB + Celery + Redis on the backend, React 19 + TypeScript on the front,
deployed as four containers to GKE via one Cloud Build pipeline. The core design
decision is that agents never talk to the browser or each other directly — every
interaction is mediated through the API, so MongoDB is always the single source of truth
for what an agent is doing and why. Fleet provisioning is a strategy pattern (one class
per agent runtime) that injects a bootstrap script via GCP VM metadata; the M2M protocol
is a completely separate, token-authenticated surface from the human-facing JWT API, so
an agent can never accidentally (or maliciously) act with a human's authority. For this
submission specifically, we also did a full pass to make the repo something a judge can
actually pick up and run: swapped the only-Google-account login for a default
email/password flow, and removed every credit/billing gate across the codebase rather
than just raising the limit — so a judge with their own GCP project and LLM key hits
zero friction between `git clone` and using every feature.

### Challenges we ran into

The hardest part wasn't the happy path — it was making the *failure* paths trustworthy.
An agent VM can die mid-task; the platform has to notice, put the task back in the
queue, and let a different agent finish it without losing context, which meant treating
the task-status state machine as the actual product surface, not an afterthought.
Preparing this exact repo for open publication surfaced real findings the hard way: the
private codebase we forked from had a live API key committed to a Docker Compose file, a
hardcoded admin-email allowlist, and a hardcoded Google OAuth client ID shipped as a
frontend fallback — all real, all fixed, all called out honestly in this repo's git
history rather than swept under the rug. And once we removed the credit system, we found
it had quietly been the *only* thing preventing an idle instance from running forever —
so "remove billing" wasn't a one-line change, it meant re-checking every code path that
had implicitly depended on it.

### Accomplishments that we're proud of

A judge can `git clone`, `docker compose up`, sign up with an email and password, add
their own GCP project and Gemini key, and be running a real multi-agent fleet inside
minutes — no Google Cloud OAuth app to register, no credit card, no "insufficient
balance" wall anywhere in the product. We verified that claim isn't marketing copy: we
booted the actual API against a real local MongoDB with zero external accounts
configured, hit `/register` → `/login` → `/me` and confirmed a working session with no
password hash leaking into the response, and made a real provisioning call with a fake
API key to confirm it fails on key validation, not a 402 credit check.

### What we learned

The hard part of "autonomous agents" is almost entirely infrastructure, not prompting:
durable state, credential scoping, and a real identity model for the agent mattered more
for "operates with little to no hand-holding" than any prompt-engineering choice did. And
a hosted product's login and billing model actively fights an open-source submission's
usability — what's a sensible default for a paying SaaS customer (require an OAuth app,
meter every action against a purchased balance) is exactly the friction that stops a
judge from ever seeing the product work.

### What's next for Bihand

See `ROADMAP.md` for the long-form version, but the short list: pluggable Docker and
Kubernetes agent-compute backends so the platform runs with zero cloud account at all for
local development (GCP stays supported, just no longer the *only* option), a real
automated test suite (there is currently none), and self-service account management
(password reset, admin promotion through the UI) now that local accounts are the
default sign-in path instead of an afterthought behind Google.

---

## Built with

25 tags, prioritized so the required/bonus tech (Gemini, GenAI SDK, GCP infra, Veo) reads
first — paste each as its own tag in Devpost's "Built With" field:

```
gemini, google-genai-sdk, vertex-ai, veo, google-cloud-platform,
google-kubernetes-engine, compute-engine, cloud-build, python, fastapi,
uvicorn, mongodb, client-side-field-level-encryption, celery, redis,
litellm, docker, jwt, bcrypt, paramiko, websocket, react, typescript,
vite, tailwindcss
```

| # | Tag | Why it's here |
|---|---|---|
| 1 | `gemini` | Every proxied inference call is force-mapped to `gemini-3.5-flash` |
| 2 | `google-genai-sdk` | `google-genai` (`from google import genai`) — the official SDK, used directly |
| 3 | `vertex-ai` | `generate_video_vertexai` and other `vertexai=True` code paths |
| 4 | `veo` | Film Studio's video generation (`veo-3.1-*`) — bonus-points model integration |
| 5 | `google-cloud-platform` | The umbrella platform this is built and deployed on |
| 6 | `google-kubernetes-engine` | 4 images deployed to GKE via one Cloud Build pipeline |
| 7 | `compute-engine` | Every agent runs as an isolated GCE VM |
| 8 | `cloud-build` | `cloudbuild.yaml` — builds and pushes all 4 images |
| 9 | `python` | Backend language |
| 10 | `fastapi` | The stateless REST API framework |
| 11 | `uvicorn` | ASGI server |
| 12 | `mongodb` | Single source of truth / state machine |
| 13 | `client-side-field-level-encryption` | Every stored credential is CSFLE-encrypted, not app-level bolted-on |
| 14 | `celery` | Background worker + scheduler (beat) tier |
| 15 | `redis` | Celery broker + WebSocket pub/sub |
| 16 | `litellm` | OpenAI-compatible sidecar proxying to Gemini |
| 17 | `docker` | Local dev stack + all 4 production images |
| 18 | `jwt` | Human-facing session auth |
| 19 | `bcrypt` | Local email/password hashing |
| 20 | `paramiko` | SSH transport for agent VM bootstrap/file management |
| 21 | `websocket` | Live fleet-activity + provisioning-log streaming |
| 22 | `react` | Frontend framework (React 19) |
| 23 | `typescript` | Frontend language |
| 24 | `vite` | Frontend build tool |
| 25 | `tailwindcss` | Frontend styling |

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
