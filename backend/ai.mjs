// backend/ai.mjs — Callable DeepAIChat module
//
// USAGE AS A LIBRARY:
//   import { DeepAIChat } from './ai.mjs';
//   const chat = new DeepAIChat();
//   const reply = await chat.sendMessage("Hello");
//   await chat.close();
//
// USAGE AS CLI (only runs when executed directly):
//   node .\backend\ai.mjs "Explain recursion in one line"
//   node .\backend\ai.mjs              (interactive)

import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import {
    Session,
    ClientIdentifier,
    initTLS,
    destroyTLS,
} from 'node-tls-client';

// ── Module-level TLS init (runs once, shared by all instances) ──────────────
let _tlsReady = null;
let _tlsRefCount = 0;

async function ensureTLS() {
    if (!_tlsReady) {
        _tlsReady = initTLS();
    }
    await _tlsReady;
    _tlsRefCount++;
}

async function releaseTLS() {
    _tlsRefCount = Math.max(0, _tlsRefCount - 1);
    if (_tlsRefCount === 0 && _tlsReady) {
        await destroyTLS().catch(() => {});
        _tlsReady = null;
    }
}

function isErrorHtmlPage(text) {
    const head = String(text || '').trimStart().slice(0, 200).toLowerCase();
    return head.startsWith('<!doctype html') || head.startsWith('<html');
}

// ── Default system prompt (GPT-4o style) ────────────────────────────────────
export const SYSTEM_PROMPT =
    "You are a helpful assistant in the style of GPT-4o. " +
    "Answer concisely and accurately. Use short paragraphs, bullets, or code blocks " +
    "when they help. Do not add filler like 'Sure!' or 'Certainly!'. " +
    "If code is requested, return only clean, runnable code with a one-line explanation.";

// ── DeepAIChat class ────────────────────────────────────────────────────────
export class DeepAIChat {
    constructor({
        apiKey = process.env.DEEPAI_API_KEY || "tryit-166042525-0a44a852a0382d1cf77652583233f71f",
        model = process.env.DEEPAI_MODEL || "deepseek-v3.2",
        maxHistory = 12,
        sessionUuid = null,
        systemPrompt = SYSTEM_PROMPT,
        timeout = 30000,
    } = {}) {
        this.apiKey = apiKey;
        this.model = model;
        this.maxHistory = maxHistory;
        this.systemPrompt = systemPrompt;
        this.timeout = timeout;

        // Falls back to the values baked in here if DEEPAI_URL/DEEPAI_COOKIES
        // aren't set — but note these are scraped/spoofed-browser cookies,
        // not a real API credential. They will go stale; when they do, this
        // whole client needs replacing with a real provider (see README note
        // in ai.mjs's module header / the conversation this was built from).
        this.url = process.env.DEEPAI_URL || "https://api.deepai.org/hacking_is_a_serious_crime";
        this.cookies = process.env.DEEPAI_COOKIES || "_twpid=tw.1785967901509.377791771355769826; _kad=1785967901644.138a71bf-e44d-45d0-a136-25c7a53e9bb6; _fbp=fb.1.1785967901808.706774540582521004; _ga=GA1.1.1991907555.1785967903; _gcl_au=1.1.1524720683.1785967903; deepai_device_id=b-lbw27Ee-3dC9p4FXV9fopzJfZ4SCvfF8K9_Ytk_p0; deepai_privacy_prefs=%7B%22analytics%22%3Atrue%2C%22ads%22%3Atrue%2C%22audiences%22%3Atrue%2C%22third_party%22%3Atrue%2C%22training%22%3Atrue%2C%22marketing%22%3Atrue%7D; __obref=b0509c68-c31c-4ad1-8272-b577dc2a8727; _tt_enable_cookie=1; _ttp=01M1EFFFJ0AJ0Y3A6K62ZPA7Z9_.tt.1; _ga_GY2GHX2J9Y=GS2.1.s1788266133$o3$g1$t1788266271$j57$l0$h0; _uetsid=a0c2eb40a60111f18e760bde55af16fa; _uetvid=a0c3d7c0a60111f1be1939178671cc37; _twsid=%7B%22id%22%3A%221788266132190-910031960%22%2C%22ct%22%3A1%2C%22ts%22%3A1788266279873%7D; user_sees_ads=true; ttcsid=1788266135119::qnPE0zWyu5NnsWC-LVjb.1.1788266315084.0::1.133293.137754::179923.13.946.1155::113128.2.0; ttcsid_DAAL8KRC77U44RJM9S10=1788266135117::vnm2Hyrdqj_8e2jLFgL9.1.1788266315084.1";

        this.chatHistory = systemPrompt
            ? [{ role: "user", content: systemPrompt }]
            : [];
        this.sessionUuid = sessionUuid || randomUUID();
        this.sensitivityId = randomUUID();

        this._client = null;
        this._closed = false;
    }

