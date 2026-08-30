/**
 * minerClaw Frontend Logic
 */

const API_BASE = '/api';

const app = {
    state: {
        token: localStorage.getItem('mc_token') || null,
        user: null,
        role: null,
        instanceFiles: {}, // { instanceId: { path: '/home/openclaw', files: [] } },
        expandedInstances: [], // List of instance IDs that have their Manage section open
        wizard: {
            step: 1,
            userId: null,
            provider: null,
            machineType: 'e2-small',
            apiKey: ''
        },
        activeWs: null
    },

    init() {
        
        // Initial setup for Fleet
        if (app.fleet && typeof app.fleet.selectPlan === 'function') {
            setTimeout(() => {
                app.fleet.selectPlan('starter');
            }, 500);
        }

        // Setup Routing
        window.addEventListener('popstate', () => this.handleRouting());
        
        // Initial Auth Check
        if (this.state.token) {
            try {
                const payload = JSON.parse(atob(this.state.token.split('.')[1]));
                this.state.user = payload.email;
                this.state.role = payload.role;
                this.state.avatar = payload.avatar || `https://ui-avatars.com/api/?name=${this.state.user}`;
                this.state.userName = payload.name || this.state.user.split('@')[0];
                
                // Set default auth header immediately
                axios.defaults.headers.common['Authorization'] = `Bearer ${this.state.token}`;
                
                // Determine if we need to redirect away from landing page
                if (window.location.pathname === '/' || window.location.pathname === '/index.html') {
                    this.navigateTo('/dashboard', true);
                } else {
                    this.handleRouting();
                }
            } catch (e) {
                console.error("Session recovery failed:", e);
                this.logout();
            }
        } else {
            // No token
            if (window.location.pathname !== '/' && window.location.pathname !== '/index.html') {
                // Protected route accessed without token -> Redirect to landing
                this.navigateTo('/', true);
            } else {
                this.handleRouting();
            }
        }

        this.setupEventListeners();
        this.initSidebarResizer();
    },

    handleRouting() {
        const path = window.location.pathname;
        
        if (!this.state.token) {
            // Guest routes
            this.showAuthView();
            return;
        }

        // Protected routes
        switch(path) {
            case '/dashboard':
            case '/user-dashboard':
                this.showMainApp();
                this.showSection('user-dashboard');
                break;
            case '/wizard':
            case '/user-wizard':
                this.showMainApp();
                this.showSection('user-wizard');
                break;
            case '/billing':
            case '/user-billing':
                this.showMainApp();
                this.showSection('user-billing');
                break;
            
            case '/':
            case '/index.html':
                // Already logged in, redirect to dashboard
                this.navigateTo('/dashboard', true);
                break;
            default:
                this.showMainApp();
                this.showSection('user-dashboard');
                break;
        }
    },

    setupEventListeners() {
        // Navigation
        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.currentTarget.dataset.target;
                const pathMap = {
                    'user-dashboard': '/dashboard',
                    'user-wizard': '/wizard',
                    'user-billing': '/billing',
                    
                };
                
                if (target === 'admin-dashboard' || target === 'admin-setup') {
                    window.location.href = '/admin';
                    return;
                }
                
                this.navigateTo(pathMap[target] || '/dashboard');
            });
        });

        const logoutBtn = document.getElementById('btn-logout');
        if (logoutBtn) logoutBtn.addEventListener('click', () => this.logout());
        
        const logoutBtnTop = document.getElementById('btn-logout-top');
        if (logoutBtnTop) logoutBtnTop.addEventListener('click', () => this.logout());

        // Profile Dropdown
        const profileTrigger = document.getElementById('profile-trigger');
        const profileMenu = document.getElementById('profile-menu');
        if (profileTrigger && profileMenu) {
            profileTrigger.addEventListener('click', (e) => {
                e.stopPropagation();
                profileMenu.classList.toggle('active');
            });
            
            window.addEventListener('click', () => {
                profileMenu.classList.remove('active');
            });
        }
        const uploadInput = document.getElementById('file-upload-input');
        if (uploadInput) uploadInput.addEventListener('change', (e) => this.handleFileUpload(e));
        
        const upDirBtn = document.getElementById('btn-up-dir');
        if (upDirBtn) {
            upDirBtn.addEventListener('click', () => {
                const parts = this.state.currentPath.split('/');
                parts.pop();
                const newPath = parts.join('/') || '/';
                if (newPath.startsWith('/home/openclaw') || newPath === '/') {
                    this.loadFileBrowser(newPath);
                }
            });
        }

        // Wizard Provider selection (Admin only elements, but checking just in case)
        document.querySelectorAll('.provider-card').forEach(card => {
            card.addEventListener('click', (e) => {
                document.querySelectorAll('.provider-card').forEach(c => c.classList.remove('selected'));
                e.currentTarget.classList.add('selected');
                this.state.wizard.provider = e.currentTarget.dataset.provider;
                if (this.checkWizardStep2) this.checkWizardStep2();
            });
        });

        const apiKeyInput = document.getElementById('provider-api-key');
        if (apiKeyInput) apiKeyInput.addEventListener('input', () => this.checkWizardStep2());
        
        const machineTypeSelect = document.getElementById('machine-type');
        if (machineTypeSelect) machineTypeSelect.addEventListener('change', (e) => this.state.wizard.machineType = e.target.value);
        
        const diskSizeInput = document.getElementById('disk-size');
        if (diskSizeInput) diskSizeInput.addEventListener('input', (e) => this.state.wizard.diskSize = parseInt(e.target.value));
    },

    // --- Auth ---

    async handleGoogleLogin(credentialResponse) {
        try {
            const res = await axios.post(`${API_BASE}/auth/token`, {
                google_token: credentialResponse.credential
            });
            
            this.state.token = res.data.access_token;
            this.state.user = res.data.email;
            this.state.role = res.data.role;
            localStorage.setItem('mc_token', this.state.token);
            
            // Setup default headers for axios
            axios.defaults.headers.common['Authorization'] = `Bearer ${this.state.token}`;
            
            this.showMainApp();
        } catch (err) {
            console.error('Login failed:', err);
            alert('Login failed. Ensure backend is running.');
        }
    },

    logout() {
        this.state.token = null;
        this.state.user = null;
        this.state.role = null;
        localStorage.removeItem('mc_token');
        delete axios.defaults.headers.common['Authorization'];
        this.showAuthView();
        
        if (this.state.activeWs) {
            this.state.activeWs.close();
        }
        
        // Return to root on logout
        this.navigateTo('/', true);
    },

    showAuthView() {
        document.getElementById('main-view').classList.remove('active-view');
        document.getElementById('auth-view').classList.add('active-view');
    },

    showMainApp() {
        const authView = document.getElementById('auth-view');
        const mainView = document.getElementById('main-view');
        
        if (authView) authView.classList.remove('active-view');
        if (mainView) mainView.classList.add('active-view');
        
        axios.defaults.headers.common['Authorization'] = \`Bearer \${this.state.token}\`;
        
        // Restore/Update user profile from state
        if (!this.state.user && this.state.token) {
            try {
                const payload = JSON.parse(atob(this.state.token.split('.')[1]));
                this.state.user = payload.email;
                this.state.role = payload.role;
                this.state.avatar = payload.avatar || \`https://ui-avatars.com/api/?name=\${this.state.user}\`;
                this.state.userName = payload.name || this.state.user.split('@')[0];
            } catch(e) {}
        }

        // Update dashboard UI elements (Safely)
        const nameEl = document.getElementById('sidebar-name');
        if (nameEl) nameEl.innerText = this.state.userName || this.state.user;
        
        const emailEl = document.getElementById('sidebar-email');
        if (emailEl) emailEl.innerText = this.state.user;
        
        const avatarUrl = this.state.avatar || \`https://ui-avatars.com/api/?name=\${this.state.userName || this.state.user}&background=0D8ABC&color=fff\`;
        const avatarEl = document.getElementById('sidebar-avatar');
        if (avatarEl) avatarEl.src = avatarUrl;
        
        if (window.location.pathname === '/' || window.location.pathname === '/dashboard') {
             if (this.loadFleets) this.loadFleets();
        }
    },


    async loadFleets() {
        try {
            const res = await axios.get('/api/fleets');
            this.renderFleets(res.data);
        } catch (e) {
            console.error(e);
            document.getElementById('dashboard-content').innerHTML = '<div class="glass-panel" style="padding: 2rem; text-align: center;">Failed to load companies. ' + e.message + '</div>';
        }
    },

    renderFleets(fleets) {
        const container = document.getElementById('dashboard-content');
        const emptyState = document.getElementById('dashboard-empty-state');
        const hqBtn = document.getElementById('btn-bihand-hq');
        const listContainer = document.getElementById('fleet-dropdown-list');
        
        // Update dropdown
        let dropdownHtml = '';
        for (const f of fleets) {
            dropdownHtml += `
                <button class="w-full text-left px-3 py-2 text-sm hover:bg-secondary flex items-center justify-between transition-colors" onclick="app.selectFleet('${f.id}')">
                    <span class="truncate">${f.name}</span>
                    ${f.status === 'running' || f.status === 'provisioned' ? '<span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>' : ''}
                </button>
            `;
        }
        listContainer.innerHTML = dropdownHtml;

        if (fleets.length === 0) {
            emptyState.classList.remove('hidden');
            container.classList.add('hidden');
            document.getElementById('org-chart-container').innerHTML = '';
            document.getElementById('active-fleet-name').innerText = "No Companies";
            return;
        }

        // Auto select first fleet if none selected
        if (!this.state.activeFleetId) {
            this.selectFleet(fleets[0].id);
        }
    },

    async selectFleet(fleetId) {
        this.state.activeFleetId = fleetId;
        document.getElementById('fleet-dropdown').classList.add('hidden');
        
        try {
            const res = await axios.get(`/api/fleets/${fleetId}`);
            const data = res.data;
            
            // Update Dashboard
            document.getElementById('active-fleet-name').innerText = data.name;
            document.getElementById('breadcrumb-company').innerText = data.name;
            document.getElementById('dashboard-empty-state').classList.add('hidden');
            document.getElementById('dashboard-content').classList.remove('hidden');
            
            document.getElementById('stat-status').innerHTML = data.status === 'running' || data.status === 'provisioned' ? 
                '<span class="w-3 h-3 rounded-full bg-emerald-500"></span> Online' : 
                '<span class="w-3 h-3 rounded-full bg-amber-500"></span> ' + data.status;
            document.getElementById('stat-cost').innerText = '
        if (replace) {
            history.replaceState(null, '', path);
        } else if (window.location.pathname !== path) {
            history.pushState(null, '', path);
        }
        this.handleRouting();
    },

    showSection(sectionId) {
        // Update nav buttons
        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.target === sectionId) btn.classList.add('active');
        });
        
        // Update Breadcrumb
        const breadcrumb = document.getElementById('breadcrumb-current');
        if (breadcrumb) {
            const label = {
                'user-dashboard': 'Miner Claw Hub',
                'user-files': 'File Manager',
                'admin-dashboard': 'Admin Orchestration',
                'admin-setup': 'Admin Provisioning'
            };
            breadcrumb.innerText = label[sectionId] || 'Dashboard';
        }

        // Show section
        document.querySelectorAll('.content-section').forEach(sec => sec.classList.remove('active', 'active-section'));
        const targetSection = document.getElementById(sectionId);
        if (targetSection) {
            targetSection.classList.add('active-section');
        } else {
            // Default to dashboard if section not found
            document.getElementById('user-dashboard').classList.add('active-section');
        }
        
        // Load data based on section
        if (sectionId === 'user-dashboard') this.loadUserDashboard();
        
        if (sectionId === 'user-billing') this.loadUserBilling();
        if (sectionId === 'user-wizard') this.loadUserWizard();
    },

    // --- User Dashboard ---

    async loadUserDashboard() {
        const container = document.getElementById('instances-list-container');
        if (!container) return;

        try {
            const res = await axios.get(`${API_BASE}/instance`);
            if (!res.data.hasInstance || !res.data.instances || res.data.instances.length === 0) {
                container.innerHTML = `<div class="proxy-placeholder"><i class="ri-forbid-2-line" style="font-size:3rem"></i><p>${res.data.message || 'No active instances. Create one to get started.'}</p></div>`;
                return;
            }
            
            container.innerHTML = '';
            let hasTransitional = false;
            res.data.instances.forEach(inst => {
                const card = this.createInstanceCard(inst);
                container.appendChild(card);
                if (['provisioning', 'installing', 'starting', 'stopping', 'restarting', 'deleting'].includes(inst.status)) {
                    hasTransitional = true;
                }

                // If this instance was expanded, restore its files
                if (this.state.expandedInstances.includes(inst._id) && inst.status === 'running') {
                    this.loadInstanceFiles(inst._id);
                }
            });

            // Auto-refresh if something is changing
            if (hasTransitional) {
                if (this.dashboardTimer) clearTimeout(this.dashboardTimer);
                this.dashboardTimer = setTimeout(() => {
                    if (document.getElementById('user-dashboard').classList.contains('active-section')) {
                        this.loadUserDashboard();
                    }
                }, 5000);
            }
        } catch (e) {
            console.error(e);
            container.innerHTML = `<div class="proxy-placeholder"><i class="ri-error-warning-line" style="font-size:3rem;color:var(--danger)"></i><p>Failed to load dashboard.</p></div>`;
        }
    },

    createInstanceCard(inst) {
        const div = document.createElement('div');
        div.className = 'glass-panel instance-card';
        div.style.marginBottom = '2rem';
        div.style.padding = '2rem';
        div.id = `card-${inst._id}`;

        const isRunning = inst.status === 'running';
        const isStopped = inst.status === 'stopped';
        const isTransitional = ['provisioning', 'installing', 'starting', 'stopping', 'restarting', 'deleting'].includes(inst.status);
        const isExpanded = this.state.expandedInstances.includes(inst._id);
        
        const expiresDate = new Date(inst.expiresAt);
        const expiresStr = expiresDate.toLocaleString();
        const isExpired = expiresDate < new Date();
        
        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 1.5rem; opacity: ${isTransitional ? '0.7' : '1'}">
                <div>
                    <h2 style="margin: 0; display:flex; align-items:center; gap: 0.5rem; font-size:1.5rem;">
                        ${inst.alias || 'Unnamed instance'}
                    </h2>
                    <div style="display:flex; align-items:center; gap:0.5rem; font-weight:600; color: ${isExpired ? '#ef4444' : (isRunning ? '#10b981' : (isStopped ? '#94a3b8' : '#fbbf24'))}; margin-top:0.5rem; text-transform: capitalize; font-size:0.9rem;">
                        <div style="width:8px; height:8px; border-radius:50%; background:${isExpired ? '#ef4444' : (isRunning ? '#10b981' : (isStopped ? '#94a3b8' : '#fbbf24'))}; box-shadow: 0 0 5px ${isExpired ? '#ef4444' : (isRunning ? '#10b981' : (isStopped ? '#94a3b8' : '#fbbf24'))};"></div> 
                        ${isExpired ? 'Expired' : inst.status}
                    </div>
                </div>
                <div style="text-align:right;">
                    <div style="color: var(--text-muted); font-size: 0.85rem; margin-bottom:0.5rem;">
                        <span style="color: ${isExpired ? '#ef4444' : 'inherit'}"><i class="ri-time-line"></i> Expires: ${expiresStr}</span>
                    </div>
                    <div style="display:flex; gap:0.5rem; justify-content:flex-end;">
                        ${(isRunning && !isExpired && inst.externalIp) ? `<button class="btn btn-sm btn-outline" onclick="window.open('https://${inst.externalIp}/#token=${inst.dashboardToken}', '_blank')"><i class="ri-dashboard-line"></i> Dashboard</button>` : ''}
                        ${(isRunning && !isExpired) ? `<button class="btn btn-sm btn-primary" onclick="app.openIde('${inst._id}', '${inst.alias}')"><i class="ri-code-s-slash-line"></i> Custom UI</button>` : ''}
                        <button class="btn btn-sm btn-outline" onclick="app.extendInstancePrompt('${inst._id}')" ${isTransitional ? 'disabled' : ''}><i class="ri-history-line"></i> Extend</button>
                        <button class="btn btn-sm btn-outline" onclick="app.toggleManageSection('${inst._id}')" ${isTransitional ? 'disabled' : ''}><i class="ri-settings-4-line"></i> Manage</button>
                    </div>
                </div>
            </div>

            <div id="manage-${inst._id}" style="display:${isExpanded ? 'block' : 'none'}; border-top: 1px solid rgba(255,255,255,0.1); margin-top: 1.5rem; padding-top: 1.5rem;">
                <div style="display:grid; grid-template-columns: 1fr; gap:2rem;">
                    <div>
                        <h3 style="margin-bottom: 1rem; font-size: 1.1rem;"><i class="ri-gamepad-line"></i> Power Controls</h3>
                        <div style="display:flex; gap: 0.5rem; flex-wrap:wrap; margin-bottom: 2rem;">
                            <button class="btn btn-sm btn-outline" onclick="app.startMachine('${inst._id}')" ${isStopped ? '' : 'disabled'}><i class="ri-play-circle-line"></i> Start</button>
                            <button class="btn btn-sm btn-outline" onclick="app.stopMachine('${inst._id}')" ${isRunning ? '' : 'disabled'}><i class="ri-stop-circle-line"></i> Stop</button>
                            <button class="btn btn-sm btn-danger" onclick="app.destroyMachine('${inst._id}')" ${isTransitional ? 'disabled' : ''}><i class="ri-delete-bin-line"></i> Destroy</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        return div;
    },

    toggleManageSection(instanceId) {
        const index = this.state.expandedInstances.indexOf(instanceId);
        if (index === -1) {
            this.state.expandedInstances.push(instanceId);
            this.loadInstanceFiles(instanceId);
        } else {
            this.state.expandedInstances.splice(index, 1);
        }
        
        const el = document.getElementById(`manage-${instanceId}`);
        if (el) {
            el.style.display = el.style.display === 'none' ? 'block' : 'none';
        }
    },

    async loadInstanceFiles(instanceId, path) {
        const container = document.getElementById(`files-${instanceId}`);
        if (!container) return;

        // Use stored path if not provided
        if (!path) {
            path = this.state.instanceFiles[instanceId]?.path || '/home/openclaw';
        }
        
        // Update state
        if (!this.state.instanceFiles[instanceId]) this.state.instanceFiles[instanceId] = {};
        this.state.instanceFiles[instanceId].path = path;

        try {
            const res = await axios.get(`${API_BASE}/instance/${instanceId}/files?path=${encodeURIComponent(path)}`);
            
            let html = `
                <div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:1rem; font-size:0.8rem; color:var(--text-muted);">
                    <button class="btn btn-sm btn-outline" style="padding:2px 5px;" onclick="app.goUpDir('${instanceId}', '${path}')" ${path === '/home/openclaw' ? 'disabled' : ''}><i class="ri-arrow-up-line"></i></button>
                    <span style="font-family:monospace; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${path}</span>
                </div>
                <table style="width:100%; font-size:0.85rem;">
                    <thead>
                        <tr style="text-align:left; color:var(--text-muted); border-bottom: 1px solid rgba(255,255,255,0.05);">
                            <th style="padding-bottom:0.5rem;">Name</th>
                            <th style="padding-bottom:0.5rem; text-align:right;">Size</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            if (res.data.files.length === 0) {
                html += `<tr><td colspan="2" style="padding:2rem; text-align:center; color:var(--text-muted);">Empty Directory</td></tr>`;
            } else {
                res.data.files.forEach(f => {
                    const icon = f.isDirectory ? 'ri-folder-fill' : 'ri-file-text-line';
                    const size = f.isDirectory ? '-' : (f.size / 1024).toFixed(1) + ' KB';
                    html += `
                        <tr class="file-row" style="cursor:pointer;" onclick="${f.isDirectory ? `app.loadInstanceFiles('${instanceId}', '${f.path}')` : ''}">
                            <td style="padding:0.5rem 0; display:flex; align-items:center; gap:0.5rem;">
                                <i class="${icon}" style="color:var(--primary)"></i>
                                <span style="max-width:150px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${f.name}</span>
                            </td>
                            <td style="padding:0.5rem 0; text-align:right; font-family:monospace;">
                                ${size}
                                ${!f.isDirectory ? `<i class="ri-download-line" style="margin-left:0.5rem;" onclick="event.stopPropagation(); app.downloadInstanceFile('${instanceId}', '${f.path}')"></i>` : ''}
                                <i class="ri-delete-bin-line" style="margin-left:0.5rem; color:var(--danger);" onclick="event.stopPropagation(); app.deleteInstanceFile('${instanceId}', '${f.path}')"></i>
                            </td>
                        </tr>
                    `;
                });
            }

            html += `</tbody></table>`;
            container.innerHTML = html;
        } catch (e) {
            container.innerHTML = `<p style="color:var(--danger); font-size:0.8rem; text-align:center; margin-top:2rem;">Failed to load files: ${e.response?.data?.detail || e.message}</p>`;
        }
    },

    goUpDir(instanceId, currentPath) {
        const parts = currentPath.split('/');
        parts.pop();
        const newPath = parts.join('/') || '/';
        this.loadInstanceFiles(instanceId, newPath);
    },





    async deleteInstanceFile(instanceId, path) {
        if (!confirm('Delete this?')) return;
        try {
            await axios.delete(`${API_BASE}/instance/${instanceId}/files?path=${encodeURIComponent(path)}`);
            const currentPath = this.state.instanceFiles[instanceId]?.path || '/home/openclaw';
            this.loadInstanceFiles(instanceId, currentPath);
        } catch (err) { alert(`Delete failed: ${err.message}`); }
    },

    async extendInstancePrompt(instanceId) {
        const modal = document.getElementById('extension-modal');
        const input = document.getElementById('extend-instance-id');
        const select = document.getElementById('extend-duration-select');
        if (!modal || !input || !select) return;
        
        input.value = instanceId;
        
        // Find the instance to get its machineType
        try {
            const res = await axios.get(`${API_BASE}/instance`);
            const instances = res.data.instances || [];
            const instance = instances.find(i => i._id === instanceId);
            
            const machineType = instance ? (instance.machineType || 'e2-small') : 'e2-small';
            const multipliers = {
                'e2-small': 1, 'e2-medium': 2, 'e2-standard-2': 4,
                'e2-standard-4': 8, 'e2-standard-8': 16, 'n2-standard-4': 12
            };
            const costMultiplier = multipliers[machineType] || 1;
            
            select.innerHTML = `
                <option value="30">1 Month (${30 * costMultiplier} Credits)</option>
                <option value="90">3 Months (${90 * costMultiplier} Credits)</option>
                <option value="360">12 Months (${360 * costMultiplier} Credits)</option>
            `;
        } catch (e) {
            console.error('Failed to fetch instance details for extension modal', e);
        }

        modal.classList.add('active');
    },

    async submitExtension() {
        const instanceId = document.getElementById('extend-instance-id')?.value;
        const duration = parseInt(document.getElementById('extend-duration-select')?.value || 30);
        
        if (!instanceId) return;

        try {
            const btn = document.querySelector('#extension-modal .btn-primary');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Processing...';
            btn.disabled = true;

            const res = await axios.post(`${API_BASE}/instance/${instanceId}/extend`, { durationDays: duration });
            alert(res.data.message);
            document.getElementById('extension-modal').classList.remove('active');
            this.loadUserDashboard();
        } catch (e) {
            alert('Extension failed: ' + (e.response?.data?.detail || e.message));
        } finally {
            const btn = document.querySelector('#extension-modal .btn-primary');
            if (btn) {
                btn.innerHTML = 'Confirm Extension';
                btn.disabled = false;
            }
        }
    },

    async loadUserBilling() {
        try {
            const res = await axios.get(`${API_BASE}/auth/me`);
            const credits = res.data.user.credits || 0;
            const display = document.getElementById('user-credits-display');
            if (display) display.innerText = credits;
        } catch (e) {
            console.error('Failed to load user credits', e);
        }
    },

    async checkout(packageId) {
        try {
            const res = await axios.post(`${API_BASE}/billing/checkout`, { package_id: packageId });
            if (res.data.url) {
                window.location.href = res.data.url;
            }
        } catch (e) {
            alert('Checkout failed: ' + (e.response?.data?.detail || e.message));
        }
    },

    async startMachine(instanceId) {
        if (!confirm('Are you sure you want to start this instance?')) return;
        try {
            await axios.post(`${API_BASE}/instance/${instanceId}/start`);
            this.showSection('user-dashboard');
        } catch (e) {
            alert('Failed to start instance: ' + (e.response?.data?.detail || e.message));
        }
    },

    async stopMachine(instanceId) {
        if (!confirm('Are you sure you want to stop this instance?')) return;
        try {
            await axios.post(`${API_BASE}/instance/${instanceId}/stop`);
            this.showSection('user-dashboard');
        } catch (e) {
            alert('Failed to stop instance: ' + (e.response?.data?.detail || e.message));
        }
    },

    async destroyMachine(instanceId) {
        if (!confirm('DANGER: Are you absolutely sure you want to destroy this instance? All data will be permanently lost!')) return;
        try {
            await axios.post(`${API_BASE}/instance/${instanceId}/destroy`);
            alert('Instance is being destroyed.');
            this.showSection('user-dashboard');
        } catch (e) {
            alert('Failed to destroy instance: ' + (e.response?.data?.detail || e.message));
        }
    },

    async handleMessagingAction(instanceId, channel) {
        const tokenInput = prompt(`Enter your ${channel} Bot Token:`);
        if (!tokenInput) return;
        try {
            const res = await axios.post(`${API_BASE}/instance/${instanceId}/channel`, { channel: channel.toLowerCase(), token: tokenInput });
            alert(res.data.message);
            this.showSection('user-dashboard');
        } catch (e) {
            alert(`Failed to configure ${channel}: ` + (e.response?.data?.detail || e.message));
        }
    },

    async loadUserWizard() {
        this.nextWizard(1);
        try {
            const res = await axios.get(`${API_BASE}/auth/me`);
            const credits = res.data.user.credits || 0;
            const display = document.getElementById('wizard-available-credits');
            if (display) display.innerText = `${credits} Credits`;
        } catch (e) {
            console.error(e);
        }
    },

    async nextWizard(step) {
        if (step === 2) {
            const selectedProviderTab = document.querySelector('.provider-tab.selected');
            const provider = selectedProviderTab ? selectedProviderTab.dataset.provider : 'gemini';
            const apiKey = document.getElementById('user-wizard-apikey')?.value;
            const password = document.getElementById('user-wizard-password')?.value;
            
            if (!apiKey || apiKey.trim() === '') return alert('API Key is required.');
            if (!password || password.trim() === '') return alert('Dashboard password is required.');
            
            try {
                const btn = document.querySelector('#btn-next-step1');
                if (btn) { btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Verifying...'; btn.disabled = true; }
                await axios.post(`${API_BASE}/instance/verify-key`, { provider, apiKey });
                if (btn) { btn.innerHTML = 'Continue <i class="ri-arrow-right-s-line"></i>'; btn.disabled = false; }
            } catch (e) {
                const btn = document.querySelector('#btn-next-step1');
                if (btn) { btn.innerHTML = 'Continue <i class="ri-arrow-right-s-line"></i>'; btn.disabled = false; }
                return alert('Invalid API Key: ' + (e.response?.data?.detail || e.message));
            }
        }
        
        document.getElementById('wizard-step-1').style.display = 'none';
        document.getElementById('wizard-step-2').style.display = 'none';
        document.getElementById('wizard-step-loading').style.display = 'none';
        
        document.querySelectorAll('.wizard-steps .step').forEach(el => {
            el.classList.remove('active');
            if (parseInt(el.dataset.step) <= step) el.classList.add('active');
        });
        
        if (step === 1) document.getElementById('wizard-step-1').style.display = 'block';
        if (step === 2) {
            document.getElementById('wizard-step-2').style.display = 'block';
            this.updateWizardCost();
        }
        if (step === 3) document.getElementById('wizard-step-loading').style.display = 'block';
    },

    updateWizardCost() {
        const multipliers = {
            'e2-small': 1,
            'e2-medium': 2,
            'e2-standard-2': 4,
            'e2-standard-4': 8,
            'e2-standard-8': 16,
            'n2-standard-4': 12
        };
        const machineSelect = document.getElementById('user-wizard-machine');
        const iterationSelect = document.getElementById('user-wizard-iteration');
        const durationSelect = document.getElementById('user-wizard-duration');
        const totalCostDisplay = document.getElementById('wizard-total-cost');
        const warningDisplay = document.getElementById('iteration-warning');
        
        if (!machineSelect || !iterationSelect || !durationSelect) return;
        
        const machineType = machineSelect.value;
        const iteration = iterationSelect.value;
        const duration = parseInt(durationSelect.value);
        const costMultiplier = multipliers[machineType] || 1;
        
        const isInvalid = (iteration === 'nemoclaw' && costMultiplier < 4);
        
        if (warningDisplay) {
            warningDisplay.style.display = isInvalid ? 'block' : 'none';
        }
        
        const total = duration * costMultiplier;
        if (totalCostDisplay) {
            totalCostDisplay.innerText = `${total} Credits`;
            if (isInvalid) {
                totalCostDisplay.style.color = 'var(--danger)';
            } else {
                totalCostDisplay.style.color = '#fff';
            }
        }
    },

    selectProvider(tabElement) {
        document.querySelectorAll('.provider-tab').forEach(tab => {
            tab.classList.remove('selected');
            tab.style.border = '1px solid rgba(255,255,255,0.1)';
            tab.style.background = 'rgba(255,255,255,0.02)';
            tab.style.opacity = '0.7';
        });
        tabElement.classList.add('selected');
        tabElement.style.border = '1px solid var(--primary)';
        tabElement.style.background = 'rgba(16,185,129,0.05)';
        tabElement.style.opacity = '1';
        this.updateWizardModels(tabElement.dataset.provider);
    },

    updateWizardModels(provider) {
        const modelSelect = document.getElementById('user-wizard-model');
        if (!modelSelect) return;
        modelSelect.innerHTML = '';
        const models = {
            'gemini': ['gemini-3.1-pro-preview', 'gemini-3.1-flash-lite-preview', 'gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'],
            'openai': ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.4-pro-2026-03-05'],
            'anthropic': ['claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-opus-4-6']
        };
        (models[provider] || []).forEach(m => {
            modelSelect.innerHTML += `<option value="${m}">${m}</option>`;
        });
    },

    async submitProvision() {
        const provider = document.querySelector('.provider-tab.selected')?.dataset.provider || 'gemini';
        const model = document.getElementById('user-wizard-model')?.value || 'gemini-3.1-pro-preview';
        const apiKey = document.getElementById('user-wizard-apikey')?.value;
        const alias = document.getElementById('user-wizard-alias')?.value || 'My Agent';
        const password = document.getElementById('user-wizard-password')?.value;
        const duration = parseInt(document.getElementById('user-wizard-duration').value);
        const machineType = document.getElementById('user-wizard-machine')?.value || 'e2-small';
        const iteration = document.getElementById('user-wizard-iteration')?.value || 'openclaw';

        const multipliers = {
            'e2-small': 1, 'e2-medium': 2, 'e2-standard-2': 4,
            'e2-standard-4': 8, 'e2-standard-8': 16, 'n2-standard-4': 12
        };
        const costMultiplier = multipliers[machineType] || 1;
        if (iteration === 'nemoclaw' && costMultiplier < 4) {
            return alert('NemoClaw requires at least E2 Standard 2. Please change your selection.');
        }

        this.nextWizard(3);
        try {
            await axios.post(`${API_BASE}/instance/provision`, { 
                provider, model, apiKey, password, alias, 
                durationDays: duration, machineType, iteration 
            });
            this.showSection('user-dashboard');
        } catch (e) {
            alert('Provisioning failed: ' + (e.response?.data?.detail || e.message));
            this.nextWizard(2);
        }
    }
,
    // --- Sidebar Resizer Logic ---
    initSidebarResizer() {
        const resizer = document.getElementById('ide-sidebar-resizer');
        const sidebar = document.getElementById('ide-sidebar');
        if (!resizer || !sidebar) return;

        let isResizing = false;

        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            resizer.classList.add('is-resizing');
            document.body.style.cursor = 'col-resize';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            let newWidth = e.clientX - 50; 
            if (newWidth < 150) newWidth = 150;
            if (newWidth > 600) newWidth = 600;
            sidebar.style.setProperty('--sidebar-width', `${newWidth}px`);
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                resizer.classList.remove('is-resizing');
                document.body.style.cursor = '';
            }
        });
    }
};

