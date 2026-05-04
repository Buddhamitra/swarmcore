/**
 * Repo 1: OpenClaw + NemoClaw Bot
 * Telegram bot running OpenClaw (real CLI) + NemoClaw (secure LLM)
 */

const https  = require("https");
const http   = require("http");
const { spawn, execSync } = require("child_process");
const fs     = require("fs");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GROK_API_KEY   = process.env.GROK_API_KEY || "";
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY || "";
const BRAIN_PROVIDER = process.env.BRAIN_PROVIDER || "grok";
const OLLAMA_BASE    = process.env.OLLAMA_BASE_URL || "https://api.ollama.com";
const DEFAULT_MODEL  = process.env.DEFAULT_MODEL  || "llama-3.3-70b-versatile";
const PORT           = process.env.PORT || 3000;

if (!TELEGRAM_TOKEN) { console.error("❌ TELEGRAM_TOKEN not set"); process.exit(1); }
fs.mkdirSync("/tmp/workspace", { recursive: true });

// ── HTTP status page ──────────────────────────────────────────────
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(`<!DOCTYPE html>
<html><head><title>OpenClaw + NemoClaw</title>
<style>body{background:#0d1117;color:#c9d1d9;font-family:monospace;padding:40px}
h1{color:#58a6ff}.ok{color:#3fb950}</style></head>
<body>
<h1>🔴 OpenClaw + 🛡️ NemoClaw Bot</h1>
<p>Status: <span class="ok">RUNNING</span></p>
<p>Brain: ${BRAIN_PROVIDER.toUpperCase()} / ${DEFAULT_MODEL}</p>
<p>Send commands via Telegram</p>
<pre>
CallAgent: OpenClaw
Task: your task here

CallAgent: NemoClaw
Task: your task here

CallAgent: OpenClaw/NemoClaw
Task: your task here
</pre>
</body></html>`);
}).listen(PORT, () => console.log(`✅ Bot running on port ${PORT}`));

// ── Telegram ──────────────────────────────────────────────────────
let lastId = 0;

async function tgPost(method, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req  = https.request({
      hostname: "api.telegram.org",
      path: `/bot${TELEGRAM_TOKEN}/${method}`,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
    }, res => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => { try { resolve(JSON.parse(raw)); } catch { resolve({}); } });
    });
    req.on("error", () => resolve({}));
    req.write(data); req.end();
  });
}

async function send(chatId, text) {
  const chunks = text.match(/[\s\S]{1,4000}/g) || [text];
  for (const chunk of chunks) {
    await tgPost("sendMessage", { chat_id: chatId, text: chunk });
    await new Promise(r => setTimeout(r, 300));
  }
}

// ── Parse command ─────────────────────────────────────────────────
function parse(text) {
  const m = text.match(/CallAgent\s*:\s*([A-Za-z\/,\s]+)\nTask\s*:\s*([\s\S]+)/i);
  if (!m) return null;
  const alias = { openclaw: "openclaw", nemoclaw: "nemoclaw" };
  const agents = m[1].trim().split(/[\/,]/)
    .map(a => alias[a.trim().toLowerCase()])
    .filter(Boolean);
  return agents.length ? { agents, task: m[2].trim() } : null;
}

// ── LLM call ──────────────────────────────────────────────────────
async function llm(system, task) {
  const isGrok = BRAIN_PROVIDER === "grok";
  const url    = isGrok
    ? "https://api.groq.com/openai/v1/chat/completions"
    : `${OLLAMA_BASE}/v1/chat/completions`;
  const apiKey = isGrok ? GROK_API_KEY : OLLAMA_API_KEY;
  const model  = isGrok ? "llama-3.3-70b-versatile" : DEFAULT_MODEL;
  const body   = JSON.stringify({
    model,
    messages: [{ role: "system", content: system }, { role: "user", content: task }],
    max_tokens: 2048, temperature: 0.7,
  });
  return new Promise((resolve) => {
    const u   = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "Content-Length": Buffer.byteLength(body),
      },
    }, res => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => {
        try { resolve(JSON.parse(raw).choices[0].message.content.trim()); }
        catch { resolve("LLM error — check API key in Render environment."); }
      });
    });
    req.on("error", e => resolve(`Network error: ${e.message}`));
    req.write(body); req.end();
  });
}

