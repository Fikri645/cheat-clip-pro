import {
AlertTriangle,
ExternalLink
} from 'lucide-react';
import type React from 'react';
import type { Translations } from '../../locales';
import { HackerApiKeyInput } from '../HackerApiKeyInput';
interface Props {t:Translations;
apiProvider:"gemini" | "openrouter";
setApiProvider:React.Dispatch<React.SetStateAction<"gemini" | "openrouter">>;
setError:React.Dispatch<React.SetStateAction<string | null>>;
apiKey:string;
setApiKey:React.Dispatch<React.SetStateAction<string>>;
loading:boolean;
loadingModels:boolean;
selectedModel:string;
setSelectedModel:React.Dispatch<React.SetStateAction<string>>;
availableModels:string[];
openRouterKey:string;
setOpenRouterKey:React.Dispatch<React.SetStateAction<string>>;
loadingOpenRouterModels:boolean;
setIsCustomOpenRouterModel:React.Dispatch<React.SetStateAction<boolean>>;
isCustomOpenRouterModel:boolean;
customOpenRouterModel:string;
openRouterModel:string;
setCustomOpenRouterModel:React.Dispatch<React.SetStateAction<string>>;
setOpenRouterModel:React.Dispatch<React.SetStateAction<string>>;
openRouterModels:{ id: string; name: string; description?: string; context_length?: number; recommended?: boolean; }[];}
export function AIEngineSettings({t,apiProvider,setApiProvider,setError,apiKey,setApiKey,loading,loadingModels,selectedModel,setSelectedModel,availableModels,openRouterKey,setOpenRouterKey,loadingOpenRouterModels,setIsCustomOpenRouterModel,isCustomOpenRouterModel,customOpenRouterModel,openRouterModel,setCustomOpenRouterModel,setOpenRouterModel,openRouterModels}:Props){return <>
              {/* Card 1: AI Engine Configuration */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', padding: '1.25rem', borderRadius: 0, background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.04)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ fontSize: '0.9rem', color: 'var(--primary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '0.4rem', margin: 0 }}>
                    [AI] {t.form.aiSettingsTitle}
                  </h3>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>
                    {apiProvider === 'gemini' ? 'ENGINE: GOOGLE_GEMINI' : 'ENGINE: OPENROUTER_MULTILLM'}
                  </span>
                </div>

                {/* Provider Selection Tabs */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', background: '#0a0a0f', padding: '3px', border: '1px solid rgba(255, 0, 255, 0.2)' }}>
                  <button
                    type="button"
                    onClick={() => {
                      setApiProvider('gemini');
                      localStorage.setItem('cheat_clip_api_provider', 'gemini');
                      setError(null);
                    }}
                    style={{
                      padding: '0.55rem 0.75rem',
                      background: apiProvider === 'gemini' ? '#ff00ff' : 'transparent',
                      color: apiProvider === 'gemini' ? '#000000' : 'rgba(255, 255, 255, 0.7)',
                      border: 'none',
                      fontWeight: 700,
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                      letterSpacing: '0.04em',
                      transition: 'all 0.15s ease',
                      boxShadow: apiProvider === 'gemini' ? '0 0 10px rgba(255, 0, 255, 0.4)' : 'none',
                    }}
                  >
                    {t.form.providerGemini}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setApiProvider('openrouter');
                      localStorage.setItem('cheat_clip_api_provider', 'openrouter');
                      setError(null);
                    }}
                    style={{
                      padding: '0.55rem 0.75rem',
                      background: apiProvider === 'openrouter' ? '#ff00ff' : 'transparent',
                      color: apiProvider === 'openrouter' ? '#000000' : 'rgba(255, 255, 255, 0.7)',
                      border: 'none',
                      fontWeight: 700,
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                      letterSpacing: '0.04em',
                      transition: 'all 0.15s ease',
                      boxShadow: apiProvider === 'openrouter' ? '0 0 10px rgba(255, 0, 255, 0.4)' : 'none',
                    }}
                  >
                    {t.form.providerOpenRouter}
                  </button>
                </div>

                {/* Provider Content: GEMINI */}
                {apiProvider === 'gemini' ? (
                  <>
                    {/* Gemini API Key input */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                          {t.form.apiKeyLabel}
                          <span style={{ marginLeft: '0.4rem', fontSize: '0.7rem', fontWeight: 800, color: '#ff1e27', background: 'rgba(255, 30, 39, 0.15)', border: '1px solid #ff1e27', borderRadius: 0, padding: '0.1rem 0.45rem', letterSpacing: '0.05em', boxShadow: '0 0 8px rgba(255, 30, 39, 0.3)' }}>{t.form.apiKeyRequired}</span>
                        </span>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <a
                            href="https://aistudio.google.com/"
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: 'var(--primary)', textDecoration: 'none', fontSize: '0.75rem', fontWeight: 600, transition: 'var(--transition-smooth)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                            className="action-link-btn"
                          >
                            <ExternalLink size={12} /> {t.form.getFreeKey}
                          </a>
                        </div>
                      </label>
                      <HackerApiKeyInput
                        id="gemini-key-input"
                        value={apiKey}
                        onChange={(val) => {
                          setApiKey(val);
                          localStorage.setItem('cheat_clip_gemini_api_key', val);
                          if (val.trim()) setError(null);
                        }}
                        disabled={loading}
                        placeholder={t.form.apiKeyPlaceholder}
                        error={!apiKey.trim()}
                        revealLabel={t.form.revealKey}
                        maskLabel={t.form.maskKey}
                      />
                      {!apiKey.trim() && (
                        <span style={{ fontSize: '0.75rem', color: '#ff1e27', display: 'flex', alignItems: 'center', gap: '0.3rem', fontWeight: 600 }}>
                          <AlertTriangle size={13} color="#ff1e27" />
                          {t.form.apiKeyErrorHint}
                        </span>
                      )}
                    </div>

                    {/* Gemini AI Model Selection */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        <span>{t.form.aiModelLabel}</span>
                        {loadingModels && (
                          <span style={{ fontSize: '0.72rem', color: 'var(--primary)', animation: 'pulse 1.5s infinite ease-in-out' }}>
                            ⏳ {t.form.fetchingModels}
                          </span>
                        )}
                      </label>
                      <select
                        className="form-input"
                        value={selectedModel}
                        onChange={(e) => {
                          setSelectedModel(e.target.value);
                          localStorage.setItem('cheat_clip_selected_model', e.target.value);
                        }}
                        disabled={loading}
                        style={{ padding: '0.6rem 1rem', fontSize: '0.875rem', height: '42px', cursor: 'pointer', appearance: 'auto', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', borderRadius: 0 }}
                      >
                        {availableModels.length > 0 ? (
                          availableModels.map((m) => (
                            <option key={m} value={m} style={{ background: '#0a0a0f', color: '#fff' }}>
                              {m}
                            </option>
                          ))
                        ) : (
                          <>
                            <option value="gemini-2.5-flash" style={{ background: '#0a0a0f', color: '#fff' }}>gemini-2.5-flash (Fast & recommended - Free tier friendly)</option>
                            <option value="gemini-2.5-flash-lite" style={{ background: '#0a0a0f', color: '#fff' }}>gemini-2.5-flash-lite (Ultra-fast & lightweight)</option>
                            <option value="gemini-2.0-flash" style={{ background: '#0a0a0f', color: '#fff' }}>gemini-2.0-flash (Fast & responsive)</option>
                            <option value="gemini-2.0-flash-lite" style={{ background: '#0a0a0f', color: '#fff' }}>gemini-2.0-flash-lite (Lightweight flash)</option>
                            <option value="gemini-1.5-flash" style={{ background: '#0a0a0f', color: '#fff' }}>gemini-1.5-flash (Fallback flash)</option>
                            <option value="gemini-2.5-pro" style={{ background: '#0a0a0f', color: '#fff' }}>gemini-2.5-pro (Creative & complex - High quota)</option>
                          </>
                        )}
                      </select>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.4, marginTop: '0.2rem' }}>
                        NOTE: <strong>{t.form.resilienceTip}</strong> {t.form.resilienceDesc}
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    {/* OpenRouter API Key input */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                          {t.form.openrouterKeyLabel}
                          <span style={{ marginLeft: '0.4rem', fontSize: '0.7rem', fontWeight: 800, color: '#ff1e27', background: 'rgba(255, 30, 39, 0.15)', border: '1px solid #ff1e27', borderRadius: 0, padding: '0.1rem 0.45rem', letterSpacing: '0.05em', boxShadow: '0 0 8px rgba(255, 30, 39, 0.3)' }}>{t.form.apiKeyRequired}</span>
                        </span>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <a
                            href="https://openrouter.ai/settings/keys"
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: 'var(--primary)', textDecoration: 'none', fontSize: '0.75rem', fontWeight: 600, transition: 'var(--transition-smooth)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                            className="action-link-btn"
                          >
                            <ExternalLink size={12} /> {t.form.openrouterGetFreeKey}
                          </a>
                        </div>
                      </label>
                      <HackerApiKeyInput
                        id="openrouter-key-input"
                        value={openRouterKey}
                        onChange={(val) => {
                          setOpenRouterKey(val);
                          localStorage.setItem('cheat_clip_openrouter_key', val);
                          if (val.trim()) setError(null);
                        }}
                        disabled={loading}
                        placeholder={t.form.openrouterKeyPlaceholder}
                        error={!openRouterKey.trim()}
                        revealLabel={t.form.revealKey}
                        maskLabel={t.form.maskKey}
                      />
                      {!openRouterKey.trim() && (
                        <span style={{ fontSize: '0.75rem', color: '#f87171', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /></svg>
                          {t.form.apiKeyErrorHint}
                        </span>
                      )}
                    </div>

                    {/* OpenRouter Model Selection */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                          {t.form.openrouterModelLabel}
                        </label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          {loadingOpenRouterModels && (
                            <span style={{ fontSize: '0.72rem', color: 'var(--primary)', animation: 'pulse 1.5s infinite ease-in-out' }}>
                              ⏳ {t.form.fetchingModels}
                            </span>
                          )}
                          <span
                            onClick={() => setIsCustomOpenRouterModel(!isCustomOpenRouterModel)}
                            style={{
                              cursor: 'pointer',
                              color: isCustomOpenRouterModel ? 'var(--primary)' : 'var(--text-muted)',
                              fontSize: '0.72rem',
                              fontFamily: "'JetBrains Mono', monospace",
                              textDecoration: 'underline'
                            }}
                          >
                            {isCustomOpenRouterModel ? '[SELECT PRESET]' : '[CUSTOM ID]'}
                          </span>
                        </div>
                      </div>

                      {isCustomOpenRouterModel ? (
                        <input
                          type="text"
                          className="form-input"
                          placeholder="e.g. qwen/qwen-2.5-72b-instruct or deepseek/deepseek-r1"
                          value={customOpenRouterModel || openRouterModel}
                          onChange={(e) => {
                            const val = e.target.value.trim();
                            setCustomOpenRouterModel(val);
                            setOpenRouterModel(val);
                            localStorage.setItem('cheat_clip_openrouter_model', val);
                          }}
                          disabled={loading}
                          style={{ height: '42px', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.85rem' }}
                        />
                      ) : (
                        <select
                          className="form-input"
                          value={openRouterModel}
                          onChange={(e) => {
                            setOpenRouterModel(e.target.value);
                            localStorage.setItem('cheat_clip_openrouter_model', e.target.value);
                          }}
                          disabled={loading}
                          style={{ padding: '0.6rem 1rem', fontSize: '0.875rem', height: '42px', cursor: 'pointer', appearance: 'auto', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', borderRadius: 0 }}
                        >
                          {openRouterModels.length > 0 ? (
                            openRouterModels.map((m) => (
                              <option key={m.id} value={m.id} style={{ background: '#0a0a0f', color: '#fff' }}>
                                {m.name || m.id} {m.recommended ? '[RECOMMENDED]' : ''}
                              </option>
                            ))
                          ) : (
                            <>
                              <option value="google/gemini-2.5-flash" style={{ background: '#0a0a0f', color: '#fff' }}>Google: Gemini 2.5 Flash [RECOMMENDED]</option>
                              <option value="google/gemini-2.0-flash-001" style={{ background: '#0a0a0f', color: '#fff' }}>Google: Gemini 2.0 Flash</option>
                              <option value="anthropic/claude-3.5-sonnet" style={{ background: '#0a0a0f', color: '#fff' }}>Anthropic: Claude 3.5 Sonnet [RECOMMENDED]</option>
                              <option value="anthropic/claude-3.5-haiku" style={{ background: '#0a0a0f', color: '#fff' }}>Anthropic: Claude 3.5 Haiku</option>
                              <option value="deepseek/deepseek-chat" style={{ background: '#0a0a0f', color: '#fff' }}>DeepSeek: DeepSeek V3 [RECOMMENDED]</option>
                              <option value="meta-llama/llama-3.3-70b-instruct" style={{ background: '#0a0a0f', color: '#fff' }}>Meta: Llama 3.3 70B Instruct</option>
                              <option value="openai/gpt-4o-mini" style={{ background: '#0a0a0f', color: '#fff' }}>OpenAI: GPT-4o Mini</option>
                              <option value="openai/gpt-4o" style={{ background: '#0a0a0f', color: '#fff' }}>OpenAI: GPT-4o</option>
                              <option value="qwen/qwen-2.5-72b-instruct" style={{ background: '#0a0a0f', color: '#fff' }}>Qwen: Qwen 2.5 72B Instruct</option>
                              <option value="mistralai/mistral-large-2411" style={{ background: '#0a0a0f', color: '#fff' }}>Mistral: Mistral Large 2</option>
                              <option value="google/gemini-2.5-pro" style={{ background: '#0a0a0f', color: '#fff' }}>Google: Gemini 2.5 Pro</option>
                            </>
                          )}
                        </select>
                      )}
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.4, marginTop: '0.2rem', display: 'flex', alignItems: 'flex-start', gap: '0.35rem' }}>
                        <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0, marginTop: '1px', opacity: 0.7 }}><path d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1zm0 1.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 5a.75.75 0 1 1 0 1.5A.75.75 0 0 1 8 5zm-.75 2.5h1.5v4h-1.5v-4z"/></svg>
                        <span><strong>Same-Family Fallback:</strong> {t.form.openrouterResilienceDesc}</span>
                      </span>
                    </div>
                  </>
                )}

              </div>


</>;}
