import { useState, useRef, useEffect } from 'react';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';
import { MessageSquare, Send, MoreVertical, Plus, History, Trash2, X } from 'lucide-react';

function formatChatMoney(value) {
  const amount = Number(value);
  return `Rs ${new Intl.NumberFormat('en-PK', { maximumFractionDigits: 2 }).format(Number.isFinite(amount) ? amount : 0)}`;
}

function newConversation() {
  return {
    id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title: 'New chat',
    updatedAt: new Date().toISOString(),
    messages: [],
  };
}

function loadConversations(storageKey) {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) return parsed.filter((chat) => Array.isArray(chat?.messages) && chat.messages.length > 0);
      if (Array.isArray(parsed.conversations)) return parsed.conversations.filter((chat) => Array.isArray(chat?.messages) && chat.messages.length > 0);
    }

    // Migrate the old single-conversation storage on this browser.
    const legacy = JSON.parse(localStorage.getItem('stockroom-chat') || '[]');
    if (Array.isArray(legacy) && legacy.length) {
      const migrated = [{ ...newConversation(), title: 'Previous chat', messages: legacy }];
      localStorage.setItem(storageKey, JSON.stringify(migrated));
      return migrated;
    }
  } catch {
    // Ignore invalid or unavailable browser storage.
  }
  return [];
}