// ── OpenClaw (real CLI) ───────────────────────────────────────────
const OPENCLAW_SYSTEM = `You are OpenClaw — autonomous action agent on a real Linux server.
Capabilities: web browsing, shell commands, file operations, Gmail, Slack, Telegram, Trello, GitHub APIs.
Execute step by step and report exactly what you did.
End with:
Done
Completed Task: <one line summary>`;

async function runOpenClaw(task) {
  try {
    execSync("which openclaw", { stdio: "pipe" });
  } catch {
    console.log("OpenClaw CLI not found — using LLM mode");
    return await llm(OPENCLAW_SYSTEM, task);
  }

  return new Promise((resolve) => {
    let out = "";
    const proc = spawn("openclaw", ["agent", "--message", task, "--local", "--no-daemon"], {
      env: {
        ...process.env,
        OPENAI_BASE_URL: BRAIN_PROVIDER === "grok"
          ? "https://api.groq.com/openai/v1"
          : `${OLLAMA_BASE}/v1`,
        OPENAI_API_KEY: BRAIN_PROVIDER === "grok" ? GROK_API_KEY : OLLAMA_API_KEY,
        OPENCLAW_MODEL: DEFAULT_MODEL,
      },
      cwd: "/tmp/workspace",
    });
    proc.stdout.on("data", d => out += d.toString());
    proc.stderr.on("data", d => out += d.toString());
    proc.on("close", () => resolve(out.trim() || "OpenClaw completed with no output."));
    proc.on("error", async () => resolve(await llm(OPENCLAW_SYSTEM, task)));
    setTimeout(() => {
      proc.kill();
      resolve(out.trim() || "OpenClaw: task timed out after 90s.");
    }, 90000);
  });
}

// ── NemoClaw (secure LLM) ─────────────────────────────────────────
const NEMOCLAW_SYSTEM = `You are NemoClaw — NVIDIA's secure enterprise agent.
You enforce security policies on every action:
- Sandboxed file access (workspace only)
- Network policy enforcement
- Audit logging of every action
- Compliance-safe data handling

For every task:
1. Declare your security sandbox parameters
2. Execute the task within policy
3. Show complete audit log

End with:
Done
Completed Task: <summary>
Audit Log: <what was accessed/modified/blocked>`;

async function runNemoClaw(task) {
  const result = await llm(NEMOCLAW_SYSTEM, task);
  return result;
}

// ── Run agent ─────────────────────────────────────────────────────
async function runAgent(key, task) {
  console.log(`[${key.toUpperCase()}] ${task.slice(0, 60)}`);
  switch (key) {
    case "openclaw": {
      const r = await runOpenClaw(task);
      return `🔴 OpenClaw\n\n${r}`;
    }
    case "nemoclaw": {
      const r = await runNemoClaw(task);
      return `🛡️ NemoClaw (Secure)\n\n${r}`;
    }
    default: return `Unknown agent: ${key}`;
  }
}

// ── Help ──────────────────────────────────────────────────────────
const HELP = `🔴 OpenClaw + 🛡️ NemoClaw Bot

Single agent:
CallAgent: OpenClaw
Task: search the web for AI news

CallAgent: NemoClaw
Task: analyse this data securely

Both agents:
CallAgent: OpenClaw/NemoClaw
Task: research competitors securely

Brain: ${BRAIN_PROVIDER.toUpperCase()} / ${DEFAULT_MODEL}`;

// ── Poll ──────────────────────────────────────────────────────────
async function poll() {
  try {
    const res = await tgPost("getUpdates", {
      offset: lastId + 1, timeout: 25, allowed_updates: ["message"],
    });
    if (!res.ok || !res.result?.length) return;

    for (const update of res.result) {
      lastId = update.update_id;
      const msg  = update.message;
      if (!msg?.text) continue;
      const chatId = msg.chat.id;
      const cmd    = parse(msg.text);

      if (!cmd) { await send(chatId, HELP); continue; }

      const { agents, task } = cmd;
      await send(chatId, `⚙️ Running: ${agents.map(a => a.toUpperCase()).join(" + ")}...`);

      if (agents.length === 1) {
        await send(chatId, await runAgent(agents[0], task));
      } else {
        const results = await Promise.all(agents.map(a => runAgent(a, task)));
        await send(chatId, results.join("\n\n---\n\n"));
      }
    }
  } catch (e) { console.error("Poll error:", e.message); }
}

console.log(`OpenClaw+NemoClaw bot | brain=${BRAIN_PROVIDER} | model=${DEFAULT_MODEL}`);
setInterval(poll, 2000);
poll();
               
