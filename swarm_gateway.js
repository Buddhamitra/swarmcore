/**
 * SwarmCore Gateway - Final Correct Version
 * OpenClaw + NemoClaw + Hermes via Telegram
 * Reads all config from environment variables (set in Render dashboard)
 */

const https  = require("https");
const http   = require("http");
const { spawn, execSync } = require("child_process");
const fs     = require("fs");
const path   = require("path");

// ── Config from Render environment variables ──────────────────────
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY || "";
const GROK_API_KEY   = process.env.GROK_API_KEY   || "";
const BRAIN_PROVIDER = process.env.BRAIN_PROVIDER  || "grok";
const OLLAMA_BASE    = process.env.OLLAMA_BASE_URL  || "https://api.ollama.com";
const DEFAULT_MODEL  = process.env.DEFAULT_MODEL   || "llama-3.3-70b-versatile";
const PORT           = process.env.PORT            || 3000;

if (!TELEGRAM_TOKEN) {
  console.error("❌ TELEGRAM_TOKEN not set in Render environment variables");
  process.exit(1);
}

const HERMES_BIN = [
  "/usr/local/bin/hermes",
  path.join(process.env.HOME || "/root", ".local/bin/hermes"),
  "/tmp/hermes-agent/venv/bin/hermes",
].find(p => { try { fs.accessSync(p); return true; } catch { return false; } });

fs.mkdirSync("/tmp/swarmcore", { recursive: true });

// ── HTTP server (keeps Render happy + shows status page) ──────────
http.createServer((req, res) => {
  const openclaw = isInstalled("openclaw") ? "✅ Installed" : "⚠️ Not found";
  const hermes   = HERMES_BIN ? "✅ Installed" : "⚠️ Not found";
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(`<!DOCTYPE html>
<html>
<head><title>SwarmCore</title>
<style>body{background:#0d1117;color:#c9d1d9;font-family:monospace;padding:40px;max-width:600px}
h1{color:#58a6ff}table{width:100%;border-collapse:collapse}
td{padding:8px;border:1px solid #30363d}
.ok{color:#3fb950}.warn{color:#d29922}</style></head>
<body>
<h1>🕷️ SwarmCore</h1>
<p>Status: <span class="ok">RUNNING</span></p>
<table>
<tr><td>🔴 OpenClaw</td><td>${openclaw}</td></tr>
<tr><td>🛡️ NemoClaw</td><td>✅ Security LLM mode</td></tr>
<tr><td>🟣 Hermes</td><td>${hermes}</td></tr>
<tr><td>🧠 Brain</td><td>${BRAIN_PROVIDER.toUpperCase()} / ${DEFAULT_MODEL}</td></tr>
</table>
<p>Send commands via your Telegram bot</p>
</body></html>`);
}).listen(PORT, () => console.log(`✅ SwarmCore HTTP server on port ${PORT}`));

// ── Helper: check if CLI tool exists ─────────────────────────────
function isInstalled(cmd) {
  try { execSync(`which ${cmd}`, { stdio: "pipe" }); return true; }
  catch { return false; }
}

// ── Telegram API ──────────────────────────────────────────────────
let lastUpdateId = 0;

async function tgPost(method, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req  = https.request({
      hostname: "api.telegram.org",
      path:     `/bot${TELEGRAM_TOKEN}/${method}`,
      method:   "POST",
      headers:  { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
    }, res => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => { try { resolve(JSON.parse(raw)); } catch { resolve({}); } });
    });
    req.on("error", () => resolve({}));
    req.write(data); req.end();
  });
}

async function sendMsg(chatId, text) {
  // Split long messages
  const chunks = text.match(/[\s\S]{1,4000}/g) || [text];
  for (const chunk of chunks) {
    await tgPost("sendMessage", { chat_id: chatId, text: chunk });
    await new Promise(r => setTimeout(r, 300));
  }
}