    // Lazily create the TLS session on first use
    async _getClient() {
        if (this._closed) throw new Error("DeepAIChat instance is closed");
        if (!this._client) {
            await ensureTLS();
            this._client = new Session({
                clientIdentifier: ClientIdentifier.chrome_120,
                timeout: this.timeout,
            });
        }
        return this._client;
    }

    async sendMessage(prompt) {
        if (typeof prompt !== "string" || prompt.trim() === "") {
            throw new TypeError("sendMessage(prompt) requires a non-empty string");
        }

        this.chatHistory.push({ role: "user", content: prompt });
        if (this.chatHistory.length > this.maxHistory) {
            const system = this.systemPrompt ? [this.chatHistory[0]] : [];
            const rest = this.chatHistory.slice(-(this.maxHistory - system.length));
            this.chatHistory = [...system, ...rest];
        }

        const historyJson = JSON.stringify(this.chatHistory);
        const boundary = '----WebKitFormBoundary' + randomUUID().replace(/-/g, '').substring(0, 16);

        const fields = [
            ['chat_style', 'chat'],
            ['chatHistory', historyJson],
            ['model', this.model],
            ['session_uuid', this.sessionUuid],
            ['sensitivity_request_id', this.sensitivityId],
            ['tool_activity_support', '1'],
            ['thinking_image_tool_support', '1'],
            ['hacker_is_stinky', 'very_stinky'],
            ['enabled_tools', '["image_generator","image_editor"]'],
        ];

        let body = '';
        for (const [name, value] of fields) {
            body += `--${boundary}\r\n`;
            body += `Content-Disposition: form-data; name="${name}"\r\n\r\n`;
            body += `${value}\r\n`;
        }
        body += `--${boundary}--\r\n`;

        const headers = {
            "accept": "*/*",
            "accept-language": "en-US,en;q=0.9,ur;q=0.8",
            "api-key": this.apiKey,
            "content-type": `multipart/form-data; boundary=${boundary}`,
            "content-length": String(Buffer.byteLength(body, 'utf8')),
            "priority": "u=1, i",
            "sec-ch-ua": '"Not;A=Brand";v="99", "Google Chrome";v="120", "Chromium";v="120"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Linux"',
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-site",
            "origin": "https://deepai.org",
            "cookie": this.cookies,
            "referer": "https://deepai.org/",
        };

        // The site occasionally CSRF-blocks a request (Forbidden HTML page,
        // not JSON) even with valid cookies — empirically this is flaky per
        // TLS session rather than the cookies being truly dead, so retry
        // once on a brand-new session before giving up. Without this, the
        // raw HTML error page would otherwise get treated as the "answer".
        let response, rawBody;
        for (let attempt = 0; attempt < 2; attempt++) {
            const client = await this._getClient();
            response = await client.post(this.url, { headers, body });
            rawBody = await response.text();

            if (isErrorHtmlPage(rawBody)) {
                if (attempt === 0) {
                    await this._client?.close().catch(() => {});
                    this._client = null;
                    continue;
                }
                throw new Error(
                    `DeepAI request blocked (CSRF/Forbidden) after retrying with a fresh session. ` +
                    `The scraped session cookies likely need refreshing (DEEPAI_COOKIES in .env). Status=${response.status}`
                );
            }
            break;
        }

        if (!rawBody) {
            throw new Error(`Empty response body. Status=${response.status}`);
        }

        let assistantContent;
        try {
            const data = JSON.parse(rawBody);
            assistantContent = data.output || data.response || rawBody;
            // Some response shapes nest the actual text one level deeper
            // (e.g. {output: {text: "..."}}) instead of a plain string —
            // without this, String(assistantContent) below would silently
            // stringify the object to the literal text "[object Object]".
            if (assistantContent && typeof assistantContent === 'object') {
                assistantContent =
                    assistantContent.text ||
                    assistantContent.content ||
                    assistantContent.message ||
                    JSON.stringify(assistantContent);
            }
        } catch (_) {
            assistantContent = rawBody;
        }

        // Handle SSE streaming chunks
        if (typeof assistantContent === 'string' && assistantContent.includes('data:')) {
            const chunks = assistantContent
                .split('\n')
                .filter(line => line.startsWith('data:'))
                .map(line => line.replace(/^data:\s*/, '').trim())
                .filter(chunk => chunk && chunk !== '[DONE]');

            const joined = chunks
                .map(chunk => {
                    try {
                        const j = JSON.parse(chunk);
                        return j.output || j.response || j.delta || '';
                    } catch {
                        return chunk;
                    }
                })
                .join('');

            if (joined) assistantContent = joined;
        }

        assistantContent = String(assistantContent).trim();

        if (!assistantContent) {
            throw new Error(
                `Empty assistant content. Status=${response.status}. ` +
                `Raw (first 500): ${String(rawBody).slice(0, 500)}`
            );
        }

        this.chatHistory.push({ role: "assistant", content: assistantContent });
        return assistantContent;
    }

