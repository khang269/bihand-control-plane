import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Key, Globe } from 'lucide-react';
import api from '../lib/api';
import { useLanguage } from '../context/LanguageContext';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input, Textarea, Select } from '../components/ui/Input';
import { IconBadge } from '../components/ui/IconBadge';

const Credentials: React.FC = () => {
  const { language } = useLanguage();
  const [credentials, setCredentials] = useState<any[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('llm_api_key');
  const [newData, setNewData] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // Form states for Facebook
  const [fbPageId, setFbPageId] = useState('');
  const [fbAccessToken, setFbAccessToken] = useState('');

  // Form states for Zalo OA
  const [zaloOaId, setZaloOaId] = useState('');
  const [zaloAccessToken, setZaloAccessToken] = useState('');

  // Form states for Instagram
  const [igBusinessId, setIgBusinessId] = useState('');
  const [igAccessToken, setIgAccessToken] = useState('');

  // Form states for X (Twitter)
  const [xConsumerKey, setXConsumerKey] = useState('');
  const [xConsumerSecret, setXConsumerSecret] = useState('');
  const [xAccessToken, setXAccessToken] = useState('');
  const [xAccessTokenSecret, setXAccessTokenSecret] = useState('');

  // Form states for Reddit
  const [redditClientId, setRedditClientId] = useState('');
  const [redditClientSecret, setRedditClientSecret] = useState('');
  const [redditUsername, setRedditUsername] = useState('');
  const [redditPassword, setRedditPassword] = useState('');
  const [redditUserAgent, setRedditUserAgent] = useState('');
  const [redditSubreddit, setRedditSubreddit] = useState('');

  const fetchCredentials = async () => {
    setIsLoading(true);
    try {
      const res = await api.get('/credentials');
      setCredentials(res.data.credentials || []);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCredentials();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName) return;

    let finalData = '';

    if (newType === 'social_facebook') {
      if (!fbPageId || !fbAccessToken) return;
      finalData = JSON.stringify({ page_id: fbPageId, access_token: fbAccessToken });
    } else if (newType === 'social_zalo') {
      if (!zaloOaId || !zaloAccessToken) return;
      finalData = JSON.stringify({ oa_id: zaloOaId, access_token: zaloAccessToken });
    } else if (newType === 'social_instagram') {
      if (!igBusinessId || !igAccessToken) return;
      finalData = JSON.stringify({ instagram_business_id: igBusinessId, access_token: igAccessToken });
    } else if (newType === 'social_x') {
      if (!xConsumerKey || !xConsumerSecret || !xAccessToken || !xAccessTokenSecret) return;
      finalData = JSON.stringify({
        consumer_key: xConsumerKey,
        consumer_secret: xConsumerSecret,
        access_token: xAccessToken,
        access_token_secret: xAccessTokenSecret
      });
    } else if (newType === 'social_reddit') {
      if (!redditClientId || !redditClientSecret || !redditUsername || !redditPassword) return;
      finalData = JSON.stringify({
        client_id: redditClientId,
        client_secret: redditClientSecret,
        username: redditUsername,
        password: redditPassword,
        user_agent: redditUserAgent,
        subreddit: redditSubreddit
      });
    } else {
      if (!newData) return;
      finalData = newData;
    }

    try {
      await api.post('/credentials', { name: newName, type: newType, data: finalData });
      setIsAdding(false);
      setNewName('');
      setNewData('');
      setFbPageId('');
      setFbAccessToken('');
      setZaloOaId('');
      setZaloAccessToken('');
      setIgBusinessId('');
      setIgAccessToken('');
      setXConsumerKey('');
      setXConsumerSecret('');
      setXAccessToken('');
      setXAccessTokenSecret('');
      setRedditClientId('');
      setRedditClientSecret('');
      setRedditUsername('');
      setRedditPassword('');
      setRedditUserAgent('');
      setRedditSubreddit('');
      fetchCredentials();
    } catch (e) {
      alert("Failed to add credential");
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this credential permanently? Any agents using it will fail to start.")) return;
    try {
      await api.delete(`/credentials/${id}`);
      fetchCredentials();
    } catch (e) {
      alert("Failed to delete");
    }
  };

  return (
    <div className="pb-20 max-w-4xl mx-auto space-y-6 text-left">
      {/* Vault header */}
      <Card className="relative overflow-hidden">
        <div className="absolute top-0 right-0 w-[300px] h-[200px] bg-purple-500/5 rounded-full blur-[90px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-[200px] h-[150px] bg-emerald-500/5 rounded-full blur-[80px] pointer-events-none" />

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)] animate-pulse" />
              <h1 className="text-xl font-bold font-mono tracking-widest uppercase">
                {language === 'vi' ? 'Kho khóa Thông tin đăng nhập' : 'Secured Credentials Vault'}
              </h1>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {language === 'vi'
                ? 'Cấu hình thông tin đăng nhập được mã hóa client-side bằng AES-256. API key và token mạng xã hội được lưu trữ cực kỳ bảo mật.'
                : 'Configure AES-256 client-side encrypted credentials. API keys and social tokens are safely locked and only accessible during agent runtimes.'}
            </p>
          </div>

          <Button onClick={() => setIsAdding(!isAdding)} className="uppercase tracking-wider">
            <Plus size={14} /> {language === 'vi' ? 'Thêm Khóa mới' : 'Add Secret'}
          </Button>
        </div>
      </Card>

      {isAdding && (
        <form onSubmit={handleAdd} className="rounded-2xl border border-border bg-card text-card-foreground shadow-sm p-5 mb-8 space-y-4">
          <h3 className="font-semibold text-lg">Add Credential</h3>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Credential Name</label>
              <Input
                type="text"
                required
                placeholder="e.g. My Workspace or LLM Key"
                value={newName}
                onChange={e => setNewName(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Credential Type</label>
              <Select
                value={newType}
                onChange={e => setNewType(e.target.value)}
              >
                <option value="llm_api_key">LLM API Key (OpenAI, Anthropic, Gemini)</option>
                <option value="generic_token">Generic Auth Token</option>
                <option value="google_workspace">Google Workspace (OAuth)</option>
                <option value="meta_devtools">Meta Developer Tools (OAuth)</option>
                <option value="social_facebook">Facebook Page Integration</option>
                <option value="social_zalo">Zalo OA Integration</option>
                <option value="social_instagram">Instagram Business Integration</option>
                <option value="social_x">X (Twitter) Developer API</option>
                <option value="social_reddit">Reddit API Integration</option>
              </Select>
            </div>

            {/* Custom Inputs for Facebook */}
            {newType === 'social_facebook' && (
              <div className="col-span-2 grid grid-cols-2 gap-4 border-t border-border pt-4">
                <div className="col-span-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider mb-2">Facebook Settings</h4>
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">Page ID</label>
                  <Input
                    type="text"
                    required
                    placeholder="e.g. 109283748293749"
                    value={fbPageId}
                    onChange={e => setFbPageId(e.target.value)}
                    className="font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">Page Access Token</label>
                  <Input
                    type="password"
                    required
                    placeholder="EAAG..."
                    value={fbAccessToken}
                    onChange={e => setFbAccessToken(e.target.value)}
                    className="font-mono"
                  />
                </div>
              </div>
            )}

            {/* Custom Inputs for Zalo OA */}
            {newType === 'social_zalo' && (
              <div className="col-span-2 grid grid-cols-2 gap-4 border-t border-border pt-4">
                <div className="col-span-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider mb-2">Zalo OA Settings</h4>
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">OA ID</label>
                  <Input
                    type="text"
                    required
                    placeholder="e.g. 123456789012345678"
                    value={zaloOaId}
                    onChange={e => setZaloOaId(e.target.value)}
                    className="font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">OA Access Token</label>
                  <Input
                    type="password"
                    required
                    placeholder="..."
                    value={zaloAccessToken}
                    onChange={e => setZaloAccessToken(e.target.value)}
                    className="font-mono"
                  />
                </div>
              </div>
            )}

            {/* Custom Inputs for Instagram */}
            {newType === 'social_instagram' && (
              <div className="col-span-2 grid grid-cols-2 gap-4 border-t border-border pt-4">
                <div className="col-span-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider mb-2">Instagram Business Settings</h4>
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">Instagram Business ID</label>
                  <Input
                    type="text"
                    required
                    placeholder="e.g. 17841400000000000"
                    value={igBusinessId}
                    onChange={e => setIgBusinessId(e.target.value)}
                    className="font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">Facebook Page Access Token (linked to IG)</label>
                  <Input
                    type="password"
                    required
                    placeholder="EAAG..."
                    value={igAccessToken}
                    onChange={e => setIgAccessToken(e.target.value)}
                    className="font-mono"
                  />
                </div>
              </div>
            )}

            {/* Custom Inputs for X (Twitter) */}
            {newType === 'social_x' && (
              <div className="col-span-2 grid grid-cols-2 gap-4 border-t border-border pt-4">
                <div className="col-span-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider mb-2">X / Twitter API Keys (OAuth 1.0a)</h4>
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">Consumer Key (API Key)</label>
                  <Input
                    type="text"
                    required
                    placeholder="e.g. xYz..."
                    value={xConsumerKey}
                    onChange={e => setXConsumerKey(e.target.value)}
                    className="font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">Consumer Secret (API Secret)</label>
                  <Input
                    type="password"
                    required
                    placeholder="e.g. sEcReT..."
                    value={xConsumerSecret}
                    onChange={e => setXConsumerSecret(e.target.value)}
                    className="font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">Access Token</label>
                  <Input
                    type="text"
                    required
                    placeholder="e.g. 12345-abc..."
                    value={xAccessToken}
                    onChange={e => setXAccessToken(e.target.value)}
                    className="font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">Access Token Secret</label>
                  <Input
                    type="password"
                    required
                    placeholder="e.g. sEcReT..."
                    value={xAccessTokenSecret}
                    onChange={e => setXAccessTokenSecret(e.target.value)}
                    className="font-mono"
                  />
                </div>
              </div>
            )}

            {/* Custom Inputs for Reddit */}
            {newType === 'social_reddit' && (
              <div className="col-span-2 grid grid-cols-2 gap-4 border-t border-border pt-4">
                <div className="col-span-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider mb-2">Reddit API Settings</h4>
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">Client ID</label>
                  <Input
                    type="text"
                    required
                    placeholder="e.g. abcde12345"
                    value={redditClientId}
                    onChange={e => setRedditClientId(e.target.value)}
                    className="font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">Client Secret</label>
                  <Input
                    type="password"
                    required
                    placeholder="e.g. sEcReT..."
                    value={redditClientSecret}
                    onChange={e => setRedditClientSecret(e.target.value)}
                    className="font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">Username</label>
                  <Input
                    type="text"
                    required
                    placeholder="e.g. MyBotUser"
                    value={redditUsername}
                    onChange={e => setRedditUsername(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">Password</label>
                  <Input
                    type="password"
                    required
                    placeholder="********"
                    value={redditPassword}
                    onChange={e => setRedditPassword(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">User Agent (Optional)</label>
                  <Input
                    type="text"
                    placeholder="BihandAgent/1.0 by /u/MyBotUser"
                    value={redditUserAgent}
                    onChange={e => setRedditUserAgent(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">Target Subreddit (Optional)</label>
                  <Input
                    type="text"
                    placeholder="e.g. test"
                    value={redditSubreddit}
                    onChange={e => setRedditSubreddit(e.target.value)}
                  />
                </div>
              </div>
            )}

            {newType !== 'google_workspace' && newType !== 'meta_devtools' && !newType.startsWith('social_') && (
              <div className="col-span-2">
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Secret Data</label>
                <Textarea
                  required
                  placeholder="sk-proj-..."
                  value={newData}
                  onChange={e => setNewData(e.target.value)}
                  className="h-24 resize-none font-mono"
                />
                <p className="text-xs text-muted-foreground mt-2">This data is AES-encrypted at rest and can only be accessed by the provisioning pipeline.</p>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={() => setIsAdding(false)}>Cancel</Button>
            {newType === 'google_workspace' ? (
              <Button type="button" className="bg-blue-600 text-white hover:bg-blue-700 hover:opacity-100" onClick={async () => {
                  try {
                    const res = await api.post('/credentials/oauth/google/start', { name: newName });
                    window.location.href = res.data.authUrl;
                  } catch (e) {
                    alert("Failed to start Google OAuth flow.");
                  }
              }}>
                <Globe size={16} /> Authorize with Google
              </Button>
            ) : newType === 'meta_devtools' ? (
              <Button type="button" className="bg-blue-600 text-white hover:bg-blue-700 hover:opacity-100" onClick={async () => {
                  try {
                    const res = await api.post('/credentials/oauth/meta/start', { name: newName });
                    window.location.href = res.data.authUrl;
                  } catch {
                    alert("Failed to start Meta OAuth flow.");
                  }
              }}>
                <Globe size={16} /> Authorize with Meta
              </Button>
            ) : (
              <Button type="submit">Save Secret</Button>
            )}
          </div>
        </form>
      )}

      {isLoading ? (
        <div className="text-muted-foreground text-center py-12">Loading credentials...</div>
      ) : credentials.length === 0 ? (
        <div className="text-center py-16 border border-border border-dashed rounded-xl">
          <Key size={32} className="mx-auto text-muted-foreground mb-3" />
          <h3 className="font-medium mb-1">No credentials yet</h3>
          <p className="text-muted-foreground text-sm">Add an API key to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {credentials.map(cred => (
            <Card key={cred._id} className="hover:border-emerald-500/25 flex items-center justify-between transition-all duration-200 group relative overflow-hidden">
              {/* Neon border stripes */}
              <div className="absolute top-0 left-0 right-0 h-[2px] bg-emerald-500/5 group-hover:bg-emerald-500/30 transition-colors" />

              <div className="flex items-center gap-4">
                <IconBadge className="bg-secondary text-muted-foreground group-hover:text-emerald-500 border border-border group-hover:border-emerald-500/20">
                  {cred.type === 'google_workspace' || cred.type === 'meta_devtools' ? <Globe size={18} /> : <Key size={18} />}
                </IconBadge>
                <div>
                  <h3 className="font-bold text-sm group-hover:text-foreground transition-colors">{cred.name}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] font-bold font-mono text-emerald-500 bg-emerald-500/5 px-2 py-0.5 rounded border border-emerald-500/10 uppercase tracking-wide">{cred.type.replace(/_/g, ' ')}</span>
                    <span className="text-muted-foreground">&middot;</span>
                    <span className="text-xs text-muted-foreground font-mono tracking-widest">••••••••••••{cred._id.slice(-4).toUpperCase()}</span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => handleDelete(cred._id)}
                className="p-2 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 rounded-md transition-colors"
                title="Delete credential"
              >
                <Trash2 size={16} />
              </button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default Credentials;
