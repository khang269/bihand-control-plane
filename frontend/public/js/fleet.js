/**
 * Bihand Fleet Management Logic
 */

app.fleet = {
    agents: [],
    
    addAgent() {
        const container = document.getElementById('custom-agents-container');
        const index = this.agents.length;
        
        const agentDiv = document.createElement('div');
        agentDiv.className = 'border border-border rounded-lg p-5 bg-[#09090b] relative agent-config';
        
        agentDiv.innerHTML = `
            <button type="button" class="absolute right-3 top-3 text-muted hover:text-destructive transition-colors" onclick="app.fleet.removeAgent(${index}, this)">
                <i class="ri-delete-bin-line"></i>
            </button>
            <h4 class="text-sm font-semibold mb-4">Agent ${index + 1}</h4>
            <div class="grid grid-cols-2 gap-4">
                <div>
                    <label class="block text-xs font-medium text-muted mb-1.5">Role</label>
                    <input type="text" class="input-field agent-role" value="Developer" placeholder="e.g. CEO, CTO, Developer">
                </div>
                <div>
                    <label class="block text-xs font-medium text-muted mb-1.5">Type</label>
                    <select class="input-field agent-type" style="background-color: #09090b;">
                        <option value="openclaw">OpenClaw (Gateway)</option>
                        <option value="opencode">OpenCode CLI</option>
                        <option value="claudecode">Claude Code CLI</option>
                    </select>
                </div>
                <div>
                    <label class="block text-xs font-medium text-muted mb-1.5">Provider</label>
                    <select class="input-field agent-provider" style="background-color: #09090b;">
                        <option value="openai">OpenAI</option>
                        <option value="anthropic">Anthropic</option>
                        <option value="gemini">Google Gemini</option>
                        <option value="openrouter">OpenRouter</option>
                    </select>
                </div>
                <div>
                    <label class="block text-xs font-medium text-muted mb-1.5">Model</label>
                    <input type="text" class="input-field agent-model" placeholder="gpt-4o, claude-3-5-sonnet, etc.">
                </div>
            </div>
            <div class="mt-4">
                <label class="block text-xs font-medium text-muted mb-1.5">API Key</label>
                <input type="password" class="input-field agent-apikey" placeholder="sk-...">
            </div>
        `;
        
        container.appendChild(agentDiv);
        this.agents.push({ id: index });
        this.updatePrice();
    },
    
    removeAgent(index, btn) {
        const div = btn.closest('.agent-config');
        div.remove();
        this.agents = this.agents.filter(a => a.id !== index);
        this.updatePrice();
    },
    
    selectPlan(plan) {
        document.querySelectorAll('.plan-card').forEach(c => {
            c.classList.remove('border-foreground');
            c.classList.add('border-muted/20');
            c.classList.remove('selected');
        });
        const selected = document.querySelector(`.plan-card[data-plan="${plan}"]`);
        selected.classList.add('border-foreground');
        selected.classList.remove('border-muted/20');
        selected.classList.add('selected');
        
        const customSec = document.getElementById('custom-fleet-section');
        const predefinedSec = document.getElementById('predefined-fleet-section');
        
        if (plan === 'custom') {
            customSec.style.display = 'block';
            predefinedSec.style.display = 'none';
            if (this.agents.length === 0) this.addAgent();
        } else {
            customSec.style.display = 'none';
            predefinedSec.style.display = 'block';
            
            let html = '';
            if (plan === 'starter') {
                html = this.getPredefinedAgentHTML('CEO', 'openclaw');
            } else if (plan === 'medium') {
                html = this.getPredefinedAgentHTML('CEO', 'openclaw') + this.getPredefinedAgentHTML('CTO', 'opencode');
            }
            predefinedSec.innerHTML = html;
        }
        
        this.updatePrice();
    },
    
    getPredefinedAgentHTML(role, type) {
        return `
        <div class="border border-border rounded-lg p-5 bg-[#09090b]">
            <h4 class="text-sm font-semibold flex items-center gap-2 mb-4">
                ${role} <span class="px-2 py-0.5 rounded-full border border-border text-[10px] text-muted">${type}</span>
            </h4>
            <div class="grid grid-cols-2 gap-4">
                <div>
                    <label class="block text-xs font-medium text-muted mb-1.5">Provider</label>
                    <select class="input-field predefined-provider" data-role="${role}" data-type="${type}" style="background-color: #09090b;">
                        <option value="openai">OpenAI</option>
                        <option value="anthropic">Anthropic</option>
                        <option value="gemini">Google Gemini</option>
                        <option value="openrouter">OpenRouter</option>
                    </select>
                </div>
                <div>
                    <label class="block text-xs font-medium text-muted mb-1.5">Model</label>
                    <input type="text" class="input-field predefined-model" placeholder="Model string (optional)">
                </div>
            </div>
            <div class="mt-4">
                <label class="block text-xs font-medium text-muted mb-1.5">API Key</label>
                <input type="password" class="input-field predefined-apikey" placeholder="sk-...">
            </div>
        </div>
        `;
    },
    
    updatePrice() {
        const planEl = document.querySelector('.plan-card.selected');
        if (!planEl) return;
        const plan = planEl.dataset.plan;
        let price = 0;
        if (plan === 'starter') price = 50;
        else if (plan === 'medium') price = 100;
        else if (plan === 'custom') {
            const count = document.querySelectorAll('#custom-agents-container .agent-config').length;
            price = count * 50;
        }
        document.getElementById('fleet-price-display').innerText = `$${price}/mo`;
    },
    
    async deploy() {
        const name = document.getElementById('fleet-name').value;
        const password = document.getElementById('fleet-password').value;
        const plan = document.querySelector('.plan-card.selected').dataset.plan;
        
        if (!name || !password) {
            alert("Name and password are required.");
            return;
        }
        
        let agentsPayload = [];
        
        if (plan === 'custom') {
            document.querySelectorAll('#custom-agents-container .agent-config').forEach(div => {
                agentsPayload.push({
                    role: div.querySelector('.agent-role').value,
                    agentType: div.querySelector('.agent-type').value,
                    provider: div.querySelector('.agent-provider').value,
                    model: div.querySelector('.agent-model').value || undefined,
                    apiKey: div.querySelector('.agent-apikey').value
                });
            });
        } else {
            document.querySelectorAll('#predefined-fleet-section > div').forEach(div => {
                const sel = div.querySelector('.predefined-provider');
                agentsPayload.push({
                    role: sel.dataset.role,
                    agentType: sel.dataset.type,
                    provider: sel.value,
                    model: div.querySelector('.predefined-model').value || undefined,
                    apiKey: div.querySelector('.predefined-apikey').value
                });
            });
        }
        
        const btn = document.getElementById('btn-deploy-fleet');
        const origText = btn.innerHTML;
        btn.innerHTML = '<i class="ri-loader-4-line spin"></i> Provisioning...';
        btn.disabled = true;
        
        try {
            const res = await fetch('/api/fleets', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${app.state.token}`
                },
                body: JSON.stringify({
                    name,
                    plan,
                    password,
                    agents: agentsPayload
                })
            });
            
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || data.message || "Failed to provision fleet");
            
            app.loadFleets();
            
        } catch (e) {
            alert(e.message);
        } finally {
            btn.innerHTML = origText;
            btn.disabled = false;
        }
    }
};
