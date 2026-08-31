# Deployment guide

Two ways to run Bihand: **local** (Docker Compose, zero cloud account, up in
minutes) and **Google Kubernetes Engine** (the same four images this
project's own test/prod deployments run, on your own GCP project). Both are
covered here end to end, including the two GCP project-setup steps that are
easy to miss because nothing in this repo creates them for you — they cost
someone real debugging time to track down, so they're documented in detail
in the Troubleshooting section at the bottom.

---

## Local (Docker Compose)

The full walkthrough lives in `README.md` → "Getting started (local)" —
this is the short version for reference:

```bash
cp .env.template .env                       # repo root
cp fastapp/.env.example fastapp/.env         # fill in MONGO_KEY + JWT_SECRET_KEY
docker compose -f docker-compose.test.yml up --build
cd frontend && npm install && npm run dev    # http://localhost:5173
```

MongoDB and Redis run as bundled containers — no cloud account needed to
boot the control plane, explore the dashboard, and manage fleets/tasks/goals.
The only thing that needs real Google Cloud is provisioning *actual* agent
VMs, which is optional and covered in its own section below since the
requirements are identical whether you're running the control plane locally
or on GKE.

---

## Google Kubernetes Engine

### 1. Build and push the images

`cloudbuild.yaml` builds all four images (`Dockerfile.api`, `.worker`,
`.beat`, `.litellm`) and pushes them to Artifact Registry. Override the
substitution variables for your own project and registry rather than editing
the file:

```bash
gcloud builds submit \
  --config=cloudbuild.yaml \
  --substitutions=_LOCATION=us-central1,_REPOSITORY=<your-artifact-registry-repo> \
  .
```

(Create the Artifact Registry repo first if it doesn't exist:
`gcloud artifacts repositories create <name> --repository-format=docker --location=us-central1`.)

### 2. Set up the GCP side — IAM and firewall

**Do this before applying the manifests below**, or provisioning will fail
or hang once you try it. Full explanation of *why* each of these is needed,
with the exact failure signatures, is in Troubleshooting — this section is
just the commands.

**a. Enable the APIs you're using:**
```bash
gcloud services enable compute.googleapis.com --project=<PROJECT_ID>
# Only if you'll offer the "bihand" LLM provider or the Gemini/Veo studios:
gcloud services enable aiplatform.googleapis.com --project=<PROJECT_ID>
```

**b. Create a service account for the worker (and api/beat) with Compute Engine access:**
```bash
gcloud iam service-accounts create bihand-provisioner \
  --project=<PROJECT_ID> --display-name="Bihand agent-VM provisioner"

gcloud projects add-iam-policy-binding <PROJECT_ID> \
  --member="serviceAccount:bihand-provisioner@<PROJECT_ID>.iam.gserviceaccount.com" \
  --role="roles/compute.instanceAdmin.v1"
```
Use `roles/compute.instanceAdmin.v1`, not the broader `roles/compute.admin`
— see Troubleshooting for why that distinction matters.

If you're using GKE Workload Identity (recommended — matches
`deploy/k8s/08-serviceaccount.yaml`):
```bash
gcloud iam service-accounts add-iam-policy-binding \
  bihand-provisioner@<PROJECT_ID>.iam.gserviceaccount.com \
  --role="roles/iam.workloadIdentityUser" \
  --member="serviceAccount:<PROJECT_ID>.svc.id.goog[bihand/bihand-ksa]"
```
Not using Workload Identity? Generate a JSON key instead
(`gcloud iam service-accounts keys create`), mount it into the api/worker/beat
pods, and set `GOOGLE_APPLICATION_CREDENTIALS` to its path — same as the
local-dev pattern in `README.md`.

**c. Open the ports agent VMs need to be reachable on:**
```bash
gcloud compute firewall-rules create agent-vm-allow-all-user-ports \
  --project=<PROJECT_ID> \
  --network=<YOUR_VPC_NAME> \
  --direction=INGRESS --action=ALLOW \
  --rules=tcp:0-65535,udp:0-65535 \
  --source-ranges=0.0.0.0/0 \
  --target-tags=allow-all-user-ports
```

### 3. Apply the Kubernetes manifests

Generic, adapt-and-apply manifests live in `deploy/k8s/` — build your own
Helm chart or Kustomize overlay from them if you prefer, but they're plain
enough to `kubectl apply -f` directly for a first deploy:

```bash
kubectl apply -f deploy/k8s/00-namespace.yaml
kubectl apply -f deploy/k8s/08-serviceaccount.yaml   # edit the GCP SA email first; skip if not using Workload Identity

cp deploy/k8s/secret.env.example deploy/k8s/secret.env   # fill in real values, never commit this file
kubectl create secret generic bihand-secrets -n bihand --from-env-file=deploy/k8s/secret.env

kubectl apply -f deploy/k8s/01-configmap.yaml   # edit the placeholders first
kubectl apply -f deploy/k8s/02-redis.yaml
kubectl apply -f deploy/k8s/03-litellm.yaml     # optional — see the file's own comment
kubectl apply -f deploy/k8s/04-api.yaml         # edit the image: placeholder first
kubectl apply -f deploy/k8s/05-worker.yaml      # edit the image: placeholder first
kubectl apply -f deploy/k8s/06-beat.yaml        # edit the image: placeholder first
kubectl apply -f deploy/k8s/07-ingress.yaml     # edit the host: placeholder first, add TLS for your setup
```