// Global Google Auth handler
window.handleCredentialResponse = (response) => {
    app.handleGoogleLogin(response);
};

// Start app
document.addEventListener('DOMContentLoaded', () => {
    app.init();
});

// Re-add the IDE functions that were overwritten

app.openIde = function(instanceId, instanceAlias) {
    // Open the IDE in a new tab
    const url = `/ide/${instanceId}?alias=${encodeURIComponent(instanceAlias || 'Agent')}`;
    window.open(url, '_blank');
};

app.closeIde = function() {
    if (this.state.chatWs) {
        this.state.chatWs.close();
        this.state.chatWs = null;
    }
    document.getElementById('user-ide').style.display = 'none';
    document.getElementById('user-dashboard').classList.add('active-section');
};

app.toggleIdeSidebar = function(tool) {
    const sidebar = document.getElementById('ide-sidebar');
    const resizer = document.getElementById('ide-sidebar-resizer');
    
    // Handle active buttons
    document.querySelectorAll('.activity-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.querySelector(`.activity-btn[data-tool="${tool}"]`);
    if (activeBtn) activeBtn.classList.add('active');

    if (tool === 'chat') {
        sidebar.style.display = 'none';
        if (resizer) resizer.style.display = 'none';
        return;
    }

    sidebar.style.display = 'flex';
    if (resizer) resizer.style.display = 'block';
    document.querySelectorAll('.tool-content').forEach(tc => tc.style.display = 'none');
    document.getElementById(`tool-content-${tool}`).style.display = 'block';

    if (tool === 'files') {
        this.loadIdeFiles(this.state.activeInstanceId, '/root/.openclaw');
    }
};

app.loadIdeFiles = async function(instanceId, path = '/root/.openclaw') {
    const container = document.getElementById('ide-file-tree');
    container.innerHTML = '<div class="spinner" style="margin:2rem auto"></div>';
    
    try {
        const res = await axios.get(`${API_BASE}/instance/${instanceId}/files?path=${encodeURIComponent(path)}`);
        const data = res.data;
        
        let html = `<div class="path-nav">
            <button class="btn btn-sm btn-outline" onclick="app.loadIdeFiles('${instanceId}', '${data.parentPath}')" ${!data.parentPath ? 'disabled' : ''}><i class="ri-arrow-up-line"></i> Up</button>
            <div class="current-path">${data.path}</div>
            <div style="flex-grow:1"></div>
            <button class="btn btn-sm btn-outline" onclick="document.getElementById('ide-upload-input').click()"><i class="ri-upload-2-line"></i></button>
            <input type="file" id="ide-upload-input" style="display:none" onchange="app.handleIdeFileUpload('${instanceId}', '${data.path}', event)">
        </div>
        <div style="padding: 1rem;">`;
        
        if (data.files && data.files.length > 0) {
            data.files.forEach(f => {
                const icon = f.is_dir ? 'ri-folder-fill text-secondary' : 'ri-file-text-line text-muted';
                html += `
                    <div class="file-row" style="display:flex; justify-content:space-between; align-items:center; padding: 0.5rem; border-bottom: 1px solid rgba(255,255,255,0.05);">
                        <div style="display:flex; align-items:center; gap:0.75rem;" onclick="${f.is_dir ? `app.loadIdeFiles('${instanceId}', '${data.path}/${f.name}')` : ''}">
                            <i class="${icon}"></i>
                            <span>${f.name}</span>
                        </div>
                        ${!f.is_dir ? `
                        <div class="file-actions-row">
                            <button class="btn btn-sm" onclick="app.downloadIdeFile('${instanceId}', '${data.path}/${f.name}')"><i class="ri-download-2-line"></i></button>
                            <button class="btn btn-sm" style="color:var(--danger)" onclick="app.deleteIdeFile('${instanceId}', '${data.path}/${f.name}', '${data.path}')"><i class="ri-delete-bin-line"></i></button>
                        </div>
                        ` : ''}
                    </div>
                `;
            });
        } else {
            html += `<p class="text-muted text-center" style="margin-top:1rem;">Folder is empty</p>`;
        }
        html += `</div>`;
        container.innerHTML = html;
    } catch (e) {
        container.innerHTML = `<p class="text-danger text-center" style="margin-top:2rem;">Failed to load files: ${e.response?.data?.detail || e.message}</p>`;
    }
};

app.handleIdeFileUpload = async function(instanceId, path, event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        await axios.post(`${API_BASE}/instance/${instanceId}/files/upload?path=${encodeURIComponent(path)}`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
        });
        this.loadIdeFiles(instanceId, path);
    } catch (e) {
        alert(`Upload failed: ${e.response?.data?.detail || e.message}`);
    }
};

