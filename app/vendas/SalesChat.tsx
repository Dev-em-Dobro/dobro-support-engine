'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface Source {
  documentId: string;
  title: string;
  versionId: string;
  chunkId: string;
  score: number;
  citation: number;
}

interface Message {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  objectionOptions?: string[];
}

interface Conversation {
  id: string;
  title: string | null;
  messageCount: number;
  updatedAt: string;
}

interface Props {
  userEmail: string;
}

function CitationChip({ source }: { source: Source }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block">
      <button
        onClick={() => setOpen((o) => !o)}
        className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-dobro-azul/15 text-[10px] font-bold text-dobro-azul hover:bg-dobro-azul/30 transition-colors"
        aria-label={`Fonte ${source.citation}: ${source.title}`}
      >
        {source.citation}
      </button>
      {open && (
        <div className="absolute bottom-6 left-0 z-10 w-64 rounded-lg border border-dobro-cinza-escuro/15 bg-white p-3 shadow-lg text-sm">
          <p className="font-semibold text-dobro-azul mb-1">{source.title}</p>
          <p className="text-xs text-dobro-cinza-escuro/60">score: {source.score.toFixed(3)}</p>
          <button
            onClick={() => setOpen(false)}
            className="absolute top-1.5 right-2 text-dobro-cinza-escuro/40 hover:text-dobro-cinza-escuro"
          >
            ×
          </button>
        </div>
      )}
    </span>
  );
}

