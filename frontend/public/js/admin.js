/**
 * Miner Claw Admin Logic
 */

const API_BASE = '/api';

window.adminApp = {
    state: {
        token: localStorage.getItem('mc_token') || null,
        user: null,
        role: null,
        wizard: {
            step: 1,
            userId: null,
            provider: null,
            model: null,
            diskSize: 64,
            apiKey: '',
            isKeyVerified: false,
            alias: '',
            password: ''
        },
        pollingInterval: null
    },

    init() {
        if (!this.state.token) {
            alert("Admin session required. Please login on the main page first.");
            window.location.href = '/';
            return;
        }

        try {
            const payload = JSON.parse(atob(this.state.token.split('.')[1]));
            this.state.user = payload.email;
            this.state.role = payload.role;

            if (this.state.role !== 'admin') {
                alert("Unauthorized. Admin role required.");
                window.location.href = '/';
                return;
            }
            
            // Setup Routing
            window.addEventListener('popstate', () => this.handleRouting());
            
            // Setup default headers for axios
            axios.defaults.headers.common['Authorization'] = `Bearer ${this.state.token}`;
            
            this.setupEventListeners();
            this.handleRouting();
        } catch (e) {
            console.error(e);
            window.location.href = '/';
        }
    },

    handleRouting() {
        const path = window.location.pathname;
        if (path.includes('/provisioning')) {
            this.showAdminSetup(false);
        } else if (path.includes('/users')) {
            this.showUserManagement(false);
        } else {
            this.showAdminDashboard(false);
        }
    },

    setupEventListeners() {
        // Sidebar Navigation
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.currentTarget.dataset.target;
                if (!target) return; // Ignore buttons without data-target (like Server Logs)
                
                const pathMap = {
                    'admin-setup': '/admin/provisioning',
                    'admin-users': '/admin/users',
                    'admin-dashboard': '/admin/orchestration'
                };
                // Find matching key
                let matchedPath = '/admin/orchestration';
                if (target) {
                    if (target.includes('setup')) matchedPath = '/admin/provisioning';
                    else if (target.includes('users')) matchedPath = '/admin/users';
                }
                
                this.navigateTo(matchedPath);
            });
        });
        // Wizard Provider selection
        document.querySelectorAll('.provider-card').forEach(card => {
            card.addEventListener('click', (e) => {
                document.querySelectorAll('.provider-card').forEach(c => c.classList.remove('selected'));
                const card = e.currentTarget;
                card.classList.add('selected');
                
                const provider = card.dataset.provider;
                this.state.wizard.provider = provider;
                this.state.wizard.isKeyVerified = false;
                
                // Show config area and reset status
                document.getElementById('model-config-area').style.display = 'block';
                const status = document.getElementById('key-verify-status');
                status.className = 'verify-status';
                status.innerText = '';
                
                this.updateModelOptions(provider);
                this.checkWizardStep2();
            });
        });

        const apiKeyInput = document.getElementById('provider-api-key');
        if (apiKeyInput) apiKeyInput.addEventListener('input', () => this.checkWizardStep2());
        
        const diskSizeInput = document.getElementById('disk-size');
        if (diskSizeInput) diskSizeInput.addEventListener('input', (e) => this.state.wizard.diskSize = parseInt(e.target.value));

        const modelSelect = document.getElementById('llm-model-select');
        if (modelSelect) modelSelect.addEventListener('change', (e) => {
            this.state.wizard.model = e.target.value;
            this.checkWizardStep2();
        });

        const aliasInput = document.getElementById('instance-alias');
        if (aliasInput) aliasInput.addEventListener('input', (e) => {
            this.state.wizard.alias = e.target.value;
            this.checkWizardStep2();
        });

        const passInput = document.getElementById('instance-password');
        if (passInput) passInput.addEventListener('input', (e) => {
            this.state.wizard.password = e.target.value;
            this.checkWizardStep2();
        });
    },

    navigateTo(path, replace = false) {
        if (replace) {
            history.replaceState(null, '', path);
        } else if (window.location.pathname !== path) {
            history.pushState(null, '', path);
        }
        this.handleRouting();
    },

    showSection(sectionId) {
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.target === sectionId) btn.classList.add('active');
        });
        
        document.querySelectorAll('.content-section').forEach(sec => sec.classList.remove('active-section'));
        const targetSection = document.getElementById(sectionId);
        if (targetSection) targetSection.classList.add('active-section');
    },

    showAdminSetup(updateHistory = true) {
        if (updateHistory) this.navigateTo('/admin/provisioning');
        this.showSection('admin-setup');
        this.initAdminSetup();
    },

    showAdminDashboard(updateHistory = true) {
        if (updateHistory) this.navigateTo('/admin/orchestration');
        this.showSection('admin-dashboard');
        this.loadAdminDashboard();
    },

    showUserManagement(updateHistory = true) {
        if (updateHistory) this.navigateTo('/admin/users');
        this.showSection('admin-users');
        this.loadAdminUsers();
    },

    // --- Admin Fleet Dashboard ---

    async showServerLogs() {
        const modal = document.getElementById('logs-modal');
        const content = document.getElementById('startup-logs-content');
        if (!modal || !content) return;
        
        content.innerText = 'Loading backend server logs...';
        modal.classList.add('active');
        const titleEl = document.querySelector('#logs-modal .modal-header h3');
        if (titleEl) titleEl.innerHTML = '<i class="ri-server-line"></i> Backend Server Logs';
        
        try {
            const res = await axios.get(`${API_BASE}/admin/server-logs`);
            content.innerText = res.data.logs || 'No output captured yet.';
            content.scrollTop = content.scrollHeight;
        } catch (e) {
            content.innerText = `Failed to retrieve server logs: ${e.message}`;
        }
    },

    async loadAdminDashboard() {
        try {
            const loading = document.getElementById('instances-loading');
            if (loading) loading.style.display = 'flex';
            
            const res = await axios.get(`${API_BASE}/admin/instances`);
            
            const tbody = document.querySelector('#instances-table tbody');
            if (!tbody) return;
            tbody.innerHTML = '';
            
            if (res.data.instances.length === 0) {
                tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No instances provisioned.</td></tr>`;
            } else {
                res.data.instances.forEach(inst => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td>
                            <div class="status-indicator">
                                <div class="status-dot status-${inst.status}"></div>
                                ${inst.status}
                            </div>
                        </td>
                        <td>
                            <div style="font-weight:600;">${inst.alias || 'Untitled'}</div>
                            <small class="text-muted">${inst.vmName}</small>
                        </td>
                        <td>${inst.userId}</td>
                        <td>${inst.provider} / ${inst.model}</td>
                        <td>${inst.externalIp ? `<a href="https://${inst.externalIp}/#token=${inst.dashboardToken}" target="_blank" style="color: var(--primary); text-decoration: none;">${inst.externalIp} <i class="ri-external-link-line"></i></a>` : '-'}</td>
                        <td>
                            ${this.renderAdminActions(inst)}
                        </td>
                    `;
                    tbody.appendChild(tr);
                });
            }
        } catch (err) {
            console.error(err);
        } finally {
            const loading = document.getElementById('instances-loading');
            if (loading) loading.style.display = 'none';
        }
    },

    renderAdminActions(inst) {
        if (inst.status === 'provisioning') {
            return `<span style="opacity: 0.5;">Processing...</span>`;
        }
        if (inst.status === 'deleting') {
            return `<span style="opacity: 0.5; color: var(--danger);">Deleting...</span>`;
        }

        let options = '';
        
        if (inst.status === 'running') {
            options += `<button class="dropdown-item" onclick="window.adminApp.adminAction('${inst._id}', 'stop')"><i class="ri-stop-circle-line"></i> Stop Instance</button>`;
        } else if (inst.status === 'stopped') {
            options += `<button class="dropdown-item" onclick="window.adminApp.adminAction('${inst._id}', 'start')"><i class="ri-play-circle-line"></i> Start Instance</button>`;
        }
        
        if (inst.status === 'installing' || inst.status === 'error' || inst.status === 'running' || inst.status === 'stopped') {
            options += `<button class="dropdown-item" onclick="window.adminApp.showLogsAction('${inst._id}')"><i class="ri-file-list-3-line"></i> View Logs</button>`;
        }
        
        options += `
            <div class="dropdown-divider"></div>
            <button class="dropdown-item" style="color: var(--danger);" onclick="window.adminApp.adminAction('${inst._id}', 'delete')"><i class="ri-delete-bin-line"></i> Delete Everything</button>
        `;

        return `
            <div class="user-profile-dropdown" style="position: relative; display: inline-block;">
                <button class="btn btn-sm btn-outline profile-trigger" onclick="
                    event.stopPropagation();
                    const menu = this.nextElementSibling;
                    document.querySelectorAll('.dropdown-menu').forEach(m => { if(m !== menu) m.classList.remove('active'); });
                    menu.classList.toggle('active');
                " style="min-width: 110px; justify-content: space-between; padding: 0.4rem 0.75rem;">
                    Manage <i class="ri-arrow-down-s-line"></i>
                </button>
                <div class="dropdown-menu" style="right: 0; min-width: 180px; box-shadow: 0 10px 30px rgba(0,0,0,0.8); background: var(--dark-bg); border: 1px solid var(--panel-border); border-radius: 8px;">
                    ${options}
                </div>
            </div>
        `;
    },

    async showLogsAction(id) {
        const modal = document.getElementById('logs-modal');
        const content = document.getElementById('startup-logs-content');
        if (!modal || !content) return;
        
        content.innerText = 'Loading raw serial logs from GCP...';
        modal.classList.add('active');
        const titleEl = document.querySelector('#logs-modal .modal-header h3');
        if (titleEl) titleEl.innerHTML = '<i class="ri-terminal-box-line"></i> VM Startup Logs';
        
        try {
            const res = await axios.get(`${API_BASE}/admin/instances/${id}/logs/startup`);
            content.innerText = res.data.logs || 'No output captured yet. If VM is just booting, check back in 1 minute.';
        } catch (e) {
            content.innerText = `Failed to retrieve logs: ${e.message}`;
        }
    },

    async adminAction(id, action) {
        try {
            if (action === 'delete') {
                if (!confirm("WARNING: This will completely destroy the VM AND the Persistent Disk. This is irreversible. Continue?")) {
                    this.loadAdminDashboard(); // Refresh to reset dropdown
                    return;
                }
                await axios.delete(`${API_BASE}/admin/instances/${id}`);
            } else {
                await axios.post(`${API_BASE}/admin/instances/${id}/${action}`);
            }
            this.loadAdminDashboard();
        } catch (err) {
            alert(`Action failed: ${err.response?.data?.detail || err.message}`);
        }
    },

    async loadAdminUsers() {
        try {
            const loading = document.getElementById('users-loading');
            if (loading) loading.style.display = 'flex';
            
            const query = document.getElementById('admin-user-search')?.value || '';
            const res = await axios.get(`${API_BASE}/admin/users?q=${query}`);
            
            const tbody = document.querySelector('#users-table tbody');
            if (!tbody) return;
            tbody.innerHTML = '';
            
            if (res.data.users.length === 0) {
                tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">No users found.</td></tr>`;
            } else {
                res.data.users.forEach(u => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td>${u.name || '-'}</td>
                        <td>${u.email}</td>
                        <td><span class="badge" style="background: rgba(16,185,129,0.2); color: #10b981;">${u.credits || 0} Credits</span></td>
                        <td>${new Date(u.createdDate).toLocaleDateString()}</td>
                        <td>
                            <button class="btn btn-sm btn-outline" style="border-color: var(--primary); color: var(--primary);" onclick="window.adminApp.addCreditsAction('${u.email}')"><i class="ri-add-line"></i> Add Credits</button>
                        </td>
                    `;
                    tbody.appendChild(tr);
                });
            }
        } catch (err) {
            console.error(err);
        } finally {
            const loading = document.getElementById('users-loading');
            if (loading) loading.style.display = 'none';
        }
    },

    async addCreditsAction(email) {
        const amountStr = prompt(`How many credits do you want to add to ${email}?`, "15");
        if (!amountStr) return;
        
        const amount = parseInt(amountStr);
        if (isNaN(amount) || amount <= 0) {
            alert("Invalid amount.");
            return;
        }
        
        if (confirm(`Add ${amount} credits to ${email}?`)) {
            try {
                await axios.post(`${API_BASE}/admin/users/${email}/credits`, { amount: amount });
                alert('Credits added successfully!');
                this.loadAdminUsers();
            } catch (err) {
                alert(`Failed to add credits: ${err.response?.data?.detail || err.message}`);
            }
        }
    },

    // --- Provisioning Wizard ---

    async initAdminSetup() {
        this.wizardGoto(1);
        const searchInput = document.getElementById('user-search-input');
        if (searchInput) searchInput.value = '';
        const results = document.getElementById('user-search-results');
        if (results) results.innerHTML = '';
    },

    wizardGoto(stepNum) {
        this.state.wizard.step = stepNum;
        
        document.querySelectorAll('.wizard-steps .step').forEach(el => {
            el.classList.remove('active');
            if (parseInt(el.dataset.step) <= stepNum) el.classList.add('active');
        });
        
        document.querySelectorAll('.wizard-pane').forEach(el => el.classList.remove('active'));
        const pane = document.getElementById(`wizard-step-${stepNum}`);
        if (pane) pane.classList.add('active');
        
        if (stepNum === 3) {
            document.getElementById('summary-user').innerText = this.state.wizard.userId;
            document.getElementById('summary-alias').innerText = this.state.wizard.alias;
            document.getElementById('summary-provider').innerText = this.state.wizard.provider;
            document.getElementById('summary-model').innerText = this.state.wizard.model;
            
            document.getElementById('pre-deploy-view').style.display = 'block';
            document.getElementById('provision-monitoring-view').style.display = 'none';
        }
    },

    wizardNext(stepNum) {
        if (stepNum === 2 && !this.state.wizard.userId) return;
        if (stepNum === 3 && (!this.state.wizard.provider || !this.state.wizard.apiKey)) return;
        this.wizardGoto(stepNum);
    },

    wizardPrev(stepNum) {
        this.wizardGoto(stepNum);
    },

    async searchUsers() {
        const q = document.getElementById('user-search-input').value;
        try {
            const res = await axios.get(`${API_BASE}/admin/users?q=${encodeURIComponent(q)}`);
            const container = document.getElementById('user-search-results');
            if (!container) return;
            container.innerHTML = '';
            
            res.data.users.forEach(user => {
                const div = document.createElement('div');
                div.className = 'user-row';
                
                // Show count of active instances if any
                const instanceBadge = user.hasInstance 
                    ? `<span class="badge">${user.instances.length} Active Workspaces</span>` 
                    : '';

                div.innerHTML = `
                    <div style="display:flex; align-items:center; gap:10px;">
                        <img src="${user.picture || 'https://ui-avatars.com/api/?name='+user.name}" class="avatar" style="width:32px;height:32px;">
                        <div>
                            <div style="font-weight:600;">${user.name} ${instanceBadge}</div>
                            <div class="text-muted" style="font-size:0.8rem;">${user.email}</div>
                        </div>
                    </div>
                `;
                
                div.addEventListener('click', () => {
                    document.querySelectorAll('.user-row').forEach(r => r.classList.remove('selected'));
                    div.classList.add('selected');
                    this.state.wizard.userId = user.email;
                    document.getElementById('btn-next-step2').disabled = false;
                });
                
                container.appendChild(div);
            });
        } catch (e) {
            console.error(e);
        }
    },

    checkWizardStep2() {
        const apiKey = document.getElementById('provider-api-key').value;
        this.state.wizard.apiKey = apiKey;
        
        const valid = this.state.wizard.provider && 
                      this.state.wizard.model && 
                      this.state.wizard.isKeyVerified &&
                      this.state.wizard.alias &&
                      this.state.wizard.password;
                      
        const btn = document.getElementById('btn-next-step3');
        if (btn) btn.disabled = !valid;
    },

    updateModelOptions(provider) {
        const models = {
            'google': [
                'gemini-3.1-pro-preview', 
                'gemini-3.1-flash-lite-preview', 
                'gemini-3-flash-preview', 
                'gemini-2.5-pro', 
                'gemini-2.5-flash', 
                'gemini-2.5-flash-lite'
            ],
            'openai': [
                'gpt-5.4', 
                'gpt-5.4-mini', 
                'gpt-5.4-nano', 
                'gpt-5.4-pro-2026-03-05'
            ],
            'anthropic': [
                'claude-sonnet-4-6', 
                'claude-haiku-4-5', 
                'claude-opus-4-6'
            ]
        };
        
        const select = document.getElementById('llm-model-select');
        if (!select) return;
        
        select.innerHTML = '<option value="">- Select a model -</option>';
        (models[provider] || []).forEach(m => {
            select.innerHTML += `<option value="${m}">${m}</option>`;
        });
        this.state.wizard.model = null;
    },

    async onboardingVerifyKey() {
        const provider = this.state.wizard.provider;
        const apiKey = document.getElementById('provider-api-key').value;
        const status = document.getElementById('key-verify-status');
        const verifyBtn = document.getElementById('btn-verify-key');
        
        if (!provider || !apiKey) {
            alert("Please select a provider and enter an API key.");
            return;
        }

        try {
            verifyBtn.disabled = true;
            status.className = 'verify-status verifying';
            status.innerText = 'Verifying key...';
            
            const res = await axios.post(`${API_BASE}/admin/validate-key`, {
                provider: provider,
                apiKey: apiKey
            });
            
            if (res.data.valid) {
                status.className = 'verify-status valid';
                status.innerText = 'Key Verified!';
                this.state.wizard.isKeyVerified = true;
                this.state.wizard.apiKey = apiKey;
            } else {
                status.className = 'verify-status invalid';
                status.innerText = `Invalid: ${res.data.error}`;
                this.state.wizard.isKeyVerified = false;
            }
        } catch (e) {
            status.className = 'verify-status invalid';
            status.innerText = `Error: ${e.response?.data?.detail || e.message}`;
            this.state.wizard.isKeyVerified = false;
        } finally {
            verifyBtn.disabled = false;
            this.checkWizardStep2();
        }
    },

    async startProvisioning() {
        document.getElementById('pre-deploy-view').style.display = 'none';
        document.getElementById('provision-monitoring-view').style.display = 'block';
        
        try {
            const res = await axios.post(`${API_BASE}/admin/instances`, {
                userEmail: this.state.wizard.userId,
                provider: this.state.wizard.provider,
                model: this.state.wizard.model,
                apiKey: this.state.wizard.apiKey,
                alias: this.state.wizard.alias,
                password: this.state.wizard.password
            });
            
            this.startPollingStatus(res.data.instanceId);
            
        } catch (e) {
            alert(`Provisioning failed to start: ${e.response?.data?.detail || e.message}`);
            document.getElementById('pre-deploy-view').style.display = 'block';
            document.getElementById('provision-monitoring-view').style.display = 'none';
        }
    },

    startPollingStatus(instanceId) {
        this.navigateTo('/admin/provisioning');
        document.getElementById('pre-deploy-view').style.display = 'none';
        document.getElementById('provision-monitoring-view').style.display = 'block';
        
        const readyCta = document.getElementById('ready-cta');
        if (readyCta) readyCta.classList.add('hidden');
        
        // Reset UI
        document.getElementById('pip-title').innerText = "GCP Provisioning...";
        document.getElementById('pip-desc').innerText = "Creating VM, network, and disk resources. This typically takes 3 minutes.";
        document.getElementById('pip-status-badge').innerText = "Spinning up Infrastructure";

        if (this.state.pollingInterval) clearInterval(this.state.pollingInterval);

        let startTime = Date.now();
        this.state.pollingInterval = setInterval(async () => {
            // Update timer
            const sec = Math.floor((Date.now() - startTime) / 1000);
            const m = String(Math.floor(sec / 60)).padStart(2, '0');
            const s = String(sec % 60).padStart(2, '0');
            const timerEl = document.getElementById('pip-timer');
            if (timerEl) timerEl.innerText = `${m}:${s}`;

            try {
                const res = await axios.get(`${API_BASE}/admin/instances/${instanceId}`);
                const inst = res.data.instance;
                
                if (inst.status === 'installing') {
                    document.getElementById('pip-title').innerText = "Autonomous Onboarding...";
                    document.getElementById('pip-desc').innerText = "Installing NemoClaw Reference Stack and configuring Nginx proxy.";
                    document.getElementById('pip-status-badge').innerText = "System Deployment";
                } else if (inst.status === 'running') {
                    clearInterval(this.state.pollingInterval);
                    this.state.pollingInterval = null;
                    this.onProvisioningComplete(inst);
                } else if (inst.status === 'error') {
                    clearInterval(this.state.pollingInterval);
                    document.getElementById('pip-title').innerText = "Provisioning Failed";
                    document.getElementById('pip-desc').innerText = inst.errorMessage || "Unknown error occurred.";
                }
            } catch (e) {
                console.error("Polling error", e);
            }
        }, 5000);
    },

    onProvisioningComplete(inst) {
        document.getElementById('pip-title').innerText = "Deployment Successful!";
        const badge = document.getElementById('pip-status-badge');
        if (badge) badge.innerText = "Ready";
        
        const iconArea = document.getElementById('pip-icon-area');
        if (iconArea) iconArea.innerHTML = '<i class="ri-check-line" style="color:var(--success)"></i>';
        
        const readyCta = document.getElementById('ready-cta');
        if (readyCta) {
            readyCta.classList.remove('hidden');
            document.getElementById('pip-ready-ip').innerText = inst.externalIp;
            document.getElementById('pip-access-link').href = `http://${inst.externalIp}/#token=${inst.dashboardToken}`;
        }
        
        this.loadAdminDashboard();
    }
};

document.addEventListener('DOMContentLoaded', () => {
    window.adminApp.init();
});