app.downloadIdeFile = async function(instanceId, path) {
    try {
        const res = await axios.get(`${API_BASE}/instance/${instanceId}/files/download?path=${encodeURIComponent(path)}`, { responseType: 'blob' });
        const url = window.URL.createObjectURL(new Blob([res.data]));
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', path.split('/').pop());
        document.body.appendChild(link);
        link.click();
        link.remove();
    } catch (e) {
        alert("Download failed");
    }
};

app.deleteIdeFile = async function(instanceId, path, parentPath) {
    if (!confirm(`Delete ${path}?`)) return;
    try {
        await axios.delete(`${API_BASE}/instance/${instanceId}/files?path=${encodeURIComponent(path)}`);
        this.loadIdeFiles(instanceId, parentPath);
    } catch (e) {
        alert(`Delete failed: ${e.response?.data?.detail || e.message}`);
    }
};

app.connectChatWebSocket = function(instanceId) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}${API_BASE}/ws/chat/${instanceId}?token=${this.state.token}`;
    
    this.state.chatWs = new WebSocket(wsUrl);
    this.state.currentAgentMessageDiv = null;
    
    this.state.chatWs.onopen = () => {
        console.log("Chat WS Connected");
    };
    
    this.state.chatWs.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'message') {
            if (this.state.typingIndicatorDiv) {
                this.state.typingIndicatorDiv.remove();
                this.state.typingIndicatorDiv = null;
            }
            if (data.isReplace) {
                if (!this.state.currentAgentMessageDiv) {
                    this.state.currentAgentMessageDiv = this.createChatMessageDiv('agent');
                    this.state.currentAgentRawText = "";
                }
                this.state.currentAgentRawText = data.text;
                const wrapper = this.state.currentAgentMessageDiv.querySelector('.message-content-wrapper');
                if (wrapper) wrapper.innerHTML = this.formatAgentText(this.state.currentAgentRawText);
                const container = document.getElementById('ide-chat-history');
                container.scrollTop = container.scrollHeight;
            } else if (data.isChunk) {
                if (!this.state.currentAgentMessageDiv) {
                    this.state.currentAgentMessageDiv = this.createChatMessageDiv('agent');
                    this.state.currentAgentRawText = "";
                }
                // Append chunk to the current raw text buffer
                this.state.currentAgentRawText += data.text;
                const wrapper = this.state.currentAgentMessageDiv.querySelector('.message-content-wrapper');
                if (wrapper) wrapper.innerHTML = this.formatAgentText(this.state.currentAgentRawText);
                const container = document.getElementById('ide-chat-history');
                container.scrollTop = container.scrollHeight;
            } else if (data.isComplete) {
                // Finalize current bubble
                this.state.currentAgentMessageDiv = null;
            } else {
                // Regular full message
                this.appendChatMessage(data.text, 'agent');
            }
        } else if (data.type === 'update_tool') {
            const contentDiv = document.getElementById(`content-${data.itemId}`);
            if (contentDiv) contentDiv.innerHTML = data.content;
        } else if (data.type === 'update_tool_append') {
            const contentDiv = document.getElementById(`content-${data.itemId}`);
            if (contentDiv) contentDiv.innerHTML += data.content;
        } else if (data.type === 'error') {
            if (this.state.typingIndicatorDiv) {
                this.state.typingIndicatorDiv.remove();
                this.state.typingIndicatorDiv = null;
            }
            this.appendChatMessage(`Error: ${data.text}`, 'agent');
            this.state.currentAgentMessageDiv = null;
        }
    };
    
    this.state.chatWs.onclose = () => {
        console.log("Chat WS Closed");
        if (this.state.typingIndicatorDiv) {
            this.state.typingIndicatorDiv.remove();
            this.state.typingIndicatorDiv = null;
        }
        this.appendChatMessage("Connection lost. Trying to reconnect...", "agent");
        this.state.currentAgentMessageDiv = null;
    };
};

app.sendChatMessage = function() {
    const input = document.getElementById('ide-chat-input');
    const text = input.value.trim();
    if (!text) return;
    
    if (!this.state.chatWs || this.state.chatWs.readyState !== WebSocket.OPEN) {
        alert("Chat connection is not open");
        return;
    }
    
    this.appendChatMessage(text, 'user');
    this.state.currentAgentMessageDiv = null; // Ensure new response starts a new bubble
    
    // Add typing indicator
    this.state.typingIndicatorDiv = document.createElement('div');
    this.state.typingIndicatorDiv.className = 'typing-indicator';
    this.state.typingIndicatorDiv.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';
    const container = document.getElementById('ide-chat-history');
    container.appendChild(this.state.typingIndicatorDiv);
    container.scrollTop = container.scrollHeight;
    
    this.state.chatWs.send(JSON.stringify({ text: text }));
    input.value = '';
};

app.createChatMessageDiv = function(sender) {
    const container = document.getElementById('ide-chat-history');
    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-message ${sender}`;
    msgDiv.classList.add('parsed-markdown');
    
    const wrapper = document.createElement('div');
    wrapper.className = 'message-content-wrapper';
    msgDiv.appendChild(wrapper);
    
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
    return msgDiv;
};

