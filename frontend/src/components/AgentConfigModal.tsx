import React, { useState, useEffect } from 'react';
import { Save, FileText, Plug, Loader2 } from 'lucide-react';
import api from '../lib/api';
import { AGENT_TEMPLATES } from '../lib/templates';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { Select, Textarea } from './ui/Input';
import { cn } from '../lib/cn';

interface AgentConfigModalProps {
  fleetId: string;
  instance: any;
  onClose: () => void;
  onSuccess: () => void;
}

const AgentConfigModal: React.FC<AgentConfigModalProps> = ({ fleetId, instance, onClose, onSuccess }) => {
  const [activeTab, setActiveTab] = useState<'markdown' | 'mcp'>('markdown');
  const [agentMd, setAgentMd] = useState("");
  const [mcpConfig, setMcpConfig] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);

  useEffect(() => {
    api.get(`/fleets/${fleetId}/instances/${instance.id}/config`)
      .then(res => {
        setAgentMd(res.data.agentMd || AGENT_TEMPLATES["Default (Blank)"].md);
        setMcpConfig(res.data.mcpConfig || AGENT_TEMPLATES["Default (Blank)"].mcp);
        setIsLoadingConfig(false);
      })
      .catch(err => {
        console.error("Failed to fetch live config", err);
        setAgentMd(instance.agentMd || AGENT_TEMPLATES["Default (Blank)"].md);
        setMcpConfig(instance.mcpConfig || AGENT_TEMPLATES["Default (Blank)"].mcp);
        setIsLoadingConfig(false);
      });
  }, [fleetId, instance.id]);

  const handleApplyTemplate = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const tpl = AGENT_TEMPLATES[e.target.value];
    if (tpl) {
      setAgentMd(tpl.md);
      setMcpConfig(tpl.mcp);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await api.put(`/fleets/${fleetId}/instances/${instance.id}/config`, {
        agentMd,
        mcpConfig
      });
      onSuccess();
    } catch (e) {
      console.error("Failed to save config", e);
      alert("Failed to save config");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      widthClassName="max-w-4xl"
      title={
        <div>
          <div className="font-semibold">{instance.role} Configuration</div>
          <div className="text-xs font-normal text-muted-foreground mt-0.5">{instance.agentType.toUpperCase()} Runtime</div>
        </div>
      }
    >
      <div className="flex flex-col h-[70vh] -m-6">
        {/* Templates Toolbar */}
        <div className="bg-secondary/50 p-3 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-muted-foreground">Load Template:</span>
            <Select
              className="text-sm px-3 py-1.5 w-auto"
              onChange={handleApplyTemplate}
              defaultValue="custom"
            >
              <option value="custom" disabled>Select preset...</option>
              {Object.keys(AGENT_TEMPLATES).map(k => <option key={k} value={k}>{k}</option>)}
            </Select>
          </div>

          <div className="flex border border-border rounded-md overflow-hidden bg-background">
            <button
              onClick={() => setActiveTab('markdown')}
              className={cn(
                'px-4 py-1.5 text-sm font-medium flex items-center gap-2 transition-colors',
                activeTab === 'markdown' ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <FileText size={14} /> Identity & Skills
            </button>
            <button
              onClick={() => setActiveTab('mcp')}
              className={cn(
                'px-4 py-1.5 text-sm font-medium flex items-center gap-2 border-l border-border transition-colors',
                activeTab === 'mcp' ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Plug size={14} /> MCP Integrations
            </button>
          </div>
        </div>

        {/* Editor Area */}
        <div className="flex-1 p-4 overflow-hidden flex flex-col relative min-h-0">
          {isLoadingConfig && (
            <div className="absolute inset-0 bg-card/90 flex flex-col items-center justify-center z-10">
              <Loader2 className="animate-spin text-muted-foreground mb-3" size={32} />
              <div className="text-foreground font-medium">Fetching Live Configuration</div>
              <div className="text-muted-foreground text-xs mt-1">Connecting to VM via SSH...</div>
            </div>
          )}
          {activeTab === 'markdown' ? (
            <div className="flex-1 flex flex-col min-h-0">
              <label className="text-sm font-medium mb-2 text-muted-foreground">Agent Profile (AGENTS.md / SOUL.md)</label>
              <Textarea
                className="w-full flex-1 font-mono text-sm resize-none"
                value={agentMd}
                onChange={e => setAgentMd(e.target.value)}
                placeholder="# Describe your agent's identity and skills here..."
              />
            </div>
          ) : (
            <div className="flex-1 flex flex-col min-h-0">
              <label className="text-sm font-medium mb-2 text-muted-foreground">MCP JSON Configuration</label>
              <Textarea
                className="w-full flex-1 font-mono text-sm resize-none"
                value={mcpConfig}
                onChange={e => setMcpConfig(e.target.value)}
                placeholder={'{\n  "mcpServers": {}\n}'}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border flex justify-end gap-3 bg-secondary/30 shrink-0">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Deploy to Agent
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default AgentConfigModal;
