const app = {
    state: {
        token: null,
        user: null,
        activeInstanceId: null,
        chatWs: null,
        currentAgentMessageDiv: null,
        typingIndicatorDiv: null,
        messageDivs: {} // Map of msgId -> div element
    }
};

const API_BASE = '/api';

app.initIde = function() {
    const token = localStorage.getItem('mc_token');
    if (!token) {
        window.location.href = '/';
        return;
    }
    this.state.token = token;
    
    // Parse the URL
    const pathParts = window.location.pathname.split('/');
    const instanceId = pathParts[pathParts.length - 1];
    
    const urlParams = new URLSearchParams(window.location.search);
    const instanceAlias = urlParams.get('alias');
    
    if (instanceId && instanceId !== 'ide') {
        this.state.activeInstanceId = instanceId;
        document.getElementById('ide-chat-title').innerText = instanceAlias || 'Chat with Agent';
        this.toggleIdeSidebar('chat');
        this.connectChatWebSocket(instanceId);
        
        // Also fetch user profile to get Google ID for websocket logic
        axios.get('/api/auth/me', {
            headers: { 'Authorization': `Bearer ${token}` }
        }).then(res => {
            this.state.user = res.data;
        }).catch(err => console.error("Failed to fetch user data", err));
    } else {
        alert("Invalid Instance ID");
    }
    
    // Setup event listeners for chat input
    const input = document.getElementById('ide-chat-input');
    if (input) {
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                app.sendChatMessage();
            }
        });
    }
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
        resizer.style.display = 'none';
    } else if (tool === 'files') {
        sidebar.style.display = 'block';
        resizer.style.display = 'block';
        document.querySelectorAll('.tool-content').forEach(el => el.style.display = 'none');
        document.getElementById('tool-content-files').style.display = 'block';
        this.loadIdeFiles();
    }
};