app.formatAgentText = function(text) {
    if (!text) return "";
    let formatted = text.replace(/<think\s*>/g, '<details class="thought-process" open><summary><i class="ri-brain-line"></i> Thinking Process</summary><div class="thought-content">');
    formatted = formatted.replace(/<\/think\s*>/g, '</div></details>');
    formatted = formatted.replace(/<final\s*>/g, '');
    formatted = formatted.replace(/<\/final\s*>/g, '');
    // Convert newlines to breaks
    formatted = formatted.replace(/\n/g, '<br/>');
    return formatted;
};

app.appendChatMessage = function(text, sender) {
    const msgDiv = this.createChatMessageDiv(sender);
    const wrapper = msgDiv.querySelector('.message-content-wrapper');
    if (wrapper) {
        wrapper.innerHTML = this.formatAgentText(text);
    } else {
        msgDiv.innerHTML = this.formatAgentText(text);
    }
};

 + data.totalPrice;
            document.getElementById('stat-agents').innerText = data.instances.length;
            
            const hqBtn = document.getElementById('btn-bihand-hq');
            hqBtn.href = data.dashboardUrl;
            hqBtn.classList.remove('hidden');
            
            // Update Org Chart
            let orgHtml = '';
            for (const inst of data.instances) {
                let statCol = inst.status === 'running' ? 'text-emerald-500' : 'text-amber-500';
                orgHtml += `
                    <div class="border border-border rounded-xl p-6 bg-card flex items-center justify-between mt-4">
                        <div class="flex items-center gap-4">
                            <div class="w-12 h-12 rounded-full bg-secondary flex items-center justify-center text-xl text-muted">
                                <i class="ri-robot-2-line"></i>
                            </div>
                            <div>
                                <h3 class="font-semibold text-lg">${inst.role}</h3>
                                <p class="text-sm text-muted">${inst.agentType.toUpperCase()} &middot; ${inst.status}</p>
                            </div>
                        </div>
                        <div class="flex items-center gap-3">
                            ${inst.ip ? `<a href="http://${inst.ip}/screen/vnc.html" target="_blank" class="btn btn-outline text-xs"><i class="ri-tv-2-line"></i> Live Screen</a>` : ''}
                            <button class="btn btn-outline text-xs"><i class="ri-settings-3-line"></i> Config</button>
                        </div>
                    </div>
                `;
            }
            document.getElementById('org-chart-container').innerHTML = orgHtml;
            
            this.showSection('user-dashboard');
            
        } catch (e) {
            console.error(e);
        }
    },

