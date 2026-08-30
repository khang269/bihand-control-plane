const app = {
    state: {
        instanceId: null,
        token: null,
        chatHistory: [],
        isGenerating: false,
        abortController: null,
        toolDivs: {},
    }
};

app.init = function() {
    this.extractParams();
    this.setupEventListeners();
    this.appendChatMessage("Hello! I am your Hermes Agent. How can I help you today?", "agent");
};

app.extractParams = function() {
    const pathParts = window.location.pathname.split('/');
    this.state.instanceId = pathParts[pathParts.length - 1];
    
    const urlParams = new URLSearchParams(window.location.search);
    this.state.token = urlParams.get('token');
};

app.setupEventListeners = function() {
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');
    
    sendBtn.addEventListener('click', () => this.sendMessage());
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this.sendMessage();
        }
    });
};

app.sendMessage = async function() {
    if (this.state.isGenerating) return;
    
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;
    
    input.value = '';
    
    // Add user message
    this.appendChatMessage(text, 'user');
    this.state.chatHistory.push({ role: 'user', content: text });
    
    this.state.isGenerating = true;
    this.updateStatus("Generating...", "bg-blue-500");
    
    this.state.abortController = new AbortController();
    
    // Create an empty agent bubble to stream into
    const agentMsgDiv = this.appendChatMessage("", 'agent');
    const contentWrapper = agentMsgDiv.querySelector('.message-content-wrapper') || agentMsgDiv;
    
    try {
        const response = await fetch(`/api/proxy/hermes/${this.state.instanceId}/v1/runs?token=${this.state.token}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                messages: this.state.chatHistory,
                stream: true
            }),
            signal: this.state.abortController.signal
        });
        
        if (!response.ok) throw new Error("Failed to start run");
        
        const data = await response.json();
        const runId = data.run_id;
        
        // Now stream events
        const eventSource = new EventSource(`/api/proxy/hermes/${this.state.instanceId}/v1/runs/${runId}/events?token=${this.state.token}`);
        
        let fullText = "";
        
        eventSource.onmessage = (event) => {
            if (event.data === "[DONE]") {
                eventSource.close();
                this.state.isGenerating = false;
                this.updateStatus("Ready", "bg-green-500");
                this.state.chatHistory.push({ role: 'assistant', content: fullText });
                return;
            }
            
            try {
                const parsed = JSON.parse(event.data);
                
                if (parsed.event === "run.text") {
                    fullText += parsed.text;
                    contentWrapper.innerHTML = marked.parse(fullText);
                } else if (parsed.event === "tool.started") {
                    this.state.toolDivs[parsed.tool] = this.appendChatMessage(
                        `<details class="thought-process" open style="border-color: #3b82f6; margin-bottom: 0.5rem;"><summary style="color: #60a5fa;"><i class="ri-tools-line"></i> Tool Call: ${parsed.tool}</summary><div class="thought-content"><pre style="margin:0; white-space:pre-wrap; font-size: 0.85em;">Running...</pre></div></details>`, 
                        'agent', null, null, true
                    );
                } else if (parsed.event === "tool.completed") {
                    const toolDiv = this.state.toolDivs[parsed.tool];
                    if (toolDiv) {
                        const wrapper = toolDiv.querySelector('.message-content-wrapper') || toolDiv;
                        wrapper.innerHTML = `<details class="thought-process" style="border-color: #10b981; margin-bottom: 0.5rem;"><summary style="color: #34d399;"><i class="ri-check-line"></i> Tool Output: ${parsed.tool}</summary><div class="thought-content"><pre style="margin:0; white-space:pre-wrap; font-size: 0.85em;">Completed in ${parsed.duration}s</pre></div></details>`;
                    }
                }
                
                const container = document.getElementById('ide-chat-history');
                container.scrollTop = container.scrollHeight;
                
            } catch(e) {
                console.error("Parse error", e);
            }
        };
        
        eventSource.onerror = (err) => {
            console.error("SSE Error", err);
            eventSource.close();
            this.state.isGenerating = false;
            this.updateStatus("Error", "bg-red-500");
        };
        
    } catch (e) {
        if (e.name !== 'AbortError') {
            console.error(e);
            this.state.isGenerating = false;
            this.updateStatus("Error", "bg-red-500");
            contentWrapper.innerHTML = `<span class="text-red-500">Error: ${e.message}</span>`;
        }
    }
};

app.appendChatMessage = function(text, sender, msgId = null, timestamp = null, isRawHtml = false) {
    const template = document.getElementById('chat-message-template');
    const msgDiv = template.content.cloneNode(true).querySelector('.chat-message');
    
    if (sender === 'user') {
        msgDiv.classList.add('user-message');
        msgDiv.classList.remove('agent-message');
        const icon = msgDiv.querySelector('.ri-robot-2-line');
        if (icon) icon.className = 'ri-user-line';
    } else {
        msgDiv.classList.add('agent-message');
        msgDiv.classList.remove('user-message');
    }
    
    const wrapper = msgDiv.querySelector('.message-content-wrapper');
    const contentHtml = isRawHtml ? text : marked.parse(text || "");
    
    if (wrapper) {
        wrapper.innerHTML = contentHtml;
    } else {
        msgDiv.innerHTML = contentHtml;
    }
    
    const container = document.getElementById('ide-chat-history');
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
    
    return msgDiv;
};

app.updateStatus = function(text, colorClass) {
    const statusDot = document.getElementById('connection-status-dot');
    const statusText = document.getElementById('connection-status-text');
    
    if (statusDot) {
        statusDot.className = `w-2.5 h-2.5 rounded-full ${colorClass}`;
    }
    if (statusText) {
        statusText.textContent = text;
    }
};

window.addEventListener('DOMContentLoaded', () => {
    app.init();
});