function renderWithCitations(content: string, sources?: Source[]) {
  if (!sources?.length) return <span>{content}</span>;

  const parts = content.split(/(\[\d+\])/g);
  return (
    <>
      {parts.map((part, i) => {
        const match = part.match(/^\[(\d+)\]$/);
        if (match) {
          const num = parseInt(match[1], 10);
          const source = sources.find((s) => s.citation === num);
          if (source) return <CitationChip key={i} source={source} />;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

function ObjectionToggle({
  active,
  onChange,
  disabled,
}: {
  active: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      aria-label="Modo Quebra de Objeção"
      disabled={disabled}
      onClick={() => onChange(!active)}
      className={`group inline-flex items-center gap-2 rounded-full border px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
        active
          ? 'border-dobro-laranja/30 bg-dobro-laranja/10 text-dobro-laranja'
          : 'border-dobro-cinza-escuro/15 bg-white text-dobro-cinza-escuro/60 hover:bg-gray-50'
      }`}
    >
      <span
        className={`relative h-4 w-7 flex-shrink-0 rounded-full transition-colors ${
          active ? 'bg-dobro-laranja' : 'bg-dobro-cinza-escuro/20'
        }`}
      >
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${
            active ? 'translate-x-3.5' : 'translate-x-0.5'
          }`}
        />
      </span>
      <span className="flex items-center gap-1">
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        Modo Quebra de Objeção
      </span>
    </button>
  );
}

function ObjectionOptionCard({ text, index }: { text: string; index: number }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  return (
    <div className="group relative rounded-xl border border-dobro-laranja/15 bg-white p-3 pr-10 shadow-sm transition-colors hover:border-dobro-laranja/40">
      <span className="absolute -left-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-dobro-laranja text-[10px] font-bold text-white">
        {index + 1}
      </span>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-dobro-cinza-escuro">{text}</p>
      <button
        type="button"
        onClick={copy}
        aria-label="Copiar mensagem"
        className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-lg text-dobro-cinza-escuro/40 transition-colors hover:bg-dobro-laranja/10 hover:text-dobro-laranja"
      >
        {copied ? (
          <svg className="h-4 w-4 text-dobro-amarelo" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        )}
      </button>
    </div>
  );
}

export function SalesChat({ userEmail }: Props) {
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [isObjectionMode, setIsObjectionMode] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadConversations = useCallback(async () => {
    const res = await fetch('/api/vendas/conversations');
    if (res.ok) {
      const data = await res.json();
      setConversations(data.conversations);
    }
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function selectConversation(id: string) {
    setActiveConvId(id);
    setMessages([]);
    setLoadingHistory(true);
    const res = await fetch(`/api/vendas/conversations/${id}/messages`);
    if (res.ok) {
      const data = await res.json();
      setMessages(data.messages);
    }
    setLoadingHistory(false);
  }

  function startNewConversation() {
    setActiveConvId(null);
    setMessages([]);
    setInput('');
  }

  async function deleteConversation(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm('Deletar essa conversa?')) return;
    await fetch(`/api/vendas/conversations/${id}`, { method: 'DELETE' });
    if (activeConvId === id) startNewConversation();
    await loadConversations();
  }

  async function sendMessage(e?: React.FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || streaming) return;

    setInput('');
    setStreaming(true);

    const userMsg: Message = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);

    const assistantPlaceholder: Message = { role: 'assistant', content: '' };
    setMessages((prev) => [...prev, assistantPlaceholder]);

    try {
      const res = await fetch('/api/vendas/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: activeConvId, message: text, isObjectionMode }),
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: 'erro desconhecido' }));
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { role: 'assistant', content: `Erro: ${err.error}` };
          return next;
        });
        setStreaming(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalSources: Source[] = [];
      let finalConvId = activeConvId;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'token') {
              setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                next[next.length - 1] = { ...last, content: last.content + data.content };
                return next;
              });
            } else if (data.type === 'objection') {
              setMessages((prev) => {
                const next = [...prev];
                next[next.length - 1] = { role: 'assistant', content: '', objectionOptions: data.options };
                return next;
              });
            } else if (data.type === 'done') {
              finalSources = data.sources ?? [];
              finalConvId = data.conversationId;
              setMessages((prev) => {
                const next = [...prev];
                next[next.length - 1] = { ...next[next.length - 1], sources: finalSources };
                return next;
              });
              if (!activeConvId && finalConvId) {
                setActiveConvId(finalConvId);
                await loadConversations();
              } else {
                await loadConversations();
              }
            } else if (data.type === 'error') {
              setMessages((prev) => {
                const next = [...prev];
                next[next.length - 1] = { role: 'assistant', content: `Erro: ${data.message}` };
                return next;
              });
            }
          } catch {}
        }
      }
    } catch (err) {
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = { role: 'assistant', content: 'Falha de conexão. Tenta novamente.' };
        return next;
      });
    } finally {
      setStreaming(false);
      textareaRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  async function logout() {
    await fetch('/api/vendas/auth/logout', { method: 'POST' });
    router.push('/vendas/login');
  }

  return (
    <div className="flex h-[calc(100vh-14rem)] min-h-[480px] overflow-hidden rounded-xl border border-dobro-cinza-escuro/10 bg-gray-50">
      <aside className="flex w-64 flex-shrink-0 flex-col border-r border-dobro-cinza-escuro/10 bg-white">
        <div className="p-4 border-b border-dobro-cinza-escuro/10">
          <p className="font-titulo text-xs font-bold uppercase tracking-widest text-dobro-azul mb-3">
            Agente de Vendas
          </p>
          <button
            onClick={startNewConversation}
            className="w-full rounded-md bg-dobro-azul px-3 py-2 text-sm font-semibold text-white hover:bg-dobro-azul/90 transition-colors"
          >
            + Nova conversa
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 && (
            <p className="px-4 py-6 text-center text-xs text-dobro-cinza-escuro/40">
              Nenhuma conversa ainda
            </p>
          )}
          {conversations.map((conv) => (
            <div
              key={conv.id}
              onClick={() => selectConversation(conv.id)}
              className={`group flex cursor-pointer items-center gap-2 px-3 py-2.5 border-b border-dobro-cinza-escuro/5 hover:bg-gray-50 transition-colors ${
                activeConvId === conv.id ? 'bg-dobro-azul/5 border-l-2 border-l-dobro-azul' : ''
              }`}
            >
              <span className="flex-1 truncate text-sm text-dobro-cinza-escuro">
                {conv.title ?? 'Nova conversa'}
              </span>
              <button
                onClick={(e) => deleteConversation(conv.id, e)}
                className="hidden group-hover:flex h-5 w-5 items-center justify-center rounded text-dobro-cinza-escuro/40 hover:text-red-500 hover:bg-red-50"
                aria-label="Deletar conversa"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <div className="border-t border-dobro-cinza-escuro/10 p-3">
          <p className="truncate text-xs text-dobro-cinza-escuro/60 mb-2">{userEmail}</p>
          <Link
            href="/vendas/como-funciona"
            className="mb-1.5 block w-full rounded-md border border-dobro-cinza-escuro/15 px-3 py-1.5 text-center text-xs text-dobro-cinza-escuro/70 hover:bg-gray-50 transition-colors"
          >
            Como funciona
          </Link>
          <button
            onClick={logout}
            className="w-full rounded-md border border-dobro-cinza-escuro/15 px-3 py-1.5 text-xs text-dobro-cinza-escuro/70 hover:bg-gray-50 transition-colors"
          >
            Sair
          </button>
        </div>
      </aside>

      <main className="flex flex-1 flex-col overflow-hidden">
        {isObjectionMode && (
          <div className="flex items-center gap-2 border-b border-dobro-laranja/15 bg-dobro-laranja/5 px-4 py-2">
            <svg className="h-4 w-4 flex-shrink-0 text-dobro-laranja" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <p className="text-xs font-semibold text-dobro-laranja">
              Modo Quebra de Objeção ativo
            </p>
            <span className="text-xs text-dobro-cinza-escuro/50">
              · cole a fala do lead e receba 3 respostas prontas
            </span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-6">
          {messages.length === 0 && !loadingHistory && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              {isObjectionMode ? (
                <>
                  <div className="rounded-full bg-dobro-laranja/10 p-4">
                    <svg className="h-8 w-8 text-dobro-laranja" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <p className="text-lg font-semibold text-dobro-cinza-escuro">Quebra de Objeção</p>
                  <p className="max-w-sm text-sm text-dobro-cinza-escuro/60">
                    Cole exatamente o que o lead falou (ex: <span className="italic">&quot;tá caro&quot;, &quot;não tenho tempo&quot;</span>) e receba 3 mensagens curtas prontas pra responder no WhatsApp.
                  </p>
                </>
              ) : (
                <>
                  <div className="rounded-full bg-dobro-azul/10 p-4">
                    <svg className="h-8 w-8 text-dobro-azul" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </div>
                  <p className="text-lg font-semibold text-dobro-cinza-escuro">Como posso ajudar?</p>
                  <p className="max-w-sm text-sm text-dobro-cinza-escuro/60">
                    Pergunte sobre produtos, lançamentos, preços ou política comercial da Dev em Dobro.
                  </p>
                </>
              )}
            </div>
          )}

          {loadingHistory && (
            <div className="flex justify-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-dobro-azul border-t-transparent" />
            </div>
          )}

          <div className="mx-auto max-w-2xl space-y-4">
            {messages.map((msg, i) => {
              if (msg.role === 'assistant' && msg.objectionOptions?.length) {
                return (
                  <div key={i} className="flex justify-start">
                    <div className="w-full max-w-[95%] space-y-2.5">
                      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-dobro-laranja">
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        3 respostas sugeridas
                      </p>
                      <div className="space-y-3">
                        {msg.objectionOptions.map((opt, idx) => (
                          <ObjectionOptionCard key={idx} text={opt} index={idx} />
                        ))}
                      </div>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={i}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-dobro-azul text-white'
                        : 'bg-white text-dobro-cinza-escuro shadow-sm ring-1 ring-dobro-cinza-escuro/8'
                    }`}
                  >
                    {msg.role === 'assistant' ? (
                      <p className="whitespace-pre-wrap">
                        {renderWithCitations(msg.content, msg.sources)}
                      </p>
                    ) : (
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    )}
                    {msg.role === 'assistant' && !msg.content && streaming && (
                      <span className="inline-block h-4 w-1 animate-pulse bg-dobro-cinza-escuro/40" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-dobro-cinza-escuro/10 bg-white px-4 py-3">
          <div className="mx-auto max-w-2xl">
            <div className="mb-2 flex items-center justify-between">
              <ObjectionToggle
                active={isObjectionMode}
                onChange={setIsObjectionMode}
                disabled={streaming}
              />
            </div>
            <form onSubmit={sendMessage} className="flex gap-2">
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                isObjectionMode
                  ? 'Cole a fala do lead... (ex: "tá muito caro pra mim agora")'
                  : 'Escreva sua pergunta... (Enter para enviar, Shift+Enter para nova linha)'
              }
              disabled={streaming}
              className={`max-h-40 flex-1 resize-none overflow-y-auto rounded-xl border bg-white px-4 py-2.5 text-sm text-dobro-cinza-escuro placeholder:text-dobro-cinza-escuro/40 focus:outline-none focus:ring-2 disabled:opacity-50 transition-colors ${
                isObjectionMode
                  ? 'border-dobro-laranja/40 focus:border-dobro-laranja focus:ring-dobro-laranja/20'
                  : 'border-dobro-cinza-escuro/15 focus:border-dobro-azul focus:ring-dobro-azul/20'
              }`}
            />
            <button
              type="submit"
              disabled={streaming || !input.trim()}
              className={`rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40 transition-colors ${
                isObjectionMode
                  ? 'bg-dobro-laranja hover:bg-dobro-laranja/90'
                  : 'bg-dobro-azul hover:bg-dobro-azul/90'
              }`}
              aria-label="Enviar mensagem"
            >
              {streaming ? (
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                </svg>
              )}
            </button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