\n    navigateTo(path, replace = false) {
        if (replace) {
            history.replaceState(null, '', path);
        } else if (window.location.pathname !== path) {
            history.pushState(null, '', path);
        }
        this.handleRouting();
    },

    showSection(sectionId) {
        // Update nav buttons
        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.target === sectionId) btn.classList.add('active');
        });
        
        // Update Breadcrumb
        const breadcrumb = document.getElementById('breadcrumb-current');
        if (breadcrumb) {
            const label = {
                'user-dashboard': 'Miner Claw Hub',
                'user-files': 'File Manager',
                'admin-dashboard': 'Admin Orchestration',
                'admin-setup': 'Admin Provisioning'
            };
            breadcrumb.innerText = label[sectionId] || 'Dashboard';
        }

        // Show section
        document.querySelectorAll('.content-section').forEach(sec => sec.classList.remove('active', 'active-section'));
        const targetSection = document.getElementById(sectionId);
        if (targetSection) {
            targetSection.classList.add('active-section');
        } else {
            // Default to dashboard if section not found
            document.getElementById('user-dashboard').classList.add('active-section');
        }
        
        // Load data based on section
        if (sectionId === 'user-dashboard') this.loadUserDashboard();
        
        if (sectionId === 'user-billing') this.loadUserBilling();
        if (sectionId === 'user-wizard') this.loadUserWizard();
    },

    // --- User Dashboard ---

    async loadUserDashboard() {
        const container = document.getElementById('instances-list-container');
        if (!container) return;

        try {
            const res = await axios.get(`${API_BASE}/instance`);
            if (!res.data.hasInstance || !res.data.instances || res.data.instances.length === 0) {
                container.innerHTML = `<div class="proxy-placeholder"><i class="ri-forbid-2-line" style="font-size:3rem"></i><p>${res.data.message || 'No active instances. Create one to get started.'}</p></div>`;
                return;
            }
            
            container.innerHTML = '';
            let hasTransitional = false;
            res.data.instances.forEach(inst => {
                const card = this.createInstanceCard(inst);
                container.appendChild(card);
                if (['provisioning', 'installing', 'starting', 'stopping', 'restarting', 'deleting'].includes(inst.status)) {
                    hasTransitional = true;
                }

                // If this instance was expanded, restore its files
                if (this.state.expandedInstances.includes(inst._id) && inst.status === 'running') {
                    this.loadInstanceFiles(inst._id);
                }
            });

            // Auto-refresh if something is changing
            if (hasTransitional) {
                if (this.dashboardTimer) clearTimeout(this.dashboardTimer);
                this.dashboardTimer = setTimeout(() => {
                    if (document.getElementById('user-dashboard').classList.contains('active-section')) {
                        this.loadUserDashboard();
                    }
                }, 5000);
            }
        } catch (e) {
            console.error(e);
            container.innerHTML = `<div class="proxy-placeholder"><i class="ri-error-warning-line" style="font-size:3rem;color:var(--danger)"></i><p>Failed to load dashboard.</p></div>`;
        }
    },

    createInstanceCard(inst) {
        const div = document.createElement('div');
        div.className = 'glass-panel instance-card';
        div.style.marginBottom = '2rem';
        div.style.padding = '2rem';
        div.id = `card-${inst._id}`;

        const isRunning = inst.status === 'running';
        const isStopped = inst.status === 'stopped';
        const isTransitional = ['provisioning', 'installing', 'starting', 'stopping', 'restarting', 'deleting'].includes(inst.status);
        const isExpanded = this.state.expandedInstances.includes(inst._id);
        
        const expiresDate = new Date(inst.expiresAt);
        const expiresStr = expiresDate.toLocaleString();
        const isExpired = expiresDate < new Date();
        
        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 1.5rem; opacity: ${isTransitional ? '0.7' : '1'}">
                <div>
                    <h2 style="margin: 0; display:flex; align-items:center; gap: 0.5rem; font-size:1.5rem;">
                        ${inst.alias || 'Unnamed instance'}
                    </h2>
                    <div style="display:flex; align-items:center; gap:0.5rem; font-weight:600; color: ${isExpired ? '#ef4444' : (isRunning ? '#10b981' : (isStopped ? '#94a3b8' : '#fbbf24'))}; margin-top:0.5rem; text-transform: capitalize; font-size:0.9rem;">
                        <div style="width:8px; height:8px; border-radius:50%; background:${isExpired ? '#ef4444' : (isRunning ? '#10b981' : (isStopped ? '#94a3b8' : '#fbbf24'))}; box-shadow: 0 0 5px ${isExpired ? '#ef4444' : (isRunning ? '#10b981' : (isStopped ? '#94a3b8' : '#fbbf24'))};"></div> 
                        ${isExpired ? 'Expired' : inst.status}
                    </div>
                </div>
                <div style="text-align:right;">
                    <div style="color: var(--text-muted); font-size: 0.85rem; margin-bottom:0.5rem;">
                        <span style="color: ${isExpired ? '#ef4444' : 'inherit'}"><i class="ri-time-line"></i> Expires: ${expiresStr}</span>
                    </div>
                    <div style="display:flex; gap:0.5rem; justify-content:flex-end;">
                        ${(isRunning && !isExpired && inst.externalIp) ? `<button class="btn btn-sm btn-outline" onclick="window.open('https://${inst.externalIp}/#token=${inst.dashboardToken}', '_blank')"><i class="ri-dashboard-line"></i> Dashboard</button>` : ''}
                        ${(isRunning && !isExpired) ? `<button class="btn btn-sm btn-primary" onclick="app.openIde('${inst._id}', '${inst.alias}')"><i class="ri-code-s-slash-line"></i> Custom UI</button>` : ''}
                        <button class="btn btn-sm btn-outline" onclick="app.extendInstancePrompt('${inst._id}')" ${isTransitional ? 'disabled' : ''}><i class="ri-history-line"></i> Extend</button>
                        <button class="btn btn-sm btn-outline" onclick="app.toggleManageSection('${inst._id}')" ${isTransitional ? 'disabled' : ''}><i class="ri-settings-4-line"></i> Manage</button>
                    </div>
                </div>
            </div>

            <div id="manage-${inst._id}" style="display:${isExpanded ? 'block' : 'none'}; border-top: 1px solid rgba(255,255,255,0.1); margin-top: 1.5rem; padding-top: 1.5rem;">
                <div style="display:grid; grid-template-columns: 1fr; gap:2rem;">
                    <div>
                        <h3 style="margin-bottom: 1rem; font-size: 1.1rem;"><i class="ri-gamepad-line"></i> Power Controls</h3>
                        <div style="display:flex; gap: 0.5rem; flex-wrap:wrap; margin-bottom: 2rem;">
                            <button class="btn btn-sm btn-outline" onclick="app.startMachine('${inst._id}')" ${isStopped ? '' : 'disabled'}><i class="ri-play-circle-line"></i> Start</button>
                            <button class="btn btn-sm btn-outline" onclick="app.stopMachine('${inst._id}')" ${isRunning ? '' : 'disabled'}><i class="ri-stop-circle-line"></i> Stop</button>
                            <button class="btn btn-sm btn-danger" onclick="app.destroyMachine('${inst._id}')" ${isTransitional ? 'disabled' : ''}><i class="ri-delete-bin-line"></i> Destroy</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        return div;
    },

    toggleManageSection(instanceId) {
        const index = this.state.expandedInstances.indexOf(instanceId);
        if (index === -1) {
            this.state.expandedInstances.push(instanceId);
            this.loadInstanceFiles(instanceId);
        } else {
            this.state.expandedInstances.splice(index, 1);
        }
        
        const el = document.getElementById(`manage-${instanceId}`);
        if (el) {
            el.style.display = el.style.display === 'none' ? 'block' : 'none';
        }
    },

    async loadInstanceFiles(instanceId, path) {
        const container = document.getElementById(`files-${instanceId}`);
        if (!container) return;

        // Use stored path if not provided
        if (!path) {
            path = this.state.instanceFiles[instanceId]?.path || '/home/openclaw';
        }
        
        // Update state
        if (!this.state.instanceFiles[instanceId]) this.state.instanceFiles[instanceId] = {};
        this.state.instanceFiles[instanceId].path = path;

        try {
            const res = await axios.get(`${API_BASE}/instance/${instanceId}/files?path=${encodeURIComponent(path)}`);
            
            let html = `
                <div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:1rem; font-size:0.8rem; color:var(--text-muted);">
                    <button class="btn btn-sm btn-outline" style="padding:2px 5px;" onclick="app.goUpDir('${instanceId}', '${path}')" ${path === '/home/openclaw' ? 'disabled' : ''}><i class="ri-arrow-up-line"></i></button>
                    <span style="font-family:monospace; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${path}</span>
                </div>
                <table style="width:100%; font-size:0.85rem;">
                    <thead>
                        <tr style="text-align:left; color:var(--text-muted); border-bottom: 1px solid rgba(255,255,255,0.05);">
                            <th style="padding-bottom:0.5rem;">Name</th>
                            <th style="padding-bottom:0.5rem; text-align:right;">Size</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            if (res.data.files.length === 0) {
                html += `<tr><td colspan="2" style="padding:2rem; text-align:center; color:var(--text-muted);">Empty Directory</td></tr>`;
            } else {
                res.data.files.forEach(f => {
                    const icon = f.isDirectory ? 'ri-folder-fill' : 'ri-file-text-line';
                    const size = f.isDirectory ? '-' : (f.size / 1024).toFixed(1) + ' KB';
                    html += `
                        <tr class="file-row" style="cursor:pointer;" onclick="${f.isDirectory ? `app.loadInstanceFiles('${instanceId}', '${f.path}')` : ''}">
                            <td style="padding:0.5rem 0; display:flex; align-items:center; gap:0.5rem;">
                                <i class="${icon}" style="color:var(--primary)"></i>
                                <span style="max-width:150px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${f.name}</span>
                            </td>
                            <td style="padding:0.5rem 0; text-align:right; font-family:monospace;">
                                ${size}
                                ${!f.isDirectory ? `<i class="ri-download-line" style="margin-left:0.5rem;" onclick="event.stopPropagation(); app.downloadInstanceFile('${instanceId}', '${f.path}')"></i>` : ''}
                                <i class="ri-delete-bin-line" style="margin-left:0.5rem; color:var(--danger);" onclick="event.stopPropagation(); app.deleteInstanceFile('${instanceId}', '${f.path}')"></i>
                            </td>
                        </tr>
                    `;
                });
            }

            html += `</tbody></table>`;
            container.innerHTML = html;
        } catch (e) {
            container.innerHTML = `<p style="color:var(--danger); font-size:0.8rem; text-align:center; margin-top:2rem;">Failed to load files: ${e.response?.data?.detail || e.message}</p>`;
        }
    },

    goUpDir(instanceId, currentPath) {
        const parts = currentPath.split('/');
        parts.pop();
        const newPath = parts.join('/') || '/';
        this.loadInstanceFiles(instanceId, newPath);
    },





    async deleteInstanceFile(instanceId, path) {
        if (!confirm('Delete this?')) return;
        try {
            await axios.delete(`${API_BASE}/instance/${instanceId}/files?path=${encodeURIComponent(path)}`);
            const currentPath = this.state.instanceFiles[instanceId]?.path || '/home/openclaw';
            this.loadInstanceFiles(instanceId, currentPath);
        } catch (err) { alert(`Delete failed: ${err.message}`); }
    },

    async extendInstancePrompt(instanceId) {
        const modal = document.getElementById('extension-modal');
        const input = document.getElementById('extend-instance-id');
        const select = document.getElementById('extend-duration-select');
        if (!modal || !input || !select) return;
        
        input.value = instanceId;
        
        // Find the instance to get its machineType
        try {
            const res = await axios.get(`${API_BASE}/instance`);
            const instances = res.data.instances || [];
            const instance = instances.find(i => i._id === instanceId);
            
            const machineType = instance ? (instance.machineType || 'e2-small') : 'e2-small';
            const multipliers = {
                'e2-small': 1, 'e2-medium': 2, 'e2-standard-2': 4,
                'e2-standard-4': 8, 'e2-standard-8': 16, 'n2-standard-4': 12
            };
            const costMultiplier = multipliers[machineType] || 1;
            
            select.innerHTML = `
                <option value="30">1 Month (${30 * costMultiplier} Credits)</option>
                <option value="90">3 Months (${90 * costMultiplier} Credits)</option>
                <option value="360">12 Months (${360 * costMultiplier} Credits)</option>
            `;
        } catch (e) {
            console.error('Failed to fetch instance details for extension modal', e);
        }

        modal.classList.add('active');
    },

    async submitExtension() {
        const instanceId = document.getElementById('extend-instance-id')?.value;
        const duration = parseInt(document.getElementById('extend-duration-select')?.value || 30);
        
        if (!instanceId) return;

        try {
            const btn = document.querySelector('#extension-modal .btn-primary');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Processing...';
            btn.disabled = true;

            const res = await axios.post(`${API_BASE}/instance/${instanceId}/extend`, { durationDays: duration });
            alert(res.data.message);
            document.getElementById('extension-modal').classList.remove('active');
            this.loadUserDashboard();
        } catch (e) {
            alert('Extension failed: ' + (e.response?.data?.detail || e.message));
        } finally {
            const btn = document.querySelector('#extension-modal .btn-primary');
            if (btn) {
                btn.innerHTML = 'Confirm Extension';
                btn.disabled = false;
            }
        }
    },

    async loadUserBilling() {
        try {
            const res = await axios.get(`${API_BASE}/auth/me`);
            const credits = res.data.user.credits || 0;
            const display = document.getElementById('user-credits-display');
            if (display) display.innerText = credits;
        } catch (e) {
            console.error('Failed to load user credits', e);
        }
    },

    async checkout(packageId) {
        try {
            const res = await axios.post(`${API_BASE}/billing/checkout`, { package_id: packageId });
            if (res.data.url) {
                window.location.href = res.data.url;
            }
        } catch (e) {
            alert('Checkout failed: ' + (e.response?.data?.detail || e.message));
        }
    },

    async startMachine(instanceId) {
        if (!confirm('Are you sure you want to start this instance?')) return;
        try {
            await axios.post(`${API_BASE}/instance/${instanceId}/start`);
            this.showSection('user-dashboard');
        } catch (e) {
            alert('Failed to start instance: ' + (e.response?.data?.detail || e.message));
        }
    },

    async stopMachine(instanceId) {
        if (!confirm('Are you sure you want to stop this instance?')) return;
        try {
            await axios.post(`${API_BASE}/instance/${instanceId}/stop`);
            this.showSection('user-dashboard');
        } catch (e) {
            alert('Failed to stop instance: ' + (e.response?.data?.detail || e.message));
        }
    },

    async destroyMachine(instanceId) {
        if (!confirm('DANGER: Are you absolutely sure you want to destroy this instance? All data will be permanently lost!')) return;
        try {
            await axios.post(`${API_BASE}/instance/${instanceId}/destroy`);
            alert('Instance is being destroyed.');
            this.showSection('user-dashboard');
        } catch (e) {
            alert('Failed to destroy instance: ' + (e.response?.data?.detail || e.message));
        }
    },

    async handleMessagingAction(instanceId, channel) {
        const tokenInput = prompt(`Enter your ${channel} Bot Token:`);
        if (!tokenInput) return;
        try {
            const res = await axios.post(`${API_BASE}/instance/${instanceId}/channel`, { channel: channel.toLowerCase(), token: tokenInput });
            alert(res.data.message);
            this.showSection('user-dashboard');
        } catch (e) {
            alert(`Failed to configure ${channel}: ` + (e.response?.data?.detail || e.message));
        }
    },

    async loadUserWizard() {
        this.nextWizard(1);
        try {
            const res = await axios.get(`${API_BASE}/auth/me`);
            const credits = res.data.user.credits || 0;
            const display = document.getElementById('wizard-available-credits');
            if (display) display.innerText = `${credits} Credits`;
        } catch (e) {
            console.error(e);
        }
    },

    async nextWizard(step) {
        if (step === 2) {
            const selectedProviderTab = document.querySelector('.provider-tab.selected');
            const provider = selectedProviderTab ? selectedProviderTab.dataset.provider : 'gemini';
            const apiKey = document.getElementById('user-wizard-apikey')?.value;
            const password = document.getElementById('user-wizard-password')?.value;
            
            if (!apiKey || apiKey.trim() === '') return alert('API Key is required.');
            if (!password || password.trim() === '') return alert('Dashboard password is required.');
            
            try {
                const btn = document.querySelector('#btn-next-step1');
                if (btn) { btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Verifying...'; btn.disabled = true; }
                await axios.post(`${API_BASE}/instance/verify-key`, { provider, apiKey });
                if (btn) { btn.innerHTML = 'Continue <i class="ri-arrow-right-s-line"></i>'; btn.disabled = false; }
            } catch (e) {
                const btn = document.querySelector('#btn-next-step1');
                if (btn) { btn.innerHTML = 'Continue <i class="ri-arrow-right-s-line"></i>'; btn.disabled = false; }
                return alert('Invalid API Key: ' + (e.response?.data?.detail || e.message));
            }
        }
        
        document.getElementById('wizard-step-1').style.display = 'none';
        document.getElementById('wizard-step-2').style.display = 'none';
        document.getElementById('wizard-step-loading').style.display = 'none';
        
        document.querySelectorAll('.wizard-steps .step').forEach(el => {
            el.classList.remove('active');
            if (parseInt(el.dataset.step) <= step) el.classList.add('active');
        });
        
        if (step === 1) document.getElementById('wizard-step-1').style.display = 'block';
        if (step === 2) {
            document.getElementById('wizard-step-2').style.display = 'block';
            this.updateWizardCost();
        }
        if (step === 3) document.getElementById('wizard-step-loading').style.display = 'block';
    },

    updateWizardCost() {
        const multipliers = {
            'e2-small': 1,
            'e2-medium': 2,
            'e2-standard-2': 4,
            'e2-standard-4': 8,
            'e2-standard-8': 16,
            'n2-standard-4': 12
        };
        const machineSelect = document.getElementById('user-wizard-machine');
        const iterationSelect = document.getElementById('user-wizard-iteration');
        const durationSelect = document.getElementById('user-wizard-duration');
        const totalCostDisplay = document.getElementById('wizard-total-cost');
        const warningDisplay = document.getElementById('iteration-warning');
        
        if (!machineSelect || !iterationSelect || !durationSelect) return;
        
        const machineType = machineSelect.value;
        const iteration = iterationSelect.value;
        const duration = parseInt(durationSelect.value);
        const costMultiplier = multipliers[machineType] || 1;
        
        const isInvalid = (iteration === 'nemoclaw' && costMultiplier < 4);
        
        if (warningDisplay) {
            warningDisplay.style.display = isInvalid ? 'block' : 'none';
        }
        
        const total = duration * costMultiplier;
        if (totalCostDisplay) {
            totalCostDisplay.innerText = `${total} Credits`;
            if (isInvalid) {
                totalCostDisplay.style.color = 'var(--danger)';
            } else {
                totalCostDisplay.style.color = '#fff';
            }
        }
    },

    selectProvider(tabElement) {
        document.querySelectorAll('.provider-tab').forEach(tab => {
            tab.classList.remove('selected');
            tab.style.border = '1px solid rgba(255,255,255,0.1)';
            tab.style.background = 'rgba(255,255,255,0.02)';
            tab.style.opacity = '0.7';
        });
        tabElement.classList.add('selected');
        tabElement.style.border = '1px solid var(--primary)';
        tabElement.style.background = 'rgba(16,185,129,0.05)';
        tabElement.style.opacity = '1';
        this.updateWizardModels(tabElement.dataset.provider);
    },

    updateWizardModels(provider) {
        const modelSelect = document.getElementById('user-wizard-model');
        if (!modelSelect) return;
        modelSelect.innerHTML = '';
        const models = {
            'gemini': ['gemini-3.1-pro-preview', 'gemini-3.1-flash-lite-preview', 'gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'],
            'openai': ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.4-pro-2026-03-05'],
            'anthropic': ['claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-opus-4-6']
        };
        (models[provider] || []).forEach(m => {
            modelSelect.innerHTML += `<option value="${m}">${m}</option>`;
        });
    },

    async submitProvision() {
        const provider = document.querySelector('.provider-tab.selected')?.dataset.provider || 'gemini';
        const model = document.getElementById('user-wizard-model')?.value || 'gemini-3.1-pro-preview';
        const apiKey = document.getElementById('user-wizard-apikey')?.value;
        const alias = document.getElementById('user-wizard-alias')?.value || 'My Agent';
        const password = document.getElementById('user-wizard-password')?.value;
        const duration = parseInt(document.getElementById('user-wizard-duration').value);
        const machineType = document.getElementById('user-wizard-machine')?.value || 'e2-small';
        const iteration = document.getElementById('user-wizard-iteration')?.value || 'openclaw';

        const multipliers = {
            'e2-small': 1, 'e2-medium': 2, 'e2-standard-2': 4,
            'e2-standard-4': 8, 'e2-standard-8': 16, 'n2-standard-4': 12
        };
        const costMultiplier = multipliers[machineType] || 1;
        if (iteration === 'nemoclaw' && costMultiplier < 4) {
            return alert('NemoClaw requires at least E2 Standard 2. Please change your selection.');
        }

        this.nextWizard(3);
        try {
            await axios.post(`${API_BASE}/instance/provision`, { 
                provider, model, apiKey, password, alias, 
                durationDays: duration, machineType, iteration 
            });
            this.showSection('user-dashboard');
        } catch (e) {
            alert('Provisioning failed: ' + (e.response?.data?.detail || e.message));
            this.nextWizard(2);
        }
    }
,
    // --- Sidebar Resizer Logic ---
    initSidebarResizer() {
        const resizer = document.getElementById('ide-sidebar-resizer');
        const sidebar = document.getElementById('ide-sidebar');
        if (!resizer || !sidebar) return;

        let isResizing = false;

        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            resizer.classList.add('is-resizing');
            document.body.style.cursor = 'col-resize';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            let newWidth = e.clientX - 50; 
            if (newWidth < 150) newWidth = 150;
            if (newWidth > 600) newWidth = 600;
            sidebar.style.setProperty('--sidebar-width', `${newWidth}px`);
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                resizer.classList.remove('is-resizing');
                document.body.style.cursor = '';
            }
        });
    }
};

// Global Google Auth handler
window.handleCredentialResponse = (response) => {
    app.handleGoogleLogin(response);
};

// Start app
document.addEventListener('DOMContentLoaded', () => {
    app.init();
});

// Re-add the IDE functions that were overwritten

app.openIde = function(instanceId, instanceAlias) {
    // Open the IDE in a new tab
    const url = `/ide/${instanceId}?alias=${encodeURIComponent(instanceAlias || 'Agent')}`;
    window.open(url, '_blank');
};

app.closeIde = function() {
    if (this.state.chatWs) {
        this.state.chatWs.close();
        this.state.chatWs = null;
    }
    document.getElementById('user-ide').style.display = 'none';
    document.getElementById('user-dashboard').classList.add('active-section');
};

app.toggleIdeSidebar = function(tool) {
    const sidebar = document.getElementById('ide-sidebar');
    const resizer = document.getElementById('ide-sidebar-resizer');
    
    // Handle active buttons
    document.querySelectorAll('.activity-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.querySelector(`.activity-btn[data-tool="${tool}"]`);
    if (activeBtn) activeBtn.classList.add('active');

    if (tool === 'chat') {
        sidebar.style.display = 'none';
        if (resizer) resizer.style.display = 'none';
        return;
    }

    sidebar.style.display = 'flex';
    if (resizer) resizer.style.display = 'block';
    document.querySelectorAll('.tool-content').forEach(tc => tc.style.display = 'none');
    document.getElementById(`tool-content-${tool}`).style.display = 'block';

    if (tool === 'files') {
        this.loadIdeFiles(this.state.activeInstanceId, '/root/.openclaw');
    }
};

app.loadIdeFiles = async function(instanceId, path = '/root/.openclaw') {
    const container = document.getElementById('ide-file-tree');
    container.innerHTML = '<div class="spinner" style="margin:2rem auto"></div>';
    
    try {
        const res = await axios.get(`${API_BASE}/instance/${instanceId}/files?path=${encodeURIComponent(path)}`);
        const data = res.data;
        
        let html = `<div class="path-nav">
            <button class="btn btn-sm btn-outline" onclick="app.loadIdeFiles('${instanceId}', '${data.parentPath}')" ${!data.parentPath ? 'disabled' : ''}><i class="ri-arrow-up-line"></i> Up</button>
            <div class="current-path">${data.path}</div>
            <div style="flex-grow:1"></div>
            <button class="btn btn-sm btn-outline" onclick="document.getElementById('ide-upload-input').click()"><i class="ri-upload-2-line"></i></button>
            <input type="file" id="ide-upload-input" style="display:none" onchange="app.handleIdeFileUpload('${instanceId}', '${data.path}', event)">
        </div>
        <div style="padding: 1rem;">`;
        
        if (data.files && data.files.length > 0) {
            data.files.forEach(f => {
                const icon = f.is_dir ? 'ri-folder-fill text-secondary' : 'ri-file-text-line text-muted';
                html += `
                    <div class="file-row" style="display:flex; justify-content:space-between; align-items:center; padding: 0.5rem; border-bottom: 1px solid rgba(255,255,255,0.05);">
                        <div style="display:flex; align-items:center; gap:0.75rem;" onclick="${f.is_dir ? `app.loadIdeFiles('${instanceId}', '${data.path}/${f.name}')` : ''}">
                            <i class="${icon}"></i>
                            <span>${f.name}</span>
                        </div>
                        ${!f.is_dir ? `
                        <div class="file-actions-row">
                            <button class="btn btn-sm" onclick="app.downloadIdeFile('${instanceId}', '${data.path}/${f.name}')"><i class="ri-download-2-line"></i></button>
                            <button class="btn btn-sm" style="color:var(--danger)" onclick="app.deleteIdeFile('${instanceId}', '${data.path}/${f.name}', '${data.path}')"><i class="ri-delete-bin-line"></i></button>
                        </div>
                        ` : ''}
                    </div>
                `;
            });
        } else {
            html += `<p class="text-muted text-center" style="margin-top:1rem;">Folder is empty</p>`;
        }
        html += `</div>`;
        container.innerHTML = html;
    } catch (e) {
        container.innerHTML = `<p class="text-danger text-center" style="margin-top:2rem;">Failed to load files: ${e.response?.data?.detail || e.message}</p>`;
    }
};

app.handleIdeFileUpload = async function(instanceId, path, event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        await axios.post(`${API_BASE}/instance/${instanceId}/files/upload?path=${encodeURIComponent(path)}`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
        });
        this.loadIdeFiles(instanceId, path);
    } catch (e) {
        alert(`Upload failed: ${e.response?.data?.detail || e.message}`);
    }
};

app.downloadIdeFile = async function(instanceId, path) {
    try {
        const res = await axios.get(`${API_BASE}/instance/${instanceId}/files/download?path=${encodeURIComponent(path)}`, { responseType: 'blob' });
        const url = window.URL.createObjectURL(new Blob([res.data]));
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', path.split('/').pop());
        document.body.appendChild(link);
        link.click();
        link.remove();
    } catch (e) {
        alert("Download failed");
    }
};

app.deleteIdeFile = async function(instanceId, path, parentPath) {
    if (!confirm(`Delete ${path}?`)) return;
    try {
        await axios.delete(`${API_BASE}/instance/${instanceId}/files?path=${encodeURIComponent(path)}`);
        this.loadIdeFiles(instanceId, parentPath);
    } catch (e) {
        alert(`Delete failed: ${e.response?.data?.detail || e.message}`);
    }
};

app.connectChatWebSocket = function(instanceId) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}${API_BASE}/ws/chat/${instanceId}?token=${this.state.token}`;
    
    this.state.chatWs = new WebSocket(wsUrl);
    this.state.currentAgentMessageDiv = null;
    
    this.state.chatWs.onopen = () => {
        console.log("Chat WS Connected");
    };
    
    this.state.chatWs.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'message') {
            if (this.state.typingIndicatorDiv) {
                this.state.typingIndicatorDiv.remove();
                this.state.typingIndicatorDiv = null;
            }
            if (data.isReplace) {
                if (!this.state.currentAgentMessageDiv) {
                    this.state.currentAgentMessageDiv = this.createChatMessageDiv('agent');
                    this.state.currentAgentRawText = "";
                }
                this.state.currentAgentRawText = data.text;
                const wrapper = this.state.currentAgentMessageDiv.querySelector('.message-content-wrapper');
                if (wrapper) wrapper.innerHTML = this.formatAgentText(this.state.currentAgentRawText);
                const container = document.getElementById('ide-chat-history');
                container.scrollTop = container.scrollHeight;
            } else if (data.isChunk) {
                if (!this.state.currentAgentMessageDiv) {
                    this.state.currentAgentMessageDiv = this.createChatMessageDiv('agent');
                    this.state.currentAgentRawText = "";
                }
                // Append chunk to the current raw text buffer
                this.state.currentAgentRawText += data.text;
                const wrapper = this.state.currentAgentMessageDiv.querySelector('.message-content-wrapper');
                if (wrapper) wrapper.innerHTML = this.formatAgentText(this.state.currentAgentRawText);
                const container = document.getElementById('ide-chat-history');
                container.scrollTop = container.scrollHeight;
            } else if (data.isComplete) {
                // Finalize current bubble
                this.state.currentAgentMessageDiv = null;
            } else {
                // Regular full message
                this.appendChatMessage(data.text, 'agent');
            }
        } else if (data.type === 'update_tool') {
            const contentDiv = document.getElementById(`content-${data.itemId}`);
            if (contentDiv) contentDiv.innerHTML = data.content;
        } else if (data.type === 'update_tool_append') {
            const contentDiv = document.getElementById(`content-${data.itemId}`);
            if (contentDiv) contentDiv.innerHTML += data.content;
        } else if (data.type === 'error') {
            if (this.state.typingIndicatorDiv) {
                this.state.typingIndicatorDiv.remove();
                this.state.typingIndicatorDiv = null;
            }
            this.appendChatMessage(`Error: ${data.text}`, 'agent');
            this.state.currentAgentMessageDiv = null;
        }
    };
    
    this.state.chatWs.onclose = () => {
        console.log("Chat WS Closed");
        if (this.state.typingIndicatorDiv) {
            this.state.typingIndicatorDiv.remove();
            this.state.typingIndicatorDiv = null;
        }
        this.appendChatMessage("Connection lost. Trying to reconnect...", "agent");
        this.state.currentAgentMessageDiv = null;
    };
};