export default function ChatWidget() {
  const { user } = useAuth();
  const storageKey = `stockroom-chats-${user?.id ?? user?.email ?? 'guest'}`;
  const [open, setOpen] = useState(false);
  const [conversations, setConversations] = useState(() => loadConversations(storageKey));
  const [activeId, setActiveId] = useState(() => loadConversations(storageKey)[0]?.id ?? null);
  const [loadedStorageKey, setLoadedStorageKey] = useState(storageKey);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const bottomRef = useRef(null);
  const chatWrapRef = useRef(null);
  const chatMenuRef = useRef(null);

  useEffect(() => {
    const saved = loadConversations(storageKey);
    setConversations(saved);
    setActiveId(saved[0]?.id ?? null);
    setLoadedStorageKey(storageKey);
  }, [storageKey]);

  useEffect(() => {
    if (loadedStorageKey !== storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(conversations));
    } catch {
      // Chat history remains usable for the current session if storage is full.
    }
  }, [conversations, loadedStorageKey, storageKey]);

  const activeChat = conversations.find((chat) => chat.id === activeId);
  const messages = activeChat?.messages ?? [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  useEffect(() => {
    if (!open && !menuOpen) return undefined;
    function closeOnOutsidePointer(event) {
      const target = event.target;
      if (open && chatWrapRef.current && !chatWrapRef.current.contains(target)) {
        setOpen(false);
        setMenuOpen(false);
        setHistoryOpen(false);
      } else if (menuOpen && chatMenuRef.current && !chatMenuRef.current.contains(target)) {
        setMenuOpen(false);
        setHistoryOpen(false);
      }
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [open, menuOpen]);

  function appendMessage(chatId, message) {
    setConversations((current) => current.map((chat) => {
      if (chat.id !== chatId) return chat;
      const firstUserMessage = message.role === 'user' && !chat.messages.some((item) => item.role === 'user');
      const title = firstUserMessage ? message.text.slice(0, 48) + (message.text.length > 48 ? '…' : '') : chat.title;
      return {
        ...chat,
        title,
        updatedAt: new Date().toISOString(),
        messages: [...chat.messages, message],
      };
    }));
  }

  function startNewChat() {
    // A new conversation stays a draft until the user sends its first message.
    // Repeated clicks while already on an empty draft never create extra rows.
    if (activeId !== null && activeChat?.messages.length) setActiveId(null);
    setHistoryOpen(false);
    setMenuOpen(false);
  }

  function deleteCurrentChat() {
    if (!activeChat) {
      setMenuOpen(false);
      return;
    }
    const remaining = conversations.filter((chat) => chat.id !== activeId);
    setConversations(remaining);
    setActiveId(remaining[0]?.id ?? null);
    setHistoryOpen(false);
    setMenuOpen(false);
  }

  function describeAction(action) {
    const failed = action.result && typeof action.result === 'object' && 'error' in action.result;
    if (failed) return { failed: true, text: `${action.tool} failed: ${action.result.error}` };
    if (action.tool === 'adjust_stock') return { failed: false, text: `Adjusted ${action.result.product}: ${action.result.previousStock} → ${action.result.newStock}` };
    if (action.tool === 'record_sale') return { failed: false, text: `Recorded sale: ${action.result.quantity}× ${action.result.product} (${formatChatMoney(action.result.revenue)})` };
    if (action.tool === 'create_reorder_suggestion') return { failed: false, text: `Created reorder suggestion for ${action.result.product}` };
    return { failed: false, text: `${action.tool} executed` };
  }

  async function handleSend(event) {
    event.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    const history = messages.map(({ role, text: content }) => ({ role, content }));
    let chatId = activeId;
    const userMessage = { role: 'user', text };
    if (!chatId) {
      const chat = { ...newConversation(), title: text.slice(0, 48) + (text.length > 48 ? '…' : ''), messages: [userMessage] };
      chatId = chat.id;
      setConversations((current) => [chat, ...current]);
      setActiveId(chatId);
    } else {
      appendMessage(chatId, userMessage);
    }
    setInput('');
    setLoading(true);

    try {
      const response = await api.sendChatMessage(text, history);
      appendMessage(chatId, { role: 'assistant', text: response.reply, items: response.items, actions: response.actions });
    } catch (error) {
      appendMessage(chatId, { role: 'assistant', text: `Error: ${error.message}` });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="chat-wrap" ref={chatWrapRef}>
      {open && (
        <div className="chat-panel">
          <div className="chat-header">
            <i className="ti ti-robot" aria-hidden="true" />
            <span className="chat-title">{activeChat?.title || 'Stockroom Assistant'}</span>
            <div className="chat-menu-wrap" ref={chatMenuRef}>
              <button className="chat-menu-trigger" type="button" aria-label="Chat options" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}>
                <MoreVertical size={18} />
              </button>
              {menuOpen && (
                <div className="chat-dropdown" role="menu">
                  <button type="button" role="menuitem" onClick={startNewChat}><Plus size={15} /> New chat</button>
                  <button type="button" role="menuitem" onClick={() => setHistoryOpen((value) => !value)}><History size={15} /> {historyOpen ? 'Hide history' : 'Chat history'}</button>
                  <button type="button" role="menuitem" className="danger" disabled={!activeChat} onClick={deleteCurrentChat}><Trash2 size={15} /> Delete this chat</button>
                  {historyOpen && (
                    <div className="chat-history-list">
                      {conversations.length === 0 && <div className="chat-history-empty">No saved chats yet.</div>}
                      {conversations
                        .slice()
                        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
                        .map((chat) => (
                          <button type="button" role="menuitem" key={chat.id} className={chat.id === activeId ? 'selected' : ''} onClick={() => { setActiveId(chat.id); setMenuOpen(false); setHistoryOpen(false); }}>
                            <span>{chat.title || 'New chat'}</span>
                            <small>{chat.messages.length} messages</small>
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <button className="chat-close" aria-label="Close chat" onClick={() => setOpen(false)}><X size={17} /></button>
          </div>
          <div className="chat-messages">
            {messages.length === 0 && (
              <div className="chat-empty">
                Ask about product forecasts, monthly sales, stock levels, or what to reorder.
              </div>
            )}
            {messages.map((message, index) => (
              <div key={`${activeId}-${index}`} className={`chat-bubble ${message.role}`}>
                {message.text}
                {message.items?.length > 0 && (
                  <div className="chat-items">
                    {message.items.map((item, itemIndex) => (
                      <div className="chat-item-row" key={itemIndex}>
                        <span>{item.name}</span>
                        <span>
                          {item.stock !== undefined && (item.stock === 0 ? 'Out of stock' : `${item.stock} in stock`)}
                          {item.reorderQty !== undefined && ` · order ${item.reorderQty}`}
                          {item.salePrice !== undefined && formatChatMoney(item.salePrice)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {message.actions?.length > 0 && (
                  <div className="chat-actions">
                    {message.actions.map((action, actionIndex) => {
                      const description = describeAction(action);
                      return <div className={`chat-action-chip ${description.failed ? 'failed' : ''}`} key={actionIndex}><i className={`ti ${description.failed ? 'ti-x' : 'ti-check'}`} aria-hidden="true" />{description.text}</div>;
                    })}
                  </div>
                )}
              </div>
            ))}
            {loading && <div className="chat-bubble assistant chat-typing">Checking your stockroom and sales…</div>}
            <div ref={bottomRef} />
          </div>
          <form className="chat-input-row" onSubmit={handleSend}>
            <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask about stock, sales, or forecasts…" />
            <button type="submit" className="btn btn-primary" disabled={loading}><Send size={18} color="#ffffff" /></button>
          </form>
        </div>
      )}
      <button className="chat-fab" aria-label={open ? 'Close assistant' : 'Open assistant'} onClick={() => setOpen((value) => !value)}>
        {open ? <X size={22} color="#ffffff" /> : <MessageSquare size={22} color="#ffffff" />}
      </button>
    </div>
  );
}
