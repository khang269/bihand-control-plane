# Roadmap: open-source port of Bihand — agent provisioning + M2M control plane

> **Status note (hackathon submission):** this document is the maintainer's internal
> planning doc for turning Bihand into a fully self-hostable, zero-cloud-account
> community project — pluggable Docker/Kubernetes agent backends, a leaner core with
> the creative verticals split out, a real test suite, etc. **None of the phases below
> have been executed yet.** What's actually in this repo is a lighter, faster pass done
> specifically for this hackathon submission: real credentials and infra-specific
> identifiers stripped, the Trading Studio vertical removed (its Cloud Run sandbox image
> isn't included here), everything else — including Architecture Studio and Film Studio,
> which are this codebase's actual Gemini/Veo GenAI-SDK usage — left as-is. This doc is
> included to show the architectural thinking behind where the project is headed, not as
> a changelog of what already happened. See `README.md` for what's actually true of this
> snapshot today.

## Context

Bihand (Miner Claw API) is a FastAPI + MongoDB + Celery + React control plane that provisions
fleets of AI coding agents as autonomous "employees". Today it runs **only** on the owner's GCP
project: agents are Compute Engine VMs, reached by SSH over public IP, bootstrapped by 4,528 lines
of bash embedded in Python f-strings and injected as GCE metadata startup scripts.

We want a genuine community open-source project, scoped to **agent provisioning and the
machine-to-machine agent architecture only**, that runs on **local Docker**, **any Kubernetes**, or
**the user's own GCP**. The commercial/hosted version — including all creative/analytical verticals —
stays in this private repo.

Three things make this harder than a license-and-push:

1. **It cannot run without a cloud account.** `docker-compose.test.yml` has no MongoDB service (it
   expects remote Atlas), GCP Compute is the only provisioner, and Google ID token is the only login
   path. There is no provider abstraction of any kind.
2. **The repo cannot be published as-is.** A live `GEMINI_API_KEY` sits in git history
   (`docker-compose.test.yml:26`, commits `be8696b`/`fc962dc`/`f4026f6`), and
   `support@graphicsminer.com` is a **hardcoded admin allowlist** — shipping it makes the maintainer
   a permanent admin on every third-party deployment.
3. **70% of the repo is vendored trading code** that is now out of scope entirely.

Intended outcome: a ~33k-line, comprehensible, tested repo where **`docker compose up` with no
credentials of any kind** — no Google account, no LLM API key, no MongoDB Atlas — gets you a running
control plane in under 10 minutes, and the same codebase scales to K8s or GCP by changing one env
var. The developer supplies their own LLM key later, in the UI, as a credential attached to agents.

### Decisions already made (do not revisit)

| Decision | Choice |
|---|---|
| Repo strategy | New clean public repo, single initial commit. This repo stays private. |
| Scope | **Agent provisioning + M2M architecture only.** All verticals removed, not plugged in. |
| Agent runtime | All three placements are the end goal, but not equally prioritized. **Docker and Kubernetes are the core architecture track** — both need no cloud account and drive the `ComputeBackend`/`AgentTransport` seam design. **GCP-VM is real, already-working legacy code left deliberately untouched**, not migrated onto the new seams as part of the critical path — see Provisioning sequencing and the Backlog section. |
| Billing | **Removed entirely.** No Stripe, no credit ledger. |
| Naming | **Keep `bihand`/`minerclaw`.** Strip only infra identifiers (project ID, bucket, domains, admin email). |
| Agent-facing features | **Keep everything agent-related** — social posting, Google Workspace tooling, skills/instructions management. |
| **LLM provider** | **`provider="bihand"` and the LiteLLM shared-key gateway are deleted outright, not merely disabled.** Genuine open source means every agent uses a credential the developer supplies themselves — no operator-hosted proxy, no "off by default" flag to re-enable later. |
| Avatars | Remove the sticker-service proxy and `avatarHash` entirely. |
| **Credentials** | **Zero-credential boot is a hard requirement.** No operator-supplied LLM key, no Google OAuth app, no Atlas. The only credential involved at boot is MongoDB's own connection string, and it points at the bundled `mongo:7` container — a local placeholder, never an external account. BYOK for everything else via the existing credentials UI. |
| Local agent creation | Mount the Docker socket; document the risk. |
| **Release strategy** | **Staged rollout, not one drop — and cloud-provider work is explicit backlog, not a phase.** Core track: config/auth/zero-cred boot → Docker → Kubernetes → deployment artifacts → docs/GA. GCP-VM keeps working via its untouched legacy path throughout, but wiring it onto the new seams + a terraform module is deferred, tracked separately — see Release roadmap and Backlog — bring your own GCP. |

Keeping the names is load-bearing for the schedule: it avoids a 47-file mechanical rename that
would conflict with every other phase, and leaves the ~1,118 lines of agent prompt text in
`services/agentProfileService.py` untouched.

---

## Scope: what ships, what goes

### In scope — the agent control plane

| Area | Components |
|---|---|
| Identity | `authController` + a new pluggable `AuthProvider` (google / oidc / local) |
| Fleets & org | `fleetController` (2,489 L), `fleetModel`, org chart, roster import |
| Work | `workController` — goals, tasks, routines, approvals, activity, comments |
| **M2M protocol** | `agentM2MController` (783 L) — the agent-facing contract |
| Instances | `instanceController`, `instanceModel`, lifecycle + SSH file manager |
| Provisioning | `provisionerService`, `provisioning/*`, `gcpService`→compute, `sshService`→transport |
| Agent config | `agentProfileService` (1,118 L), `mcp_normalizer`, skills/instructions sync |
| Agent tools | **Social posting** (`socialUtils`), **Google Workspace** (`gogcli` + token proxy) |
| Credentials | `credentialController` — provider keys (CSFLE) + Workspace OAuth |
| Realtime | `websocketController` — activity, provision logs, agent chat |
| Admin | `adminController`, `healthController` |
| Frontend | dashboard, wizard (`Incorporate.tsx`), `fleet/*`, credentials, admin |

**`llmController` is deleted, not kept-but-disabled.** A previous revision of this plan argued it
was load-bearing infrastructure — verified: `openclaw_strategy.py:107`, `codex_strategy.py:65`, and
`open_code_strategy.py:43` all wire agents to `{base}/api/llm/v1` as the `bihand-proxy` model
provider when that provider is selected. That is exactly the "operator hosts a shared key for the
whole fleet" hosted concept the user has now ruled out entirely, not just made optional. Removing it
does **not** remove BYOK: `PROVIDER_CONFIG` (`base_strategy.py:6-39`) already has direct entries for
the real providers (OpenAI, Anthropic, Gemini, …) that the three strategies route to when the
developer picks one of those instead — that path is untouched. Deleted with it: `llmController.py`,
`utils/bihandKey.py`, the `bihand` entry in `PROVIDER_CONFIG`, the `provider == "bihand"` branches in
the three strategies, the `litellm` compose service, `Dockerfile.litellm`, `litellm-gke.yaml`.

### Out of scope — deleted in P0

| Removed | Backend | Frontend |
|---|---|---|
| Architecture Studio | `architectureController` 780, `execute_architecture_task` ~200 | `ArchitectureStudio.tsx` 2,508 |
| Film Studio | `filmStudioController` 341, 2 Celery tasks ~506 | `FilmStudio.tsx` 1,552 |
| Trading Studio | `tradingStudioController` 252, `sandboxController` 491, `tradingService` 299, `cloudRunJobs` 80, `sandboxKey` 83, 2 Celery tasks ~104, `sandbox/` 1,055 | `TradingStudio.tsx` 890, `components/trading/` 267 |
| Vendored engine | `src/` 108,005 + `backtest/` 12,876 | — |
| Generation / object storage | `generationService` 377, `utils/fileUtils` 294 | — |
| Avatars | `avatarController` 187, `avatarHash` (13 sites) | `AvatarImage.tsx` 38, `avatarCache.ts` 159, 7 files edited |
| Billing | `billingController` 123 | `Billing.tsx` 225 |
| Docs | `STICKER_TOOL_USAGE.md` 1,183, `TRADING_STUDIO_ARCHITECTURE_PROPOSAL.md` 464 | — |

**≈132,000 lines removed.** `fastapp/` drops 23,072 → ~19,000; `tasks.py` drops 2,020 → ~1,210;
`frontend/src/` drops 19,197 → ~13,600. Core repo lands around **33k lines of code**.

**Three consequences worth noting:**

1. **Object storage disappears from the architecture.** Verified: `generationService` and
   `utils/fileUtils` GCS helpers are used *only* by the two studios. The fleet core never touches a
   bucket — the agent file manager streams over SSH. So the `ObjectStore` abstraction, the
   `google-cloud-storage` dependency, `GCS_BUCKET_NAME`, and the signed-URL/`signBlob` logic all drop
   out. One fewer provider seam to build.
2. **The app no longer needs a server-side Gemini key at all, and now never proxies one either.**
   `GEMINI_API_KEY`/`GOOGLE_API_KEY` existed only for the studios and the trading sandbox — gone with
   them. `validatorService` validates *user-supplied* provider keys directly; there is no
   `llmController`/LiteLLM hop left to hold an operator-side key. The leaked key's function is gone
   from the codebase entirely, and so is the class of leak it represents.
3. **The plugin API is dropped** (was a 3-week phase). With no verticals there is nothing to plug in.
   The extensibility a community actually needs here is narrower and already covered: **agent-runtime
   entry points** for new agent types (P6) and a **compute-backend registry** for new placements (P5).

Dependencies removed from `requirements.txt`: `stripe`, `google-cloud-storage`, `google-genai`,
`yfinance`, plus the trading engine's transitive set (pandas/numpy/scipy/ccxt).

---

## Zero-credential bootstrap

**The guarantee:** `git clone && docker compose up` produces a working control plane with no
accounts, no API keys, and no cloud services. The operator never supplies an LLM key to *run the
platform* — they add their own key later, in the UI, as a credential attached to agents.

That mechanism already exists and needs no new design: `credentialController` (POST/GET/PUT/DELETE +
`/validate`) stores per-user provider keys CSFLE-encrypted via `CredentialModel`, and
`fleetController` resolves an agent's credential at provisioning time. The work is removing the
places that demand a *platform-level* credential at boot.

### What blocks a credential-free boot today, and the fix

| Blocker | Today | Fix |
|---|---|---|
| **MongoDB** | `init_db` (`database.py:84-92`) hard-raises on missing `MONGODB_URI`/`MONGODB_DATABASE`; compose has no mongo service, expects Atlas | Ship `mongo:7` in compose; default URI `mongodb://mongo:27017`, database `bihand` |
| **CSFLE key** | `init_db` hard-raises on missing `MONGO_KEY` | `scripts/init-env.sh` generates 96 random bytes on first run — see the warning below |
| **Key vault** | Nothing creates `encryption.__keyVault` or the `data_key` DEK that `database.py:52` encrypts with — **first credential write hard-fails** | `scripts/bootstrap_keyvault.py`, called idempotently from `init_db()` |
| **Login** | Google ID token is the only path (`authController.py:146`) | `auth.provider=local` default; first-run admin bootstrap |
| **Frontend login** | `Login.tsx:59` + `Incorporate.tsx:1649` hardcode a **live Google OAuth client ID** as fallback | Strip in P0; render the provider's form based on `GET /api/auth/config` |
| **Platform LLM key** | `GEMINI_API_KEY`/`GOOGLE_API_KEY` required by the studios | Gone — deleted with the verticals in P0 |
| **Shared-key provider** | `provider="bihand"` mints an internal key (`provisionerService.py:117-120`) and routes to a LiteLLM proxy the operator must run and key | **Deleted outright** — see below, not merely gated behind a flag |
| **Provisioning gate** | `validate_key` is a mandatory pre-flight (`instanceController.py:110-116`) | Keep, but it only runs against a credential the user already added — never at boot |

### `provider="bihand"` is deleted, not disabled

An earlier revision of this plan proposed keeping `llmController`/`utils/bihandKey.py` in the
codebase and gating the provider behind `llm_gateway.enabled=false`. The user has since ruled that
out: this is meant to be a genuine open-source project where every developer brings their own
credential, full stop — not a platform with a shared-key convenience path that merely defaults off.

So the deletion is real, not a flag: `fastapp/controllers/llmController.py`,
`fastapp/utils/bihandKey.py`, the `bihand` entry in `PROVIDER_CONFIG` (`base_strategy.py:34-38`), and
the `provider == "bihand"` branches in `openclaw_strategy.py:107`, `codex_strategy.py:65`, and
`open_code_strategy.py:43` all go. Nothing breaks in those three strategies — the `{base}/api/llm/v1`
wiring was already conditional on that one provider being chosen, and the other `PROVIDER_CONFIG`
entries (direct OpenAI/Anthropic/Gemini/etc.) are what every agent uses today when the developer
picks a real provider. That path needs no new code; it already works.

The `litellm` compose service, `Dockerfile.litellm`, and `litellm-gke.yaml` are deleted along with
it — there is no shared-gateway profile to opt into, because there is no shared gateway. Default
(and only) stack: Mongo, Redis, API, worker, beat.

One consequence worth flagging early: the platform loses the ability to *observe* LLM token spend,
because that instrumentation lived inside the now-deleted proxy hop. An agent calling its own
provider key directly is invisible to the control plane's billing/metering surface by design — cost
governance for that spend is the provider's own dashboard, not this project's. See P2, which drops
the `apiSpend`/`apiBudget` circuit breaker for the same reason: its only writer was
`llmController.record_inference_spend`.

### First-run admin bootstrap

On first boot with an empty `users` collection, create an admin from `ADMIN_EMAIL` (default
`admin@localhost`) with a **randomly generated password logged once to stdout**:

```
api |  ================================
api |   ADMIN ACCOUNT CREATED
api |   email:    admin@localhost
api |   password: 7fQ2-xK9m-Lp4v-3nRt
api |   (shown once — change after login)
api |  ================================
```

Chosen over a fixed `admin/admin` because scanners actively probe that pattern and this costs
nothing; chosen over a `/setup` wizard because that needs a new frontend flow plus a lock-after-first-use
guard, which is P9 polish rather than P1 work.

### ⚠️ `MONGO_KEY` is not a throwaway

It is the CSFLE master key. **Lose it and every stored credential becomes permanently
unreadable** — provider keys, OAuth refresh tokens, agent tokens. It must be generated *once* and
persisted, never regenerated on restart. `scripts/init-env.sh` writes it to `.env` and refuses to
overwrite an existing value; the Helm chart requires an explicitly-provided secret rather than
generating one, so a `helm upgrade` can never silently rotate it. Docs must call this out plainly.

### What still needs a credential — and that's fine

Adding an LLM provider key (to run agents at all), Google Workspace OAuth (to give agents Gmail /
Calendar / Drive), and per-platform social app registrations. All are configured *after* boot,
through the credentials UI, and each self-disables when unconfigured rather than erroring — an
unconfigured integration's agent CLI verb returns a clear "not configured" message instead of a
stack trace.

---

## Architecture: three seams, three axes

The cloud coupling is narrower than it looks. `gcpService.py` is 514 lines with 6 importers, and
only **one** of seven agent strategies (`nemoclaw_strategy.py:280`, scraping a token from the serial
port) touches GCP outside it. The real work is the bootstrap layer.

**Correction to the obvious framing:** `placement × bootstrap` is *not* orthogonal — you cannot
inject a metadata startup-script into a container. And the axis that actually matters is
**transport**, which is not determined by placement (a GCP VM can be reached by SSH-over-public-IP,
SSH-over-IAP-tunnel for users behind a corporate VPC, or pull-only with no inbound at all).

```
placement:  docker | kubernetes | gcp-vm
transport:  docker-api | k8s-exec | ssh | ssh-iap     (independent; sane default per placement)
bootstrap:  image | script                            (sub-setting of gcp-vm ONLY)
```

Three protocols carry it:

- **`ComputeBackend`** — placement. Replaces direct `gcpService` calls. Capability-gated, so callers
  ask `Capability.RESIZE in backend.capabilities()` and never `if placement == "gcp-vm"`.
- **`AgentTransport`** — bound to one instance, no `ip`/`key` in any signature. Replaces the
  `(ip, private_key)` shape that every strategy method and ~40 call sites currently use.
- **`AgentEndpoint`** — the L7 proxy cases (chat WebSocket, Hermes proxy, noVNC, file manager) that
  are *not* exec. Handles port-forwarding for K8s and TLS-verify policy per placement.

Plus an `agent-runtime` pip package that collapses the four duplicated in-bash heartbeats into one
tested implementation, and becomes the single source of truth from which VM startup scripts are
*rendered* rather than hand-maintained.

---

## Provisioning sequencing: core track vs. cloud backlog

Earlier revisions of this plan conflated two separate things: "build the seams" and "keep GCP-VM
working." They don't have to happen together, and forcing them together was inflating the critical
path with GCP-specific complexity — bash-script parity, static-IP quotas, a terraform module that
doesn't exist yet — before the core abstractions were even proven against a real backend.

**Core track — what P4 onward actually builds against:** `AgentTransport` and `ComputeBackend` are
designed and proven against **Docker first, Kubernetes second** — both need zero cloud account, which
matches the zero-credential ethos, and lets the seam contracts get exercised by one real adapter
before a second is added (P5b's rationale). `agent-runtime` (P6) and its `ContainerAgentStrategy`
are Docker/Kubernetes-native from day one — they are *the* provisioning path for those two
placements, not an alternative to something older.

**GCP-VM stays exactly as it is today — untouched, not migrated, not blocking.** The 4 surviving
legacy per-agent-type strategy files (`openclaw_strategy.py`, `claude_code_strategy.py`,
`codex_strategy.py`, `open_code_strategy.py`) keep calling `gcpService.py`/`sshService.py` directly,
exactly as in the current codebase. P0 still strips secrets and infra identifiers out of that code —
a publication requirement, not a feature — but no core-track phase re-signs it onto the new seams.
The two provisioning paths coexist via the `placement` dispatch that P3's endpoint-model migration
already introduces the fields for: `if placement == "gcp-vm": <call the legacy code path unchanged>
else: <use ComputeBackend/AgentTransport>`. That branch is temporary scaffolding, deleted once the
backlog item below retires the legacy strategies.

**Practical effect on the phases below:** P4 builds `transport/docker_api.py` and
`transport/k8s_exec.py` only — `transport/ssh.py` and any change to the legacy strategies move to
backlog. P5 ships `compute/docker.py`; the `compute/gcp.py` fixes (NIC/static-IP/public-IP) move to
backlog. P6's strangler transition stops after proving the loop on Docker and Kubernetes — its
original steps 4-5 (wiring `gcp-vm` onto the same `agent-runtime` image via a `bootstrap=image` stub,
then deleting the legacy strategy files) become the backbone of the backlog item, not a P6/P7
deliverable. P8 keeps the compose stack and Helm chart; `deploy/terraform/gcp/` moves to backlog. See
**Backlog — bring your own GCP**, after the roadmap, for the full deferred scope and its own rough
estimate — importantly, none of it is a redesign: GCP becomes a third `ComputeBackend` reusing the
exact contract Docker and Kubernetes already proved.

---

## Phases

Ordering rationale: config first (the provider abstractions need somewhere to put their settings, or
we bake a 35th inconsistent `os.environ` default into a constructor). Billing removal before the
seams (it *deletes* code living inside the exact functions the compute refactor rewrites, and it
removes the `MACHINE_COST_MULTIPLIER` GCP-machine-type hardcodes the compute abstraction must
generalize anyway). Transport before compute — a **contract dependency**: `ComputeBackend.create()`
must return something a transport can consume, so build compute first and it returns a GCP-shaped
dict with `externalIp`.

```
P0  Legal / secrets / scope reduction        [GATE — nothing public until this lands]
P1  Unified config + auth providers          [unblocks everything]
P1.5 Test harness + CI                       [rail, grows continuously]
P2  Billing excision                         [shrinks P5 surface]
P3  Endpoint model + instance migration      [contract for P4]
P4  AgentTransport seam (docker + k8s only)  [contract for P5]
P5  ComputeBackend + Docker backend          [unlocks real integration tests]
P5b ComputeBackend + Kubernetes backend      [second adapter against the P5 contract]
P6  agent-runtime package + images           ── parallel from P1
P7  agent-runtime recipe polish
P8  Deployment artifacts (compose + Helm)    ── parallel from P1
P9  Docs / community / release

Backlog (not phase-numbered, not on the critical path) — bring your own GCP:
compute/gcp.py, gcp-vm bootstrap=image stub, transport/ssh.py, legacy
per-agent-type strategy deletion, deploy/terraform/gcp/. See Provisioning
sequencing above and the Backlog section after the roadmap.
```

---

### P0 — Legal, secrets, scope reduction (2 wk) — **GATE**

**Blocking security item.** Remove the hardcoded admin allowlist — `fastapp/utils/adminAuth.py:12-14`
and `fastapp/controllers/adminController.py:28-31` both hardcode `support@graphicsminer.com`.
Replace with `settings.admin_emails: list[str] = []` plus a first-run `--make-admin <email>` CLI.
(`models/userModel.py:12` is only a docstring example — scrub for tidiness, not urgency.)

**Delete all out-of-scope code** per the table above (~132k lines). Unmount the routers from
`run.py:98-115`, drop the vertical Celery tasks from `tasks.py`, and remove
`reconcile_trading_tasks_task` from `celery_app.py`'s `beat_schedule` (`:38-41`). Remove the vertical
routes and nav entries from `frontend/src/App.tsx` and `components/Layout.tsx`.

**Remove `avatarHash`.** 13 backend sites: `instanceModel.py:107,147,257-262` (including
`_updateAvatarHash`), `fleetController.py:245-247,345,414,1575,1885` (roster CSV column, Pydantic
field, provisioning passthrough), `workController.py:326` (`assigneeAvatarHash`), `tasks.py:591`.
Frontend: delete `AvatarImage.tsx` + `avatarCache.ts`, then edit the 7 consumers (`OrgChartFlow`,
`Layout`, `TasksView`, `FleetOrgChart`, `FleetAgentDetail`, `Incorporate`, `FleetDashboard`) to render
initials-based avatars locally. Drop the `avatarhash` column from `sample-org.csv`.

**Also delete:**
- `fastapp/services/provisioning/bihand_worker_strategy.py` — installs no agent, no CLI, no
  heartbeat, yet is the fallback for unknown agent types (`provisioning/__init__.py:27-28`). Make
  the dispatcher **raise** instead of silently returning an inert VM builder.
- `fastapp/controllers/llmController.py`, `fastapp/utils/bihandKey.py`, the `litellm` compose
  service/profile, `Dockerfile.litellm`, `litellm-gke.yaml`, and the `bihand` entry + selection
  branches described in the Zero-credential bootstrap section — the shared-key LLM gateway is
  removed entirely, not gated off. BYOK direct to a real provider is the only path.
- 6 verified-dead `gcpService` functions: `create_persistent_disk`, `disk_exists`, `delete_snapshot`,
  `suspend_instance`, `resume_instance`, and now `create_snapshot` too (its only caller
  `adminController.py:376` is reviewed for removal with the admin surface).
- Stale root docs CLAUDE.md itself flags as fiction: `AGENTS.md`, `CHANNEL_INTEGRATION.md`,
  `nemoclaw-script.sh`, `frontend/patch_tasks.py`, `frontend/patch_routines_2.py`,
  `frontend/src/pages/fleet/FleetAgentDetail.tsx.rej`.

**Create:** `LICENSE` (Apache-2.0 — the patent grant matters for infrastructure-provisioning code),
`NOTICE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `.gitleaks.toml`.

`SECURITY.md` must state the real threat model: agents execute arbitrary code by design, and
docker-socket placement is root-equivalent on the host. (The `Dockerfile.sandbox`-runs-as-root
concern disappears with the trading sandbox.)

**Licensing becomes trivial** once `src/` + `backtest/` are gone — the entire Vibe-Trading / Qlib
attribution obligation leaves with them. Nothing third-party-derived remains.

**Fix `.gitignore`:** invert the blanket `*.json` ignore (line 41) to explicit denies
(`**/service-account*.json`, `.mcp.json`, `.crush.json`). Consequences: only 4 JSON files are
currently tracked, so **`frontend/package-lock.json` is not committed** and `Dockerfile.api` runs
`npm install` — non-reproducible builds, no lockfile for Dependabot. Commit the lockfile, switch to
`npm ci`. Also **remove lines 57-59 and `test/`**, which actively ignore `test_*.py` — tests cannot
be committed today.

**Strip infra identifiers.** Replace every default that points at the maintainer's infrastructure
with `None` + a startup validation error (never a working default): `modular-ethos-468709-u4`
(`gcpService.py:46`), `api.bihand.com`, `bihand.graphicsminer.com`,
`sticker-generator.graphicsminer.com`. Rename the `nemoclaw-dashboard` firewall tag →
`agent-dashboard` (`gcpService.py:338`).

**Also a live credential, and easy to miss because it's a frontend fallback:** `Login.tsx:59` and
`Incorporate.tsx:1649` hardcode the maintainer's **Google OAuth client ID**
(`428686556851-0ac019md8odk9pbc23buff8m3dk1kr0u...`) as the default when `VITE_GOOGLE_CLIENT_ID` is
unset. Every self-hosted install would silently authenticate against your OAuth app. Remove both
literals; the login page renders its form from `GET /api/auth/config` instead.

**Verify:** `gitleaks detect` clean on the new single-commit history;
`grep -riE 'graphicsminer|modular-ethos|AIza|sk_live|rk_live'` returns zero;
`python -c "import fastapp"` imports; `cd frontend && npm ci && npm run build` succeeds with no
unresolved imports from the deleted pages.

---

### P1 — Unified config + auth providers (0.75 wk)

**Create `fastapp/config.py`** (pydantic-settings, `env_nested_delimiter="__"`). Replaces the
scattered `os.environ` reads — the post-deletion set is ~24 vars, down from 34. Attack in order of
inconsistency: `BIHAND_PUBLIC_API_URL` has **five** distinct fallbacks
(`provisionerService.py:161`, `tasks.py:1949`, `fleetController.py:510`,
`credentialController.py:119`, and `None` at `credentialController.py:124`). Make it **required, no
default**. Delete `fastapp/appConfig.py` — vestigial Flask-style config duplicating four vars.

```python
class ComputeSettings(BaseModel):
    placement: Placement = Placement.DOCKER      # opinionated default
    transport: TransportKind | None = None       # None -> per-placement default
    agent_image: str = "ghcr.io/<org>/agent-runtime:latest"
    gcp: GcpSettings = GcpSettings()             # project_id, network, subnetwork,
                                                 # firewall_tags, ssh_username,
                                                 # use_static_ip=False, bootstrap="image"
    docker: DockerSettings = DockerSettings()
    k8s: K8sSettings = K8sSettings()

class Settings(BaseSettings):
    # Local-first defaults: every one of these works with zero operator input
    public_api_url: AnyHttpUrl = "http://localhost:8501"
    mongodb_uri: SecretStr = "mongodb://mongo:27017"
    mongodb_database: str = "bihand"
    mongo_key: SecretStr                         # generated by init-env.sh; see warning
    jwt_secret_key: SecretStr                    # generated by init-env.sh
    admin_email: str = "admin@localhost"         # first-run bootstrap
    admin_emails: list[str] = []                 # P0 backdoor replacement
    compute: ComputeSettings = ComputeSettings()
    auth: AuthSettings = ...                     # local (default) | google | oidc
```

Note `public_api_url` now gets a working local default rather than being required — the
zero-credential guarantee outranks the five-fallback cleanup, and the value is still authoritative
and single-sourced. It must be overridden for any non-localhost deployment, which `deploy/` docs
state and the Helm chart requires.

No `ObjectStoreSettings` — object storage left with the studios.

**Bundle here:** `fastapp/auth/` — a pluggable `AuthProvider`: `local` (email+password, **the
default**), `google` (port `authController.py:146` verbatim), `oidc` (generic — this is what unblocks
self-hosters running Keycloak/Authentik). `authController` becomes a thin router over the provider
and gains `GET /api/auth/config` so the frontend renders the right login form without a compile-time
Google client ID.

**Also in P1** (both are boot-path, so they belong with config): the first-run admin bootstrap, and
`scripts/bootstrap_keyvault.py` called idempotently from `init_db()` — the key vault is what makes
the first credential write succeed, so it cannot wait for P8.

**Verify:** `Settings()` on an empty `.env` raises one aggregated error naming every missing var.
`scripts/gen_env_example.py` generates `.env.example` **from the schema**, with a CI check that
regenerating produces no diff — so it can never drift into the state `.env.template` is in today
(documents 20 of 34).

---

### P1.5 — Test harness + CI (0.5 wk, then continuous)

There are **zero** tracked tests today. Create `pyproject.toml` (replacing bare
`requirements.txt`), `pytest.ini`, `ruff.toml`, `tests/conftest.py` with a real `mongod` fixture —
**not mongomock**, which cannot do CSFLE and would test a fiction.

First targets, chosen for value density:
- `tests/unit/test_mcp_normalizer.py` — 169 lines, three on-VM JSON shapes, and CLAUDE.md explicitly
  warns "don't write MCP JSON to a VM by hand." Table-driven round-trip.
- `tests/unit/test_task_transitions.py` — the full 8-state matrix for
  `TaskModel._evaluate_transitions` plus the stricter human-facing subset in
  `workController.update_task`. Pure state machine, business-critical, zero coverage.
- `tests/unit/test_base_strategy_parsing.py` — **characterization tests that fail today** on two
  confirmed bugs in `base_strategy.py`: `logger` is used at lines 138 and 169 but never imported
  (`NameError` on any skills failure path), and `_get_files_from_vm` (lines 68-69) splits on the
  literal two-char string `"\\n"` while `_get_skills_from_vm:114` does it correctly. Fix under test.
- `tests/unit/test_agent_m2m_auth.py` — every `/api/internal` route with a bad `X-Agent-Token`, every
  admin route as a non-admin. Given the P0 backdoor finding, an authz suite is not optional.

`.github/workflows/ci.yml`: `lint` (ruff + mypy strict on new packages only), `test-unit`,
`frontend` (`npm ci && npm run lint && npm run build`), `secrets` (gitleaks on every PR), `deps`
(pip-audit + npm audit), `docker-build`. Stub `test-integration`, enable in P5.

Explicit non-goal: a coverage percentage. Target the transition matrix, the normalizer, the script
renderer (P6), the authz matrix, and one end-to-end docker loop (P5).

---

### P2 — Billing excision (1 wk)

Smaller than it was — the studios' credit-debit code left with their files in P0.

**Delete:** the credit ledger (`userModel.py:154-172` `_addCredits`/`_deductCredits`, `:47`
`"credits": 150`, the `transactions` collection). `MACHINE_COST_MULTIPLIER`
(`instanceController.py:52-59`) and the **six** duplicated inline `machine_credit_costs*` dicts in
`fleetController.py` (`:1501, :1626, :1820, :1901, :2008, :2069`). All credit gates and refund paths
(`provisionerService.py:378-393`, `tasks.py:225-226, 262-263`). The `/extend` and monthly-cost
endpoints.

**Convert → estimated infra cost, not LLM spend.** Drop the `users.credits` deduction; rename
`apiCreditsUsed` → `apiSpendUsd` where it still applies to compute, not tokens. Surface
`gcpService.MACHINE_CATALOG` prices via `ComputeBackend.catalog()` as an explicitly-labelled
`estimated_usd_per_hour` (Docker returns `None`). Replace the credit-preview panel in
`frontend/src/pages/Incorporate.tsx` (2,280 lines, 14 credit refs) with a VM-cost-estimate panel —
the largest single frontend edit in this phase, ~1 day.

**`llmController` and its IP-based spend attribution are deleted, not fixed.** A previous revision
of this plan flagged `llmController`'s four source-IP spend-attribution sites (`:227, :288, :465,
:518`) as a docker-placement blocker needing a `bh_` key fix. That whole subsystem is now removed
along with the `provider="bihand"` gateway (see Zero-credential bootstrap) — there is no proxy left
to attribute spend through, so there is nothing left to fix.

**Drop the budget circuit breaker — it has no data source left.** The `fleet.apiSpend` vs
`apiBudget` gate in `agentM2MController GET /tasks/next` was fed exclusively by
`llmController.record_inference_spend`. With that proxy deleted, `apiSpend` never increments for a
BYOK agent calling its provider directly, so the gate would silently and permanently read zero.
Remove the gate, `apiSpend`/`apiBudget` fields, and the `record_inference_spend` helper together.
Token-spend governance becomes the developer's own provider dashboard — consistent with "no billing
at all."

**Convert → TTL/idle reaper (the important one).** `tasks.py:436-533`
`check_expired_instances_task` is not merely a credit janitor — its stop-and-notify half
(`:507-527`) is **the only mechanism in the codebase preventing unbounded cloud spend**. Rename to
`reap_idle_instances_task`, keep the action half unchanged (`stopping_queued` →
`stop_instance_task.delay()` → comment notification → fleet rollup at `:528-533`), replace only the
trigger: stop if `ttlExpiresAt` is past, **or** if no activity for `idleStopAfterMinutes`. Rename
`lastBilledAt` → `lastActivityAt`. Both default unset.

**Verify:** `grep -rniE 'credit|stripe|bihand.*proxy|apiBudget' fastapp/` returns only `apiSpendUsd`
hits describing the VM cost estimate. Full provisioning works against a user document with no
`credits` field at all, and against an agent whose only configured credential is its own provider
key.

---

### P3 — Endpoint model + instance migration (0.5 wk)

Create `fastapp/migrations/v0_2_0_migration.py`, registered in `runner.py:11`. Purely additive
backfill on `instances`:

```
placement: "gcp-vm"   backend: "gcp"   bootstrap: "script"
handle:   {vmName, zone}                       # backend-opaque
endpoint: {kind: "public-ip", host: <externalIp>,
           ports: {gateway: 18789, novnc: 6080, https: 443}}
```

Keep `externalIp`/`vmName`/`zone` as denormalized mirrors for **one release** so the frontend and any
missed call site keep working; drop in v0_3_0. Update the `instanceModel.py:56-80` docstring, which
currently documents `externalIp` as authoritative.

**Also here:** transport-ify `migrations/runner.py`'s `upgrade_vm` hook (`:79-140`) and
`v0_1_0_migration.py:60`'s direct `externalIp` read — a third transport-coupled surface that P4 will
otherwise break silently.

---

### P4 — `AgentTransport` seam (1.0 wk)

Derived from what the 12 `sshService` importers actually need — no speculative methods.

```python
class AgentTransport(Protocol):
    """Bound to ONE instance, constructed by resolve_transport(instance).
    No method takes ip/key — that is the entire point."""
    instance_id: str
    def probe(self, timeout: float = 5.0) -> bool: ...
    def exec(self, cmd, *, timeout=600.0, cwd=None, env=None,
             privileged=False) -> ExecResult: ...
    def exec_stream(self, cmd, *, timeout=600.0, privileged=False) -> Iterator[str]: ...
    def list_dir(self, path) -> list[FileEntry]: ...
    def read_file(self, path) -> bytes: ...
    def write_file(self, path, data, *, mode=0o644, owner=None) -> None: ...
    def delete_path(self, path, *, recursive=False) -> None: ...
    # FIRST-CLASS tar streams — not composed from exec + read_file
    def get_archive(self, path, *, exclude=()) -> Iterator[bytes]: ...
    def put_archive(self, path, stream, *, owner=None) -> None: ...
    def close(self) -> None: ...
```

`privileged=True` replaces the ad-hoc `sudo ` prefixes littered through `base_strategy.py`.

**Tar is first-class deliberately.** `docker-py` provides `get_archive`/`put_archive` natively,
Kubernetes gives the equivalent via exec-with-tar, and SSH implements it with the existing
`sudo tar -czf` dance. That makes `realize_workspace_sync_task` (`tasks.py:1016-1049`) and
`reconfigure_gc_and_migrate_workspace_task` (`:1106-1128`) backend-agnostic with **zero logic
change** — the four-step compress/download/upload/extract becomes
`t_src.get_archive(dir, exclude=[...])` piped into `t_tgt.put_archive(dir, owner=...)`. `exclude`
and `owner` are in the signature precisely because those sites need
`--exclude='.mcp.json' --exclude='.git' --exclude='deliverables'` and `chown -R 1000:1000`.

Separate protocol for the L7 cases that are not exec (`websocketController.py:256`,
`hermesProxyController.py:32`, the `instanceController` file manager, `run.py:133`, noVNC):

```python
class AgentEndpoint(Protocol):
    def http_base(self, port_name="gateway") -> str: ...
    def ws_url(self, path, port_name="gateway") -> str: ...
    @contextmanager
    def forward(self, port_name) -> Iterator[tuple[str, int]]: ...
        # gcp-vm: no-op public IP | docker: container IP | k8s: real port-forward
    @property
    def tls_verify(self) -> bool: ...   # self-signed -> False (matches CERT_NONE today)
```

**Implementations — core track:** `transport/docker_api.py` and `transport/k8s_exec.py` only.
`transport/ssh.py` (porting `sshService.py`) is **backlog**, bundled with the GCP migration (see
Provisioning sequencing) — the legacy strategies keep calling `sshService.py`/`gcpService.py`
directly and are untouched by this phase. **Factory** `transport/resolve.py::resolve_transport(instance)`
dispatches on `instance["placement"]`; for `gcp-vm` it stays a pass-through to the legacy code path
until the backlog item lands, not a real adapter yet.

**Modify (core track only):** the shared call sites that need to branch by placement rather than
assume SSH unconditionally — `instanceController.py`'s file manager/console endpoints, and the parts
of `fleetController`/`provisionerService`/`tasks.py` that dispatch provisioning by placement. The
larger edit originally scoped here — re-signing all 11 `BaseProvisioningStrategy` methods
(`base_strategy.py:62-244`) and the 4 legacy strategies onto `AgentTransport` — is **not needed**:
those files stay on their current `(ip, private_key)` shape until the backlog item retires them
entirely in favor of `agent-runtime` (see P6's strangler transition).

**Verify — core track:** `tests/integration/test_transport_conformance.py`, one parametrized class
across `docker` and `kubernetes`. The SSH conformance case (`linuxserver/openssh-server` in compose,
covering `_get_sudo_sftp`) is added by the backlog item once `transport/ssh.py` actually exists.

---

### P5 — `ComputeBackend` + Docker backend (1.5 wk)

```python
class ComputeBackend(Protocol):
    name: str
    def capabilities(self) -> frozenset[Capability]: ...   # STOP_START, RESIZE, SNAPSHOT,
                                                           # CONSOLE_LOGS, COST_ESTIMATE, ...
    def catalog(self) -> list[SizeOption]: ...
    def create(self, spec: InstanceSpec) -> tuple[InstanceHandle, InstanceState]: ...
    def get(self, h) -> InstanceState | None: ...
    def start(self, h) -> None: ...
    def stop(self, h) -> None: ...
    def delete(self, h, *, keep_disk=True) -> None: ...
    def resize(self, h, size_id) -> None: ...
    def console_logs(self, h, *, stream=1) -> str: ...
```

`InstanceSpec` separates `env: dict[str,str]` (non-secret only) from `files: dict[str, FileSpec]`
(**secrets go here**) — see P6. Backends register via an entry-point group so third parties can add
a placement without touching core.

**Capabilities replace placement sniffing**, which also dissolves the serial-port coupling:
`console_logs` is serial-port-1/2 on GCP, `docker logs` on Docker, `pods/log` on K8s — exactly what
`nemoclaw_strategy.py:280`, `provisionerService.py:360`, `adminController.py:310`, and
`fleetController.py:652,666` need, with no special-casing.

**`compute/gcp.py` is backlog, not part of this phase.** The `NetworkInterface.network` misassignment
(`gcpService.py:317`), the unconditional static IP (`:289-311`), and the always-on public IP are real
bugs worth fixing, but only once GCP-VM is actually wired onto `ComputeBackend` — see Backlog —
bring your own GCP. This phase ships `compute/docker.py` only.

**`compute/docker.py`:** `create` → `containers.create(image, environment=, ports=, labels=,
detach=True)` then `put_archive` for `spec.files`; stop/start/remove map 1:1; `resize` →
`container.update(mem_limit=, cpu_quota=)`; `catalog()` returns synthetic shapes with
`estimated_usd_per_hour=None`; `snapshot` absent from `capabilities()`.

**Docker socket — per your decision, mount it, document it.** `/var/run/docker.sock` into the worker
is root-equivalent on the host, and the worker executes agent-influenced strings. Ship it as the
default with a startup WARNING log and a `# DEV / SINGLE-TENANT ONLY` banner in the compose file;
document rootless Docker/Podman as the recommended single-host production posture, and leave
`compute.docker.socket_url` configurable so a socket-proxy sidecar is a drop-in for anyone who wants
one.

**Agent containers get hardened defaults regardless, non-optional:** never the socket;
`--pids-limit 512`; memory/CPU from `size_id`; `--security-opt no-new-privileges`; `cap_drop: ALL`
plus only what the desktop image's Chrome needs; read-only rootfs with tmpfs `/tmp`.

**New risk that must be closed in this phase.** Today agent VMs are *accidentally* isolated from the
control plane's datastores by living on a different network. Put agents on the compose bridge and
they can reach Mongo and Redis directly — a complete authorization bypass around the `X-Agent-Token`
model. **Agent containers must go on a dedicated network with no route to `api`/`worker`/`mongo`/
`redis`, reaching the control plane only through the published API port.** This is the single biggest
new security risk introduced by Docker placement, and it is independent of the socket question.

**Verify — the phase that pays for the project.** `tests/integration/test_docker_backend.py`:
compose up real Mongo + Redis + API, create a real agent container from a real `agent-runtime` image,
assert a task walks `todo → in_progress → done` through the actual heartbeat. ~60 seconds, no cloud
account, in CI on every PR. This is the only way this project gets a regression suite at all.

---

### P5b — `ComputeBackend`: Kubernetes backend (1.5 wk) — depends on P5

The third placement from the original ask ("local Docker, any Kubernetes, or the user's own GCP").
Deliberately sequenced *after* Docker, not alongside it: the `ComputeBackend` protocol gets proven
against one real adapter first, so this phase is "implement the second adapter" rather than
"co-design the contract and an adapter simultaneously" — cheaper, and it matches the strangler
approach already used for P6.

`compute/k8s.py`, one Pod per agent instance via the `kubernetes` Python client (`CoreV1Api`):
- `create` → `create_namespaced_pod`; `spec.files` (secrets, instructional content) mount as a
  `Secret`/`ConfigMap` volume — the same file/env split defined for `InstanceSpec` in P5, reused
  verbatim rather than redesigned
- `get`/`start` → pod status read
- `stop` → **delete + recreate**, not a real stop/start — Pods have no such primitive. Document this
  explicitly as `RESTART` semantics; do not paper over the difference from Docker/GCP
- `delete` → `delete_namespaced_pod`
- `console_logs` → `pods/log`
- `resize` → unsupported, absent from `capabilities()` (no live resize of a running Pod)
- `catalog()` → presets mapped to `resources.requests`/`limits`

Reuses `transport/k8s_exec.py` and `AgentEndpoint.forward`'s real port-forward implementation, both
already built in P4 — this phase is the compute lifecycle only, no new transport work.

RBAC, `NetworkPolicy`, and the `PodSecurityContext` template ship with the Helm chart in P8, not as
hand-rolled `kubectl apply` steps here — a self-hosted user gets manifests, not instructions.

**Verify:** the same `tests/integration/test_transport_conformance.py` parametrized suite from P4,
now also run against a `kind`/`k3d` cluster in CI; re-run the P5 Docker integration test's
`todo → in_progress → done` assertion against a Kubernetes Pod instead of a container.

---

### P6 — `agent-runtime` package + images (4 wk) — **parallel from P1**

The largest phase. Of 4,528 lines in `provisioning/`, ~800 are four near-identical copies of one
~200-line Python heartbeat, and ~160 lines × 6 copies of one bash CLI.

**Key structural finding:** diffing the four embedded heartbeats, the *only* per-agent variation is
the `cmd = [...]` argv construction (e.g. `openclaw_strategy.py:888-899`). Task fetch, the
Google-token proxy call, stdout/stderr capture, the error classification, the watchdog POST, and the
reset-to-`todo` fallback are identical. So:

```python
class Runner(Protocol):
    name: str
    def build_argv(self, prompt: str, ctx: RunContext) -> Sequence[str]: ...
    def health(self) -> bool: ...
    def restart(self) -> None: ...
```

~800 duplicated lines collapse to ~250 shared + ~20 per runner, registered via entry points
(`agent_runtime.runners`) so third parties add an agent type without touching core. **This is the
project's primary extension point** now that the plugin API is gone.

```
packages/agent-runtime/
  agent_runtime/
    apiclient.py    # M2M client; the IPv4-pin getaddrinfo hack (currently duplicated 4x)
    heartbeat.py    # reset_stale -> get_next -> runner.execute -> watchdog
    cli.py          # replaces the bash CLI — stdlib ONLY (argparse + urllib)
    runners/        # claude_code, codex, opencode, openclaw, generic_exec
    tools/          # social post, google-token fetch — the agent-side CLI verbs
    recipes/        # base.yaml, desktop.yaml, <agent>.yaml
    bootstrap/render.py   # recipe -> bash startup-script  <-- SINGLE SOURCE OF TRUTH
images/agent-runtime/Dockerfile          # headless
images/agent-runtime-desktop/Dockerfile  # + Xvfb/x11vnc/websockify/chrome
```

The CLI is currently bash + `node -e` for JSON encoding, which hard-requires Node in every image.
Rewriting it in Python stdlib removes that dependency and makes it unit-testable. **Install it at the
same path and verb** (console script or symlink) — all ~1,118 lines of prompt text in
`agentProfileService.py` reference it that way, so **do not touch that file**. This is where "keep
the names" pays off directly. The `social post` and `google-token` verbs move into
`agent_runtime/tools/` unchanged in behaviour.

**Config injection — both mechanisms, by kind:**

| Kind | Mechanism |
|---|---|
| Non-secret, stable | env: `AGENT_API_URL`, `AGENT_TYPE`, `AGENT_RUNNER`, `AGENT_WORKSPACE` |
| **Secrets** (agent token, provider key) | mounted file `/run/agent/credentials.json`, mode 0600 |
| Instructional content (`AGENTS.md`, `SOUL.md`, MCP config, skills) | mounted dir `/opt/agent/config/` |

Secrets **must** be files. Today the agent token is baked as a literal into a world-readable
`/usr/local/bin/bihand`, *and* sits in GCE metadata (readable by anything on the VM that reaches the
metadata server), *and* is echoed to serial port 1 by every strategy's `tee -a /dev/ttyS1`. Env vars
are only marginally better (`/proc/<pid>/environ`, `docker inspect`). File-mounted 0600 is the only
option supporting rotation without re-provisioning, and it maps cleanly to Docker secrets, K8s
Secret volumes, and a GCE startup-script write.

Moving instructional content to a mounted dir **deletes the `agent_md_b64`/`mcp_config_b64`
parameters entirely** — which fixes the confirmed TypeError (`hermes_strategy.py:7` and
`nemoclaw_strategy.py:9` don't accept kwargs `provisionerService.py:207-211` always passes, so those
two cannot provision at all today) by *removing* the arguments rather than adding them to three
signatures.

**Drop nginx + self-signed TLS + htpasswd from the container.** That block is ~60 lines duplicated
across 6 strategies whose only purpose is "the GCP firewall only lets 443 through" — the
`websocketController.py:256-271` comment spells this out. In Docker, publish 6080 on `127.0.0.1` and
proxy from the control plane; in K8s an Ingress terminates TLS. Only `gcp-vm` still needs nginx, and
there it belongs in the **VM recipe**, not the agent image. A real ~300-line deletion that also
removes the `ssl.CERT_NONE` + basic-auth-bypass-via-Bearer hack.

**`script` mode from the same source of truth.** `recipes/*.yaml` declares apt packages, files,
systemd units, ordered steps. `bootstrap/render.py` compiles to bash. Two consumers, one source:
`bootstrap=image` renders a ~20-line stub (wait-for-internet, install docker, write credentials,
`docker run --restart=always`); `bootstrap=script` renders the full recipe. The recipe absorbs what
is byte-identical across all 6 current strategies: internet-wait loop, `systemctl mask tmp.mount`,
8 GB swapfile, hourly cleanup cron, nodesource Node 20, Chrome `.deb` + wrapper.

**Transition — strangler, not rewrite, core track stops at step 3.** (1) Land `agent-runtime`
standalone, fully unit-tested, **zero production wiring** — mergeable any time. (2) Add ONE new
`ContainerAgentStrategy`, initially `placement=docker` only; the 4 legacy GCP strategies untouched.
(3) Prove the loop on Docker (the P5 integration test), then extend `ContainerAgentStrategy` to
`placement=kubernetes` once P5b lands. Two backlog-only steps follow later, whenever the GCP item is
picked up: (4) wire `gcp-vm` onto the *same* `ContainerAgentStrategy` via a `bootstrap=image` stub
that just runs the already-built agent-runtime image — GCP doesn't get its own bash, it reuses
Docker's. (5) Delete the legacy per-agent-type strategy files, since nothing calls them anymore.

**Verify:** golden-file tests on rendered scripts + `shellcheck` on every rendered variant in CI.
Today, regression detection on startup scripts is impossible until a VM boots and you read serial
port 1.

---

### P7 — agent-runtime recipe polish (0.75 wk)

Slimmed way down from the original "strategy retirement" scope. Collapsing `base_strategy.py`'s 11
methods and deleting the 4 legacy per-agent-type strategy files only matters once GCP-VM is actually
wired onto the new seams — that's the backlog item's steps 4-5, not core-track work (see Provisioning
sequencing). What's left here is Docker/Kubernetes-relevant regardless of GCP's status:

Fold the Google Workspace `gogcli` installer (`tasks.py:746-913`, ~170 lines with three
per-agent-type branches) into the `agent-runtime` recipe/image layer from P6, where the install
becomes a declarative step instead of three SSH-driven bash blobs — this benefits the Docker and
Kubernetes agent images directly, with no GCP dependency.

**Verify:** provision each agent type in `(docker, image)` and `(kubernetes, image)` and assert an
identical task-completion trace. `(gcp-vm, image)`/`(gcp-vm, script)` conformance moves to the
backlog item's own verification once it exists.

---

### P8 — Deployment artifacts (1.5 wk) — **parallel from P1**

**`deploy/docker-compose.yml`** — the new canonical local stack, replacing
`docker-compose.test.yml` (deleted; it has no mongodb at all and a live key at line 26).
- `mongo:7 --replSet rs0` + one-shot `rs.initiate()`. Single-node RS, not standalone — explicit
  CSFLE works either way, but change streams are wanted for the WebSocket fan-out fix.
- **`keyvault-init` one-shot — the highest-priority missing artifact.** Nothing in the codebase
  creates the `encryption.__keyVault` collection, its unique partial index on `keyAltNames`, or the
  `data_key` DEK that `database.py:52` encrypts with. **First-run OSS install hard-fails on the
  first credential or user write.** Implement `scripts/bootstrap_keyvault.py`, call it idempotently
  from `init_db()` so Helm gets it free.
- `redis:7`, `api`, `worker`, `beat`. **That is the whole stack, full stop** — no LiteLLM service,
  no object store, no local model, and no gateway profile to opt into, because the shared-key
  provider doesn't exist in this codebase at all.
- An `agents` network isolated from the control-plane network (P5).
- `env_file: .env` only, **zero literal keys**. Commit schema-generated `.env.example`.
- `scripts/init-env.sh` generates `MONGO_KEY` (96 random bytes b64) and `JWT_SECRET_KEY` on first
  run, and **refuses to overwrite existing values** — regenerating `MONGO_KEY` orphans every
  encrypted credential. The Helm chart takes an explicitly-provided secret rather than generating
  one, so `helm upgrade` can never silently rotate it.

**The compose file is a deliverable in its own right**, because it is the entire quickstart. Target:
`git clone && ./scripts/init-env.sh && docker compose up` → browse to `localhost:8501`, log in with
the password printed to stdout, no other input. A CI job runs exactly that sequence on a clean
runner with no cloud credentials present and asserts `/api/health` returns 200 and login succeeds —
this is what keeps the zero-credential guarantee from silently regressing.

**`deploy/helm/bihand/`** — api/worker/beat Deployments, Service, Ingress, HPA, ConfigMap generated
from the settings schema, ServiceAccount with optional GCP Workload Identity annotation.
For `placement=kubernetes`: RBAC Role over `pods` create/delete/get/list, `pods/exec`, `pods/log`,
`pods/portforward`; a PodSecurityContext template for agent pods; a NetworkPolicy denying agent pods
egress to control-plane services.

**One design fix here:** replace the fire-and-forget `asyncio.create_task(startup_background_tasks())`
at `run.py:67` with a `helm.sh/hook: pre-install,pre-upgrade` Job running keyvault bootstrap +
migrations. The current design races across replicas — the Mongo `migrations_lock` (TTL 600s) covers
the DB half, but the per-instance `upgrade_vm` loop (`runner.py:86-140`) can run far longer than 600s
across many VMs and the lock expires mid-flight. Keep the in-process path as a compose fallback.

**`deploy/terraform/gcp/` is backlog, not part of this phase.** It doesn't exist today, and building
it only matters once `compute/gcp.py` exists to consume it — see Backlog — bring your own GCP for the
full deferred scope (VPC/subnetwork, firewall rules replacing `allow-all-user-ports`, SA roles,
optional Artifact Registry/GKE). This phase ships the compose stack and the Helm chart only.

---

### P9 — Docs, community, release (1.5 wk)

`docs/` (mkdocs): quickstart (Docker placement, **<10 min to a running agent, no cloud account**),
architecture, **the M2M protocol reference** (the agent-facing contract is the project's core
artifact — every endpoint, the `X-Agent-Token` model, the task state machine, the watchdog
semantics), config reference generated from the settings schema, placement tradeoff table,
agent-runtime authoring guide (adding a Runner — the main extension point), security model,
legacy-migration notes.

`README.md` rewrite with the Docker quickstart above the fold and an honest "not
production-hardened" statement. New empty public repo, single squashed initial commit, gitleaks +
license-header as required status checks, GHCR publish on tag, `v0.1.0`.

---

## Effort and parallelism

Engineer-weeks for someone already familiar with the code:

| Phase | Est. | Depends on | Track |
|---|---|---|---|
| P0 Legal/secrets/scope reduction | 2.0 | — | **gate** |
| P1 Config + auth providers + zero-cred boot | 1.5 | P0 | A |
| P1.5 Test harness + CI | 0.5 | P1 | C (continuous) |
| P2 Billing excision | 1.0 | P1 | A |
| P3 Endpoint model + migration | 0.5 | P1 | A |
| P4 AgentTransport (docker + k8s only) | 1.0 | P3 | A |
| P5 ComputeBackend + docker | 1.5 | P4, P2 | A |
| P5b ComputeBackend + kubernetes | 1.5 | P5 | A |
| P6 agent-runtime + images | **4.0** | P1 | B |
| P7 agent-runtime recipe polish | 0.75 | P5b, P6 | A |
| P8 Deployment artifacts (compose + Helm) | 1.5 | P1, P5 | B |
| P9 Docs + release | 1.5 | all | B |
| Test growth (inside P2-P8) | 2.0 | — | C |
| **Core-track total** | **~19.25** | | |
| Backlog — bring your own GCP (not on the critical path) | ~3.75 | core track | — |

**Serial critical path:** P0 → P1 → P3 → P4 → P5 → P5b → P7 → P9 ≈ **10.25 weeks**.
**Calendar:** 2 engineers ≈ **10-11 weeks**. Solo ≈ **4-4.5 months**.
Deferring GCP to backlog trades ~2.75 engineer-weeks and ~2 weeks of critical path for a cleaner
core architecture that isn't shaped around bash-script parity and static-IP quotas from day one.

Start **P6 in week 3** — it is the biggest single item, only depends on P1, and serializing it behind
the seams adds ~4 weeks of calendar for nothing.

Dropping the plugin API and the verticals removed ~3.5 engineer-weeks and, more importantly, one
whole parallel track — this is now a 2-engineer project rather than a 3-engineer one.

**Merge-conflict management (the thing that will actually hurt):**
- P2 and P4/P5 all edit `fleetController.py` (2,489 lines), `instanceController.py`, and `tasks.py`
  heavily. **Land P2 before P5** or you fight conflicts in the three largest backend files.
- P6 and P7 both touch `agent_runtime/recipes/` (the `gogcli` install step) — land P6's recipe
  scaffolding before P7 folds the installer in. Neither touches the legacy `provisioning/` strategy
  files at all in the core track; those stay frozen until the backlog GCP item retires them.
- P0's deletions touch `run.py`, `tasks.py`, `celery_app.py`, `App.tsx`, and `Layout.tsx`, all of
  which later phases also edit. P0 is a gate for exactly this reason: land it fully before anything
  branches.

**Top schedule risks:**
1. **`bootstrap=script` parity is no longer a critical-path risk** — moving GCP-VM to backlog already
   resolves what was flagged here in an earlier revision. The core track only ever ships
   `bootstrap=image` (Docker and Kubernetes have no script-vs-image distinction at all), and
   reproducing six hand-tuned bash scripts closely enough that VMs still boot — untestable without
   provisioning real VMs — is deferred entirely to whoever picks up the GCP backlog item, tracked
   there as open-ended and explicitly *not* part of that item's estimate.
2. `fleetController.py` — 2,489 lines, 51 credit references, six duplicated cost tables, and three
   phases need to edit it. Consider a dedicated decomposition pass between P2 and P5.
3. **A prompt change nobody has scoped:** `DEFAULT_AGENT_MD` (`instanceModel.py:9-38`) instructs
   agents to "deploy to the VM's public IP" and run `curl -s ifconfig.me`. Under Docker placement
   both are wrong, and the agent will confidently hand users unreachable URLs. Deployment-target
   guidance must become placement-aware. Budget 0.5 wk in P6; assert it in the P5 integration test.

---

## Release roadmap (v0.1 → v1.0)

The user's explicit requirement: **do not release all features at once.** Ship what already works
first, then add each new placement as it lands, so the project has real, independently-usable
releases along the way instead of one 22-week drop. Every release gets its own git tag, CHANGELOG
entry, and a README "what works / what doesn't yet" table — a v0.1 user should never have to guess
whether Kubernetes support is broken versus simply not built yet.

| Release | Ships | Placements working | Explicitly not yet | Phases |
|---|---|---|---|---|
| **v0.1.0 — "Clean boot"** | Zero-credential control-plane boot (`docker compose up`, local auth, no shared LLM gateway, no Google OAuth app, no Atlas), admin backdoor + leaked secrets removed, no billing, the `placement`/`endpoint` data model in place | `gcp-vm` only, via the **untouched legacy code path** — works if you bring your own GCP project, but isn't hardened, tested, or documented as first-class | Docker/Kubernetes agent placement; GCP as a maintained `ComputeBackend` (backlog) | P0, P1, P1.5, P2, P3 |
| **v0.2.0 — "Local-first agents"** | `AgentTransport`/`ComputeBackend` seams proven against a real adapter; Docker backend — agents run as local containers, **zero credentials of any kind**, not even a GCP account | `gcp-vm` (legacy), `docker` | Kubernetes placement | P4, P5 |
| **v0.3.0 — "agent-runtime"** | Consolidated `agent-runtime` package + images replace the four-copy bash heartbeat for Docker/Kubernetes agents; new agent types added via entry points | `gcp-vm` (legacy), `docker` | Kubernetes placement | P6 |
| **v0.4.0 — "Any Kubernetes"** | Kubernetes `ComputeBackend`, second adapter against the proven contract; `gogcli` install folded into the agent-runtime recipe layer | `gcp-vm` (legacy), `docker`, `kubernetes` | GCP as a maintained `ComputeBackend` — still legacy-only; backlog | P5b, P7 |
| **v0.5.0 — "Deployable"** | Helm chart (Docker/K8s), hardened compose defaults (agent network isolation, non-root images) — a third party can run this on their own infra, not just a laptop | same three (`gcp-vm` still legacy) | GCP terraform module (backlog) | P8 |
| **v1.0.0 — "GA"** | Full docs site incl. the M2M protocol reference and security model, a stable commitment on the M2M contract, GHCR image publishing on tag | same three | GCP as a first-class, maintained backend — backlog, not a GA blocker | P9 |

Notes on the ordering:

- **GCP-VM is never the headline of any release in this table.** It works from day one because
  nothing deletes the existing code, but "works" and "first-class, maintained placement" are
  deliberately different claims here — see Backlog — bring your own GCP for that track.
- **v0.1.0 ships even though its only concrete capability is pre-existing, unmaintained GCP code**,
  because what it actually proves is the zero-credential control-plane guarantee and the
  secrets/backdoor removal — the highest-risk claims in the whole pitch — in front of real users
  before any new-architecture placement work lands.
- **Docker before Kubernetes** (v0.2 before v0.4): Docker is the simpler adapter and is what makes
  the "no cloud account at all" demo real for the first time; Kubernetes reuses the same
  `ComputeBackend`/`AgentTransport` contracts once they're proven, per P5b's rationale.
- **agent-runtime (v0.3) sits between the two placement releases** on purpose — P6 only depends on
  P1, so it runs in parallel with P4/P5 on the engineering calendar, but its user-facing release
  (replacing the bash heartbeats, opening up the Runner extension point) is more useful to ship
  *after* Docker exists, since that's the placement most third-party Runner authors will develop
  against locally.
- No release before v0.4.0 claims Kubernetes support; no release before v0.5.0 ships Helm. A
  developer reading the README for any given tag should know exactly which placements are
  first-class today, and that GCP remains "bring your own, unmaintained" until the backlog lands.

---

## Backlog — bring your own GCP

Explicitly **not** part of the v0.1–v1.0 roadmap above, and not a numbered phase. GCP-VM
provisioning is real, already-working code — nothing here removes it, and it's usable via its
current, untouched form from day one (see Provisioning sequencing). What's deferred is the work to
make it a first-class `ComputeBackend` citizen alongside Docker and Kubernetes, reusing the exact
contract those two already proved rather than redesigning anything:

| Item | What | Rough effort |
|---|---|---|
| `compute/gcp.py` `ComputeBackend` | Near-verbatim port of `gcpService.py`'s live functions, fixing the `NetworkInterface.network` misassignment (`:317`) and making static IP / public IP opt-in (`:289-311`) | 0.75 wk |
| `bootstrap=image` stub for `gcp-vm` | A short metadata startup-script that installs Docker and runs the *same* `agent-runtime` image already built in P6 — GCP-VM reuses the Docker-placement agent image, it does not get its own bash | 0.5 wk |
| `transport/ssh.py` | Ports `sshService.py` for the admin operations that still need to reach into the VM (file manager, chat, console logs, restart) — task execution itself is pull-based via the M2M API and doesn't need this | 0.75 wk |
| Delete the legacy per-agent-type strategy files | Once `gcp-vm` runs on `agent-runtime` like every other placement, `openclaw_strategy.py`/`claude_code_strategy.py`/`codex_strategy.py`/`open_code_strategy.py` have no remaining caller; `provisioning/` collapses from 4,528 lines to near zero | 0.5 wk |
| `deploy/terraform/gcp/` | `google_compute_network`/`subnetwork`, firewall rules replacing `allow-all-user-ports` with an operator-supplied CIDR, SA roles (`compute.instanceAdmin.v1`, `compute.networkAdmin`), optional Artifact Registry/GKE + Workload Identity | 0.75 wk |
| Cloud nightly test suite | `(gcp-vm, image)` provisioning against a real GCP project, `@pytest.mark.cloud`, excluded from PR CI | 0.5 wk |
| `bootstrap=script` (no-Docker-on-the-VM mode) | Reproducing the six hand-tuned bash scripts closely enough that VMs still boot without a container runtime — untestable short of provisioning real VMs | open-ended, not estimated; stays deprecated/best-effort even after the rest of this backlog lands |

**≈3.75 engineer-weeks**, not counted in the core-track total. Land it as its own release (e.g.
`v1.1.0` — "Bring your own GCP") whenever a contributor picks it up, rather than gating v1.0 GA on
it. Nothing about the core architecture blocks this from landing later — `ComputeBackend` and
`AgentTransport` are designed placement-agnostic from P4/P5 onward specifically so a third adapter is
additive, not a redesign.

---

## Verification summary

| Level | What | Where |
|---|---|---|
| Import | `python -c "import fastapp"`; `npm run build` with no dangling imports from deleted pages | P0, P1 |
| **Zero-credential** | On a clean runner with **no** cloud creds, no `GOOGLE_*`, no LLM key: `./scripts/init-env.sh && docker compose up` → `/api/health` 200, login with the stdout password, create a fleet. **Every PR.** | P1, P8 |
| Unit | MCP normalizer round-trip; 8-state task transition matrix; the two `base_strategy` bugs as characterization tests; rendered-script golden files + shellcheck | P1.5, P6 |
| Authz | Every `/api/internal` route with a bad `X-Agent-Token`; every admin route as non-admin | P1.5 |
| Conformance | One parametrized `AgentTransport` suite across `docker`/`kubernetes` (core track); the `ssh`/`linuxserver/openssh-server` case is added by the backlog GCP item once `transport/ssh.py` exists | P4, Backlog |
| Integration | Real Mongo + Redis + API + agent container; assert `todo → in_progress → done` through the real heartbeat, ~60s, every PR | P5 |
| Cloud (nightly) | `(gcp-vm, image)` provisioning against a real GCP project; `@pytest.mark.cloud`, excluded from PR CI | Backlog |
| Manual | `docker compose up` → wizard → fleet → agent completes a task, on a machine with no gcloud credentials | P8, P9 |
| Release | `gitleaks detect` clean on the squashed history; `grep -riE 'graphicsminer\|modular-ethos\|AIza\|sk_live\|rk_live'` empty | P0, P9 |

---

## Critical files

- `fastapp/controllers/agentM2MController.py` (783 L) — **the project's core artifact**; the M2M
  contract that must be documented and test-covered before anything else is refactored
- `fastapp/services/provisioning/base_strategy.py` — the `(ip, private_key)` contract; two confirmed
  bugs (missing `logger` import at :138/:169; literal `"\\n"` parsing at :68-69) worth fixing under
  test in P1.5 regardless; the 11-method re-sign onto `AgentTransport` is **backlog**, not core track
- `fastapp/services/provisionerService.py` — orchestrator; the `agent_md_b64` TypeError at :207-211
  (fixed by P6 removing those params, not by touching this file), the refund path at :378-393 (P2),
  `externalIp` polling and GKE-MTU readiness probes at :43-73/:227-243 are **gcp-vm-only, backlog**
- `fastapp/tasks.py` — post-deletion ~1,210 L; `check_expired_instances_task` (:436-533, TTL-reaper
  conversion, P2), both tar workspace syncs (:1016-1049, :1106-1128, P4), the Workspace `gogcli`
  installer (:746-913, folded into the agent-runtime recipe in P7)
- `fastapp/services/gcpService.py` — the whole cloud surface; `MACHINE_CATALOG` (:59), the
  misassigned `NetworkInterface.name` (:317), firewall tags (:338), unconditional static IP
  (:289-311) — **all backlog**, only P0's secret-stripping pass touches this file in the core track
- `fastapp/services/provisioning/openclaw_strategy.py` (1,062 L) — reference for the extracted
  heartbeat (:776-968) and bash CLI (:581-739) that P6's `agent-runtime` package replaces for
  Docker/Kubernetes; the file itself stays untouched, GCP-only, until the backlog item deletes it
- `fastapp/utils/adminAuth.py:12-14` + `fastapp/controllers/adminController.py:28-31` — the
  hardcoded admin allowlist; **blocking item for the first public commit**
- `fastapp/controllers/llmController.py` + `fastapp/utils/bihandKey.py` — the shared-key LLM
  gateway; deleted outright in P0, not fixed or gated (see Zero-credential bootstrap)
- `fastapp/controllers/fleetController.py` (2,489 L) — worst file in the repo; three phases edit it
