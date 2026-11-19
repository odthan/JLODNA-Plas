'use strict';
// Provider abstraction. Normalized messages:
//  {role:'user', text} | {role:'assistant', text, calls:[{id,name,input}]} | {role:'tool', results:[{id,name,output}]}
// Env: AI_PROVIDER = anthropic (default) | openai (Chat Completions, any OpenAI-compatible API) | openai-responses (OpenAI Responses API : GPT-6.2 Astra / Sol)
//      AI_API_KEY, AI_MODEL, AI_BASE_URL (optional), AI_REASONING_EFFORT (optional, openai-responses : low | medium | high)

const TIMEOUT_MS = 25000;

function config() {
  const provider = (process.env.AI_PROVIDER || 'anthropic').toLowerCase();
  const key = process.env.AI_API_KEY;
  const model = process.env.AI_MODEL || (provider === 'anthropic' ? 'claude-haiku-5-5' : provider === 'openai-responses' ? 'gpt-6.2-sol' : '');
  if (!key || !model) return null;
  return { provider, key, model, baseUrl: process.env.AI_BASE_URL };
}

async function post(url, headers, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`LLM_${r.status}`);
  return r.json();
}

const anthropic = {
  async step(cfg, { system, messages, tools }) {
    const msgs = messages.map((m) => {
      if (m.role === 'user') return { role: 'user', content: m.text };
      if (m.role === 'assistant') {
        const content = [];
        if (m.text) content.push({ type: 'text', text: m.text });
        for (const c of m.calls || []) content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input });
        return { role: 'assistant', content };
      }
      return {
        role: 'user',
        content: m.results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.output })),
      };
    });
    const data = await post(
      `${(cfg.baseUrl || 'https://api.anthropic.com').replace(/\/$/, '')}/v1/messages`,
      { 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01' },
      {
        model: cfg.model,
        max_tokens: 900,
        system,
        messages: msgs,
        tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema })),
      }
    );
    const blocks = data.content || [];
    return {
      text: blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim(),
      calls: blocks.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, input: b.input || {} })),
    };
  },
};

const openai = {
  async step(cfg, { system, messages, tools }) {
    const msgs = [{ role: 'system', content: system }];
    for (const m of messages) {
      if (m.role === 'user') msgs.push({ role: 'user', content: m.text });
      else if (m.role === 'assistant') {
        const o = { role: 'assistant', content: m.text || null };
        if (m.calls && m.calls.length) {
          o.tool_calls = m.calls.map((c) => ({
            id: c.id,
            type: 'function',
            function: { name: c.name, arguments: JSON.stringify(c.input || {}) },
          }));
        }
        msgs.push(o);
      } else {
        for (const r of m.results) msgs.push({ role: 'tool', tool_call_id: r.id, content: r.output });
      }
    }
    const data = await post(
      `${(cfg.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')}/chat/completions`,
      { Authorization: `Bearer ${cfg.key}` },
      {
        model: cfg.model,
        max_tokens: 900,
        messages: msgs,
        tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema } })),
      }
    );
    const msg = (data.choices && data.choices[0] && data.choices[0].message) || {};
    return {
      text: (msg.content || '').trim(),
      calls: (msg.tool_calls || []).map((c) => {
        let input = {};
        try { input = JSON.parse(c.function.arguments || '{}'); } catch (_) { /* ignore */ }
        return { id: c.id, name: c.function.name, input };
      }),
    };
  },
};

// OpenAI Responses API (client.responses.create) — recommandé pour les modèles GPT-6.2 (gpt-6.2-astra, gpt-6.2-sol).
// Même principe que le SDK officiel, mais en appel HTTP direct : aucune dépendance à installer, la clé reste côté serveur.
const openaiResponses = {
  async step(cfg, { system, messages, tools }) {
    const input = [];
    for (const m of messages) {
      if (m.role === 'user') input.push({ role: 'user', content: m.text });
      else if (m.role === 'assistant') {
        if (m.text) input.push({ role: 'assistant', content: m.text });
        for (const c of m.calls || []) input.push({ type: 'function_call', call_id: c.id, name: c.name, arguments: JSON.stringify(c.input || {}) });
      } else for (const r of m.results) input.push({ type: 'function_call_output', call_id: r.id, output: r.output });
    }
    const body = {
      model: cfg.model,
      instructions: system,
      input,
      store: false, // les conversations clients ne sont pas conservées chez OpenAI
      max_output_tokens: 2000, // marge pour le raisonnement du modèle + la réponse
    };
    if (tools.length) body.tools = tools.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.schema }));
    if (process.env.AI_REASONING_EFFORT) body.reasoning = { effort: process.env.AI_REASONING_EFFORT };
    const data = await post(`${(cfg.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')}/responses`, { Authorization: `Bearer ${cfg.key}` }, body);
    const out = Array.isArray(data.output) ? data.output : [];
    const text = typeof data.output_text === 'string' && data.output_text
      ? data.output_text
      : out.filter((o) => o.type === 'message').flatMap((o) => o.content || []).filter((c) => c.type === 'output_text').map((c) => c.text).join('\n');
    return {
      text: (text || '').trim(),
      calls: out.filter((o) => o.type === 'function_call').map((o) => {
        let inp = {};
        try { inp = JSON.parse(o.arguments || '{}'); } catch (_) { /* ignore */ }
        return { id: o.call_id, name: o.name, input: inp };
      }),
    };
  },
};

const ADAPTERS = { anthropic, openai, 'openai-responses': openaiResponses };

function getLLM() {
  const cfg = config();
  if (!cfg) return null;
  const adapter = ADAPTERS[cfg.provider];
  if (!adapter) return null;
  return { step: (args) => adapter.step(cfg, args) };
}

module.exports = { getLLM, ADAPTERS };