### 4. Verify

```bash
kubectl -n bihand get pods                          # all should reach Running
kubectl -n bihand logs deploy/bihand-api --tail=50   # look for "Starting Miner Claw Server with Uvicorn"
curl -s -o /dev/null -w "%{http_code}\n" https://<YOUR_DOMAIN>/api/health   # expect 200
```

Then sign up through the UI (email/password — no Google account needed, see
`README.md`), add a GCP-backed credential, and try provisioning one agent
before trusting the deployment. If it wedges, jump to Troubleshooting below
— both known failure modes are common enough on a first deploy that they're
worth ruling out before assuming something else is wrong.

---

## Troubleshooting

Both of these were hit (and fixed) deploying this exact repo to a fresh GCP
project — they aren't hypothetical.

### Provisioning fails immediately with a 403

```
403 POST .../compute/v1/projects/<project>/zones/<zone>/instances:
Required 'compute.instances.create' permission for '...'
```

**Cause:** the service account behind `GOOGLE_APPLICATION_CREDENTIALS` (or
Workload Identity) doesn't have Compute Engine permissions. This is the
single most common gap on a first deploy — most starter GCP service accounts
are scoped for something narrower (a storage bucket, a specific API) and
nobody thinks to add VM-provisioning rights until it's needed.

**Fix:** grant `roles/compute.instanceAdmin.v1` — step 2b above. Deliberately
*not* `roles/compute.admin`: that role also grants control over every
VM/network/firewall/VPN in the project, including your GKE cluster's own
nodes if the control plane runs there. `compute.instanceAdmin.v1` covers
everything `gcpService.py` actually calls (instances, disks, snapshots,
addresses) without that. Agent VMs get no attached service-account identity
of their own and boot from Google's public `ubuntu-os-cloud` image, so no
further cross-project grant is needed either.

This fails for **every** provider and agent type — it fails before any
agent software or LLM call happens, so seeing it while testing one specific
provider/agent combination doesn't mean that combination is the problem.

A related, non-fatal version of the same gap: `Failed to allocate static IP
... falling back to ephemeral` in the logs means the account can create
instances but not reserve a static IP (`compute.addresses.create`). Safe to
ignore — the VM still gets a public IP, just an ephemeral one — unless you
specifically need a stable address per agent.

### Instance stuck in `installing` forever

**Cause:** no firewall rule matches the tags `gcpService.py` puts on every
agent VM (`http-server`, `https-server`, `nemoclaw-dashboard`,
`allow-all-user-ports`). A fresh GCP project's default network denies all
unmatched inbound traffic. The VM's startup script is delivered via GCP
metadata and needs no inbound networking, so it completes normally — but
nothing outside the VM, including the control plane's own readiness check,
can ever reach it afterward.

**How to confirm this is what's happening, not something else:**
```bash
# 1. Is the provisioning task actually still running, or did it die?
kubectl -n bihand exec deploy/bihand-worker -- celery -A fastapp.celery_app inspect active

# 2. Did the VM's own startup script actually finish?
gcloud compute instances get-serial-port-output <vm-name> --zone=<zone> --project=<PROJECT_ID> \
  | grep "Startup script complete"

# 3. Can *anything* reach it from outside? (This is exactly what the
#    control plane's own readiness poll is doing — plain HTTP, not HTTPS,
#    to dodge a GKE-network SSL-handshake stall.)
curl -m 8 http://<vm-external-ip>/
```
If the task is still active, the serial console shows the startup script
finished, and the `curl` times out — that's this bug, not a broken image or
a bad agent runtime.

**Fix:** create the firewall rule — step 2c above. It's deliberately wide
(every TCP+UDP port, from anywhere) rather than a narrow allowlist: each
agent is a coding-agent sandbox that can start a dev server or live preview
on an unpredictable port (there's a named dashboard on `18789`, plus a
generic "gateway" the code treats as dynamic), so there's no fixed port list
to restrict this to without risking breaking that feature later. SSH access
is separately gated by its own per-instance generated keypair regardless of
this rule, and `target_tags` scopes the rule to exactly the VMs this feature
creates — nothing else on your network is affected.

**Instances already wedged from before the rule existed won't self-recover**
— the specific poll loop that's stuck for each of them isn't watching for a
firewall change mid-flight. Delete and re-provision them once the rule is
live.

### Quick reference

| Symptom | Cause | Fix |
|---|---|---|
| Provisioning fails immediately, `403 ... compute.instances.create` | Provisioning SA lacks Compute Engine IAM | Grant `roles/compute.instanceAdmin.v1` |
| `Failed to allocate static IP ... falling back to ephemeral` | Same SA also lacks `compute.addresses.create` | Harmless — safe to ignore unless you need a stable IP |
| Instance stuck in `installing`, serial console shows the startup script *did* finish | No firewall rule for the `allow-all-user-ports` tag | Create the firewall rule; re-provision any already-wedged instances |
| Instance stuck in `installing`, and the provisioning task is no longer in `celery inspect active` | The Celery task died (worker crash/OOM/restart), not hung | Check worker pod logs/restarts; re-provision |