app.loadIdeFiles = async function(instanceId = this.state.activeInstanceId, path = '/root/.openclaw') {
    const container = document.getElementById('ide-file-tree');
    container.innerHTML = '<div class="spinner" style="margin:2rem auto"></div>';
    
    // Ensure auth header is set for axios if not already
    if (this.state.token) {
        axios.defaults.headers.common['Authorization'] = `Bearer ${this.state.token}`;
    }
    
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
                    <div class="file-row" style="display:flex; justify-content:space-between; align-items:center; padding: 0.5rem; border-bottom: 1px solid rgba(255,255,255,0.05); cursor: ${f.is_dir ? 'pointer' : 'default'}">
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
        this.appendChatMessage("Connected to OpenClaw agent instance. Type a message to begin.", "agent");
        // Request history right after connecting
        this.state.chatWs.send(JSON.stringify({ action: 'fetch_history' }));
    };
    
    this.state.chatWs.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log("Raw OpenClaw Event:", data);
        
        if (data.type === 'history' || (data.type === 'res' && data.payload?.messages)) {
            const messages = data.messages || data.payload?.messages;
            if (Array.isArray(messages)) {
                const container = document.getElementById('ide-chat-history');
                container.innerHTML = '';
                
                messages.forEach(msg => {
                    const sender = msg.role === 'user' ? 'user' : 'agent';
                    let fullText = "";
                    let hasImages = false;
                    let imagesHtml = `<div style="display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.5rem;">`;

                    if (Array.isArray(msg.content)) {
                        msg.content.forEach(chunk => {
                            if (chunk.type === 'text') {
                                fullText += chunk.text;
                            } else if (chunk.type === 'image') {
                                hasImages = true;
                                imagesHtml += `<img src="data:${chunk.mimeType || 'image/png'};base64,${chunk.data || chunk.content}" style="max-height: 100px; border-radius: 0.5rem; border: 1px solid rgba(255,255,255,0.1);">`;
                            } else if (chunk.type === 'toolCall') {
                                const args = JSON.stringify(chunk.arguments || {}, null, 2);
                                fullText += `\n<details class="thought-process" style="border-color: #3b82f6;"><summary style="color: #60a5fa;"><i class="ri-tools-line"></i> Tool Execution: ${chunk.name}</summary><div class="thought-content"><pre style="margin:0; white-space:pre-wrap;">${args}</pre></div></details>\n\n`;
                            } else if (chunk.type === 'toolResult') {
                                let resText = typeof chunk.text === "string" ? chunk.text : JSON.stringify(chunk.text || chunk.result || "Success", null, 2);
                                if (resText.length > 500) resText = resText.substring(0, 500) + "... [truncated]";
                                fullText += `\n<details class="thought-process" style="border-color: #10b981;"><summary style="color: #34d399;"><i class="ri-check-line"></i> Tool Result: ${chunk.name || 'Success'}</summary><div class="thought-content"><pre style="margin:0; white-space:pre-wrap;">${resText}</pre></div></details>\n\n`;
                            } else if (chunk.type === 'thinking') {
                                fullText += `\n<details class="thought-process" style="border-color: #8b5cf6;"><summary style="color: #c4b5fd;"><i class="ri-brain-line"></i> Thinking Process</summary><div class="thought-content"><pre style="margin:0; white-space:pre-wrap; font-family: inherit;">${chunk.thinking}</pre></div></details>\n\n`;
                            }
                        });
                    }
                    imagesHtml += `</div>`;
                    
                    const finalHtml = (hasImages ? imagesHtml : "") + (fullText || (sender === 'user' ? 'Attachment sent.' : ''));
                    
                    if (finalHtml.trim() || hasImages) {
                        this.appendChatMessage(finalHtml, sender, null, msg.timestamp || Date.now(), false); 
                    }
                });
                container.scrollTop = container.scrollHeight;
            }
            return;
        }

        if (data.type === 'error') {
            if (this.state.typingIndicatorDiv) {
                this.state.typingIndicatorDiv.remove();
                this.state.typingIndicatorDiv = null;
            }
            document.querySelectorAll('.typing-indicator').forEach(el => el.remove());
            this.appendChatMessage(`Error: ${data.text}`, 'agent');
            this.state.currentAgentMessageDiv = null;
            return;
        }
        
        // Handle OpenClaw raw events directly
        if (data.type === 'event') {
            const stream = data.payload?.stream;
            const phase = data.payload?.data?.phase;
            
            // Handle lifecycle events for typing indicators
            if (data.event === 'agent' && stream === 'lifecycle') {
                if (phase === 'start') {
                    if (!this.state.typingIndicatorDiv) {
                        this.state.typingIndicatorDiv = document.createElement('div');
                        this.state.typingIndicatorDiv.className = 'typing-indicator';
                        this.state.typingIndicatorDiv.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';
                        const container = document.getElementById('ide-chat-history');
                        container.appendChild(this.state.typingIndicatorDiv);
                        container.scrollTop = container.scrollHeight;
                    }
                } else if (phase === 'end') {
                    if (this.state.typingIndicatorDiv) {
                        this.state.typingIndicatorDiv.remove();
                        this.state.typingIndicatorDiv = null;
                    }
                    document.querySelectorAll('.typing-indicator').forEach(el => el.remove());
                    this.state.currentAgentMessageDiv = null; // Unlink active bubble
                }
            }
            
            // Handle tool executions (agent item stream)
            if (data.event === 'agent' && stream === 'item' && data.payload?.data?.kind === 'tool') {
                const itemData = data.payload.data;
                const runId = data.payload.runId;
                const itemId = itemData.itemId;
                
                if (!this.state.toolDivs) this.state.toolDivs = {};
                
                const formatToolBubble = (phase, name, title, status) => {
                    const borderColor = phase === 'end' ? '#10b981' : '#3b82f6';
                    const titleColor = phase === 'end' ? '#34d399' : '#60a5fa';
                    const icon = phase === 'end' ? 'ri-check-line' : 'ri-tools-line';
                    const label = phase === 'end' ? 'Tool Output' : 'Tool Call';
                    return `<details class="thought-process" ${phase === 'end' ? '' : 'open'} style="border-color: ${borderColor}; margin-bottom: 0.5rem;"><summary style="color: ${titleColor};"><i class="${icon}"></i> ${label}: ${name}</summary><div class="thought-content"><pre style="margin:0; white-space:pre-wrap; font-size: 0.85em;">${title || ''}\nStatus: ${status}</pre></div></details>`;
                };

                if (phase === 'start') {
                    // Start tool bubble
                    const toolHtml = formatToolBubble(phase, itemData.name, itemData.title, itemData.status);
                    
                    // Unlink the current chat bubble so the tool bubble inserts cleanly below it
                    this.state.currentAgentMessageDiv = null; 
                    
                    const newBubble = this.appendChatMessage(toolHtml, 'agent', runId + '-' + itemId, Date.now(), true);
                    this.state.toolDivs[itemId] = newBubble;
                    
                    // The typing indicator should be moved below the new tool bubble
                    if (this.state.typingIndicatorDiv) {
                        const container = document.getElementById('ide-chat-history');
                        container.appendChild(this.state.typingIndicatorDiv);
                        container.scrollTop = container.scrollHeight;
                    }
                    
                } else if (phase === 'update' || phase === 'end') {
                    // Update existing tool bubble
                    const targetDiv = this.state.toolDivs[itemId];
                    if (targetDiv) {
                        const contentWrapper = targetDiv.querySelector('.message-content-wrapper');
                        if (contentWrapper) {
                            contentWrapper.innerHTML = formatToolBubble(phase, itemData.name, itemData.title, itemData.status);
                        }
                    }
                }
            }
            
            if (data.event === 'chat') {
                const message = data.payload?.message;
                if (!message) return;
                
                const sender = message.role || 'agent';
                if (sender === 'user') return; // We append user messages locally
                
                const runId = data.payload?.runId; // Use runId to group the entire generation into one bubble!
                const state = data.payload?.state;
                let fullText = "";
                
                // Build the complete string from the content chunks
                if (Array.isArray(message.content)) {
                    message.content.forEach(chunk => {
                        if (chunk.type === 'thinking' && chunk.thinking) {
                            fullText += `\n<details class="thought-process" open><summary><i class="ri-brain-line"></i> Thinking Process</summary><div class="thought-content"><pre style="margin:0; white-space:pre-wrap; font-family: inherit;">${typeof chunk.thinking === "string" ? chunk.thinking : JSON.stringify(chunk.thinking, null, 2)}</pre></div></details>\n\n`;
                        } else if (chunk.type === 'text' && chunk.text) {
                            fullText += chunk.text;
                        } else if (chunk.type === 'toolCall') {
                            const args = JSON.stringify(chunk.arguments || {}, null, 2);
                            fullText += `\n<details class="thought-process" style="border-color: #3b82f6;"><summary style="color: #60a5fa;"><i class="ri-tools-line"></i> Tool Execution: ${chunk.name}</summary><div class="thought-content"><pre style="margin:0; white-space:pre-wrap;">${args}</pre></div></details>\n\n`;
                        } else if (chunk.type === 'toolResult') {
                            if (Array.isArray(chunk.content)) {
                                chunk.content.forEach(r => {
                                    if (r.type === 'text' && r.text) {
                                        let chunkText = typeof r.text === "string" ? r.text : JSON.stringify(r.text, null, 2);
                                        fullText += `\n<details class="thought-process" style="border-color: #10b981;"><summary style="color: #34d399;"><i class="ri-check-line"></i> Tool Result</summary><div class="thought-content"><pre style="margin:0; white-space:pre-wrap;">${chunkText.substring(0, 1000)}${chunkText.length > 1000 ? '...' : ''}</pre></div></details>\n\n`;
                                    }
                                });
                            }
                        }
                    });
                }
                
                if (runId && this.state.messageDivs[runId]) {
                    // Update existing bubble for this run
                    const targetDiv = this.state.messageDivs[runId];
                    const contentWrapper = targetDiv.querySelector('.message-content-wrapper');
                    if (contentWrapper && fullText) {
                        contentWrapper.innerHTML = this.formatAgentText(fullText);
                        const container = document.getElementById('ide-chat-history');
                        container.scrollTop = container.scrollHeight;
                    }
                } else {
                    // Create brand new bubble for this run
                    if (fullText || state === "final") {
                        this.appendChatMessage(fullText || "...", sender, runId, message.createdAt || Date.now());
                    }
                }
                
                if (state === "final") {
                    // Remove typing indicator if we hit final state
                    if (this.state.typingIndicatorDiv) {
                        this.state.typingIndicatorDiv.remove();
                        this.state.typingIndicatorDiv = null;
                    }
                    document.querySelectorAll('.typing-indicator').forEach(el => el.remove());
                }
            }
        }
    };
    
    this.state.chatWs.onclose = () => {
        console.log("Chat WS Closed");
        if (this.state.typingIndicatorDiv) {
            this.state.typingIndicatorDiv.remove();
            this.state.typingIndicatorDiv = null;
        }
        document.querySelectorAll('.typing-indicator').forEach(el => el.remove());
        this.appendChatMessage("Connection closed by server. Please refresh the page to reconnect.", "agent");
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
    
    // Clean up any existing typing indicators to be safe
    document.querySelectorAll('.typing-indicator').forEach(el => el.remove());
    
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

app.createChatMessageDiv = function(sender, msgId = null, timestamp = null) {
    const container = document.getElementById('ide-chat-history');
    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-message ${sender}`;
    msgDiv.classList.add('parsed-markdown');
    
    let targetTimestamp;
    if (timestamp) {
        // Handle both ISO strings and numbers
        targetTimestamp = new Date(timestamp).getTime();
        if (isNaN(targetTimestamp)) targetTimestamp = parseFloat(timestamp);
    } else {
        targetTimestamp = Date.now();
    }
    msgDiv.dataset.timestamp = targetTimestamp;
    
    const toolsWrapper = document.createElement('div');
    toolsWrapper.className = 'message-tools-wrapper';
    msgDiv.appendChild(toolsWrapper);
    
    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'message-content-wrapper';
    msgDiv.appendChild(contentWrapper);
    
    // Insert in chronological order
    const children = Array.from(container.children);
    let inserted = false;
    for (let i = children.length - 1; i >= 0; i--) {
        const childTs = Number(children[i].dataset.timestamp || 0);
        const myTs = Number(msgDiv.dataset.timestamp);
        if (myTs >= childTs) {
            if (i === children.length - 1) {
                container.appendChild(msgDiv);
            } else {
                container.insertBefore(msgDiv, children[i + 1]);
            }
            inserted = true;
            break;
        }
    }
    
    if (!inserted) {
        if (children.length > 0) {
            container.insertBefore(msgDiv, children[0]);
        } else {
            container.appendChild(msgDiv);
        }
    }
    
    container.scrollTop = container.scrollHeight;
    
    if (msgId) {
        this.state.messageDivs[msgId] = msgDiv;
        msgDiv.dataset.msgId = msgId;
    }
    
    if (sender === 'agent') {
        this.state.currentAgentMessageDiv = msgDiv;
    }
    
    return msgDiv;
};

app.appendChatMessage = function(text, sender, msgId = null, timestamp = null, isRawHtml = false) {
    const msgDiv = this.createChatMessageDiv(sender, msgId, timestamp);
    const wrapper = msgDiv.querySelector('.message-content-wrapper');
    const contentHtml = isRawHtml ? text : this.formatAgentText(text);
    
    if (wrapper) {
        wrapper.innerHTML = contentHtml;
    } else {
        msgDiv.innerHTML = contentHtml;
    }
    
    return msgDiv;
};

app.formatAgentText = function(text) {
    if (!text) return "";
    
    // Process tools
    let preProcessed = text;
    
    // Replace custom thinking delimiters with HTML just in case they are still in the raw text
    preProcessed = preProcessed.replace(/:::THINKING_START:::/g, '<details class="thought-process"><summary><i class="ri-brain-line"></i> Thinking Process</summary><div class="thought-content">');
    preProcessed = preProcessed.replace(/:::THINKING_END:::/g, '</div></details>');
    
    // Strip <final> tags that the agent sometimes outputs
    preProcessed = preProcessed.replace(/<final\s*>/g, '');
    preProcessed = preProcessed.replace(/<\/final\s*>/g, '');
    
    let html = typeof marked !== 'undefined' ? marked.parse(preProcessed) : preProcessed.replace(/\n/g, '<br>');
    
    return html;
};

// Resizer logic
document.addEventListener('DOMContentLoaded', () => {
    const resizer = document.getElementById('ide-sidebar-resizer');
    const sidebar = document.getElementById('ide-sidebar');
    let isResizing = false;

    if (resizer) {
        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            document.body.style.cursor = 'col-resize';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const newWidth = e.clientX - 50; // 50px is the activity bar width
            if (newWidth > 150 && newWidth < 600) {
                sidebar.style.width = `${newWidth}px`;
            }
        });

        document.addEventListener('mouseup', () => {
            isResizing = false;
            document.body.style.cursor = 'default';
        });
    }
    
    app.initIde();
});