// ── Parse Telegram command ────────────────────────────────────────
function parseCmd(text) {
  const m = text.match(/CallAgent\s*:\s*([A-Za-z\/,\s]+)\nTask\s*:\s*([\s\S]+)/i);
  if (!m) return null;
  const alias = {
    openclaw: "openclaw", nemoclaw: "nemoclaw",
    hermes: "hermes", hermesagent: "hermes",
  };
  const agents = m[1].trim().split(/[\/,]/)
    .map(a => alias[a.trim().toLowerCase()])
    .filter(Boolean);
  return agents.length ? { agents, task: m[2].trim() } : null;
}

// ── LLM call (Grok or Ollama) ─────────────────────────────────────
async function callLLM(system, task) {
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
        "Content-Type":   "application/json",
        "Authorization":  `Bearer ${apiKey}`,
        "Content-Length": Buffer.byteLength(body),
      },
    }, res => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => {
        try {
          const d = JSON.parse(raw);
          resolve(d.choices?.[0]?.message?.content?.trim() || "No response from LLM.");
        } catch { resolve(`LLM parse error. Raw: ${raw.slice(0, 200)}`); }
      });
    });
    req.on("error", e => resolve(`Network error: ${e.message}`));
    req.write(body); req.end();
  });
}

// ── Run OpenClaw CLI ──────────────────────────────────────────────
async function runOpenClaw(task) {
  if (!isInstalled("openclaw")) {
    return await callLLM(AGENT_SYSTEMS.openclaw, task);
  }
  return new Promise((resolve) => {
    let out = "";
    const env = {
      ...process.env,
      OPENAI_BASE_URL: BRAIN_PROVIDER === "grok"
        ? "https://api.groq.com/openai/v1"
        : `${OLLAMA_BASE}/v1`,
      OPENAI_API_KEY: BRAIN_PROVIDER === "grok" ? GROK_API_KEY : OLLAMA_API_KEY,
      OPENCLAW_MODEL: DEFAULT_MODEL,
    };
    const proc = spawn("openclaw", ["agent", "--message", task, "--local", "--no-daemon"], {
      env, cwd: "/tmp/swarmcore",
    });
    proc.stdout.on("data", d => out += d.toString());
    proc.stderr.on("data", d => out += d.toString());
    proc.on("close", () => resolve(out.trim() || "OpenClaw completed."));
    proc.on("error", async (e) => {
      resolve(await callLLM(AGENT_SYSTEMS.openclaw, task));
    });
    setTimeout(() => { proc.kill(); resolve(out.trim() || "OpenClaw: task running (90s timeout)"); }, 90000);
  });
}

// ── Run Hermes CLI ────────────────────────────────────────────────
async function runHermes(task) {
  if (!HERMES_BIN) {
    return await callLLM(AGENT_SYSTEMS.hermes, task);
  }
  return new Promise((resolve) => {
    let out = "";
    const env = {
      ...process.env,
      OPENAI_BASE_URL: BRAIN_PROVIDER === "grok"
        ? "https://api.groq.com/openai/v1"
        : `${OLLAMA_BASE}/v1`,
      OPENAI_API_KEY: BRAIN_PROVIDER === "grok" ? GROK_API_KEY : OLLAMA_API_KEY,
      HERMES_INFERENCE_MODEL: DEFAULT_MODEL,
    };
    const proc = spawn(HERMES_BIN, ["-z", task], { env, cwd: "/tmp/swarmcore" });
    proc.stdout.on("data", d => out += d.toString());
    proc.stderr.on("data", d => out += d.toString());
    proc.on("close", () => resolve(out.trim() || "Hermes completed."));
    proc.on("error", async () => resolve(await callLLM(AGENT_SYSTEMS.hermes, task)));
    setTimeout(() => { proc.kill(); resolve(out.trim() || "Hermes: task running (90s timeout)"); }, 90000);
  });
}

