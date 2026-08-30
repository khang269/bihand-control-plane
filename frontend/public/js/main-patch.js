// Read the existing main.js and inject fleet loading logic
const fs = require('fs');

let mainJs = fs.readFileSync('frontend/js/main.js', 'utf8');

// Inject app.loadFleets and modify render
const loadFleetsLogic = `
    async loadFleets() {
        try {
            const res = await fetch('/api/fleets', {
                headers: { 'Authorization': 'Bearer ' + this.state.token }
            });
            if (!res.ok) throw new Error("Failed to load fleets");
            const fleets = await res.json();
            this.renderFleets(fleets);
        } catch (e) {
            console.error(e);
            document.getElementById('instances-list-container').innerHTML = \`<div class="glass-panel" style="padding: 2rem; text-align: center;">Failed to load companies. \${e.message}</div>\`;
        }
    },

    renderFleets(fleets) {
        const container = document.getElementById('instances-list-container');
        if (fleets.length === 0) {
            container.innerHTML = \`
                <div class="glass-panel" style="padding: 4rem 2rem; text-align: center;">
                    <i class="ri-building-4-line" style="font-size: 3rem; color: var(--text-muted); opacity: 0.5;"></i>
                    <h3 style="margin-top: 1rem; color: var(--text-main);">No Companies Found</h3>
                    <p style="color: var(--text-muted); margin-bottom: 2rem;">You haven't incorporated any AI companies yet.</p>
                    <button class="btn btn-primary" onclick="app.navigate('user-wizard')">Incorporate Now</button>
                </div>
            \`;
            return;
        }

        let html = '';
        for (const f of fleets) {
            let statusColor = f.status === 'running' ? '#10b981' : (f.status === 'provisioned' ? '#10b981' : (f.status === 'error' ? '#ef4444' : '#f59e0b'));
            
            html += \`
            <div class="glass-panel" style="margin-bottom: 1.5rem;">
                <div style="padding: 1.5rem; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.05);">
                    <div>
                        <h3 style="font-size: 1.25rem; display: flex; align-items: center; gap: 0.5rem;">
                            <i class="ri-building-4-fill text-primary"></i> \${f.name}
                        </h3>
                        <p style="color: var(--text-muted); font-size: 0.85rem; margin-top: 0.25rem;">
                            Plan: <span style="text-transform: capitalize; color: #fff;">\${f.plan}</span> | Cost: $\${f.totalPrice}/mo
                        </p>
                    </div>
                    <div style="text-align: right;">
                        <span class="badge" style="background: rgba(255,255,255,0.05); color: \${statusColor}; border: 1px solid \${statusColor};">\${f.status.toUpperCase()}</span>
                        <div style="margin-top: 0.5rem;">
                            <a href="\${f.dashboardUrl}" target="_blank" class="btn btn-outline" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;">
                                <i class="ri-external-link-line"></i> Bihand HQ
                            </a>
                            <button class="btn btn-primary" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;" onclick="app.viewFleetDetails('\${f.id}')">
                                <i class="ri-team-line"></i> Workers
                            </button>
                        </div>
                    </div>
                </div>
                <div id="fleet-details-\${f.id}" style="display: none; padding: 1.5rem; background: rgba(0,0,0,0.2);">
                    <div class="spinner"></div>
                </div>
            </div>
            \`;
        }
        container.innerHTML = html;
    },

    async viewFleetDetails(fleetId) {
        const detailsDiv = document.getElementById(\`fleet-details-\${fleetId}\`);
        if (detailsDiv.style.display === 'block') {
            detailsDiv.style.display = 'none';
            return;
        }
        
        detailsDiv.style.display = 'block';
        
        try {
            const res = await fetch(\`/api/fleets/\${fleetId}\`, {
                headers: { 'Authorization': 'Bearer ' + this.state.token }
            });
            const data = await res.json();
            
            let workersHtml = '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">';
            for (const inst of data.instances) {
                let statCol = inst.status === 'running' ? '#10b981' : '#f59e0b';
                workersHtml += \`
                    <div style="border: 1px solid rgba(255,255,255,0.1); padding: 1rem; border-radius: 8px; background: rgba(255,255,255,0.02);">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                            <strong style="color: var(--primary);">\${inst.role}</strong>
                            <span style="color: \${statCol}; font-size: 0.75rem;">\${inst.status}</span>
                        </div>
                        <div style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.5rem;">\${inst.agentType.toUpperCase()}</div>
                        <div style="font-size: 0.85rem;">
                            \${inst.ip ? \`<a href="http://\${inst.ip}/screen/vnc.html" target="_blank" style="color: #60a5fa;"><i class="ri-tv-2-line"></i> Live Screen</a>\` : 'No IP yet'}
                        </div>
                    </div>
                \`;
            }
            workersHtml += '</div>';
            detailsDiv.innerHTML = workersHtml;
        } catch (e) {
            detailsDiv.innerHTML = \`<span class="text-danger">Error loading workers: \${e.message}</span>\`;
        }
    },
`;

// Insert the new logic before loadInstances
mainJs = mainJs.replace('async loadInstances() {', loadFleetsLogic + '\n    async loadInstances() {');

// Modify initial auth check to load fleets
mainJs = mainJs.replace('this.loadInstances();', 'this.loadFleets();');
mainJs = mainJs.replace('this.loadInstances();', 'this.loadFleets();'); // Incase there are two

// Change navigate logic for dashboard
mainJs = mainJs.replace("if (target === 'user-dashboard') this.loadInstances();", "if (target === 'user-dashboard') this.loadFleets();");

fs.writeFileSync('frontend/js/main.js', mainJs);