    // Alias — convenient for callers who think in "ask/answer" terms
    async ask(prompt) {
        return this.sendMessage(prompt);
    }

    // Wipe conversation but keep the system prompt
    reset() {
        this.chatHistory = this.systemPrompt
            ? [{ role: "user", content: this.systemPrompt }]
            : [];
    }

    // Release the underlying TLS session
    async close() {
        if (this._closed) return;
        this._closed = true;
        if (this._client) {
            await this._client.close().catch(() => {});
            this._client = null;
            await releaseTLS();
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience one-shot helper
//   import { quickAsk } from './ai.mjs';
//   const reply = await quickAsk("What is 2+2?");
// ─────────────────────────────────────────────────────────────────────────────
export async function quickAsk(prompt, options = {}) {
    const chat = new DeepAIChat(options);
    try {
        return await chat.sendMessage(prompt);
    } finally {
        await chat.close();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI — only runs when this file is executed directly
// ─────────────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] &&
    fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
    const { default: readline } = await import('readline');

    const C = {
        reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
        cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m',
        magenta: '\x1b[35m', gray: '\x1b[90m',
    };

    const clean = t => String(t).replace(/^(assistant|AI)\s*:?\s*/i, '').trim();

    async function runInteractive(chat) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        console.log(`${C.dim}Type your message. /exit to quit, /clear to reset.${C.reset}\n`);
        const ask = () => new Promise(r => rl.question(`${C.cyan}${C.bold}You${C.reset} > `, r));
        while (true) {
            const input = (await ask()).trim();
            if (!input) continue;
            if (input === '/exit' || input === '/quit') break;
            if (input === '/clear') { chat.reset(); console.log(`${C.dim}(cleared)${C.reset}\n`); continue; }
            try {
                process.stdout.write(`${C.gray}…thinking${C.reset}\n`);
                const reply = await chat.sendMessage(input);
                process.stdout.write('\x1b[1A\x1b[2K');
                console.log(`\n${C.green}${C.bold}Assistant${C.reset}\n${clean(reply)}\n`);
            } catch (err) {
                process.stdout.write('\x1b[1A\x1b[2K');
                console.error(`${C.yellow}Error:${C.reset} ${err.message}\n`);
            }
        }
        rl.close();
    }

    console.log(`${C.magenta}${C.bold}DeepAIChat${C.reset} ${C.dim}(GPT-4o style)${C.reset}`);
    console.log(`${C.gray}node=${process.version}${C.reset}`);

    const chat = new DeepAIChat();
    const cliArgs = process.argv.slice(2);

    try {
        if (cliArgs.length > 0) {
            for (const p of cliArgs) {
                console.log(`\n${C.cyan}${C.bold}You${C.reset}\n${p}`);
                const reply = await chat.sendMessage(p);
                console.log(`\n${C.green}${C.bold}Assistant${C.reset}\n${clean(reply)}\n`);
            }
        } else {
            await runInteractive(chat);
        }
    } catch (err) {
        console.error(`${C.yellow}Fatal:${C.reset} ${err?.message || err}`);
        process.exitCode = 1;
    } finally {
        await chat.close();
    }
}