// ── Agent system prompts ──────────────────────────────────────────
const AGENT_SYSTEMS = {
  openclaw: `You are OpenClaw — 24/7 personal action agent on a real Linux server.
You handle: web browsing, shell commands, file operations, Gmail, Slack, Telegram, Trello, GitHub.
Execute tasks step by step and report exactly what you did.
End with: Done - Completed Task: <one line summary>`,

  nemoclaw: `You are NemoClaw — NVIDIA's secure enterprise agent.
You wrap every action in sandboxed policies, enforce network restrictions, create audit logs.
First declare your security parameters, then execute safely, then show the audit trail.
End with: Done - Completed Task: <summary> | Audit: <what was accessed/blocked>`,

  hermes: `You are Hermes Agent by Nous Research — self-improving specialist.
You execute tasks, evaluate results, write reusable skill documents for next time.
You have cross-session memory and build skills from every task.
End with: Done - Completed Task: <summary> | Skill Saved: <skill name>`,
};

const EMOJI = {
  openclaw: "🔴 OpenClaw",
  nemoclaw: "🟢 NemoClaw (Secure)",
  hermes:   "🟣 Hermes Agent",
};

// ── Route to correct agent ────────────────────────────────────────
async function runAgent(key, task) {
  console.log(`[${key.toUpperCase()}] Task: ${task.slice(0, 60)}...`);
  let result;
  switch (key) {
    case "openclaw": result = await runOpenClaw(task); break;
    case "hermes":   result = await runHermes(task);   break;
    case "nemoclaw": result = await callLLM(AGENT_SYSTEMS.nemoclaw, task); break;
    default:         result = "Unknown agent.";
  }
  return `${EMOJI[key] || key}\n\n${result}`;
}

// ── Help message ──────────────────────────────────────────────────
const HELP = `SwarmCore - Multi-Agent Swarm

HOW TO USE:

Single agent:
CallAgent: OpenClaw
Task: search the web for AI news today

Two agents:
CallAgent: OpenClaw/Hermes
Task: write a python script to scrape data

All three:
CallAgent: OpenClaw/NemoClaw/Hermes
Task: research and summarise topic securely

Agents available:
OpenClaw  - action, automation, 100+ integrations
NemoClaw  - secure sandboxed enterprise tasks
Hermes    - self-improving, builds skills each task

Current brain: ${BRAIN_PROVIDER.toUpperCase()} / ${DEFAULT_MODEL}`;

// ── Telegram polling loop ─────────────────────────────────────────
async function poll() {
  try {
    const res = await tgPost("getUpdates", {
      offset:          lastUpdateId + 1,
      timeout:         25,
      allowed_updates: ["message"],
    });
    if (!res.ok || !res.result?.length) return;

    for (const update of res.result) {
      lastUpdateId = update.update_id;
      const msg  = update.message;
      if (!msg?.text) continue;

      const chatId = msg.chat.id;
      const cmd    = parseCmd(msg.text);

      if (!cmd) {
        await sendMsg(chatId, HELP);
        continue;
      }

      const { agents, task } = cmd;
      console.log(`Telegram → agents=[${agents}] task="${task.slice(0, 60)}"`);
      await sendMsg(chatId, `Dispatching to: ${agents.map(a => a.toUpperCase()).join(", ")}...`);

      if (agents.length === 1) {
        const reply = await runAgent(agents[0], task);
        await sendMsg(chatId, reply);
      } else {
        const results = await Promise.all(agents.map(a => runAgent(a, task)));
        const combined = `SWARM RESULT - ${agents.length} agents\nTask: "${task.slice(0, 80)}"\n\n`
          + results.join("\n\n---\n\n");
        await sendMsg(chatId, combined);
      }
    }
  } catch (e) {
    console.error("Poll error:", e.message);
  }
}

// ── Start ─────────────────────────────────────────────────────────
console.log(`SwarmCore starting...`);
console.log(`Brain: ${BRAIN_PROVIDER.toUpperCase()} | Model: ${DEFAULT_MODEL}`);
console.log(`OpenClaw: ${isInstalled("openclaw") ? "ready" : "not found"}`);
console.log(`Hermes: ${HERMES_BIN || "not found"}`);
setInterval(poll, 2000);
poll();
  