app.sendChatMessage = function() {
    const input = document.getElementById('ide-chat-input');
    const text = input.value.trim();
    if (!text) return;
    
    if (!this.state.chatWs || this.state.chatWs.readyState !== WebSocket.OPEN) {
        alert("Chat connection is not open");
        return;
    }
    
    this.appendChatMessage(text, 'user');
    this.state.currentAgentMessageDiv = null; // Ensure new response starts a new bubble
    
    // Add typing indicator
    this.state.typingIndicatorDiv = document.createElement('div');
    this.state.typingIndicatorDiv.className = 'typing-indicator';
    this.state.typingIndicatorDiv.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';
    const container = document.getElementById('ide-chat-history');
    container.appendChild(this.state.typingIndicatorDiv);
    container.scrollTop = container.scrollHeight;
    
    this.state.chatWs.send(JSON.stringify({ text: text }));
    input.value = '';
};

app.createChatMessageDiv = function(sender) {
    const container = document.getElementById('ide-chat-history');
    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-message ${sender}`;
    msgDiv.classList.add('parsed-markdown');
    
    const wrapper = document.createElement('div');
    wrapper.className = 'message-content-wrapper';
    msgDiv.appendChild(wrapper);
    
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
    return msgDiv;
};

app.formatAgentText = function(text) {
    if (!text) return "";
    let formatted = text.replace(/<think\s*>/g, '<details class="thought-process" open><summary><i class="ri-brain-line"></i> Thinking Process</summary><div class="thought-content">');
    formatted = formatted.replace(/<\/think\s*>/g, '</div></details>');
    formatted = formatted.replace(/<final\s*>/g, '');
    formatted = formatted.replace(/<\/final\s*>/g, '');
    // Convert newlines to breaks
    formatted = formatted.replace(/\n/g, '<br/>');
    return formatted;
};

app.appendChatMessage = function(text, sender) {
    const msgDiv = this.createChatMessageDiv(sender);
    const wrapper = msgDiv.querySelector('.message-content-wrapper');
    if (wrapper) {
        wrapper.innerHTML = this.formatAgentText(text);
    } else {
        msgDiv.innerHTML = this.formatAgentText(text);
    }
};

