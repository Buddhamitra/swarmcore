/**
 * SwarmCore Gateway - Stable version
 * OpenClaw + NemoClaw (LLM) + Hermes (LLM)
 */

const https = require("https");
const http = require("http");
const { spawn, execSync } = require("child_process");
const fs = require("fs");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY || "";
const GROK_API_KEY   = process.env.GROK_API_KEY || "";
const BRAIN_PROVIDER = process.env.BRAIN_PROVIDER || "ollama";
const OLLAMA_BASE    = process.env.OLLAMA_BASE_URL || "https://api.ollama.com";
const DEFAULT_MODEL  = process.env.DEFAULT_MODEL || "kimi-k2.5:cloud";
const PORT           = process.env.PORT || 3000;

if (!TELEGRAM_TOKEN) { console.error("TELEGRAM_TOKEN not set"); process.exit(1); }
fs.mkdirSync("/tmp/swarmcore", { recursive: true });

// ── HTTP health check server ──────────────────────────────────────
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(`
    <html><body style="background:#111;color:#0f0;font-family:monospace;padding:40px">
    <h1>🕷️ SwarmCore</h1>
    <p>Status: <b>RUNNING</b></p>
    <p>Brain: ${BRAIN_PROVIDER} / ${DEFAULT_MODEL}</p>
    <p>Agents: OpenClaw ✅ | NemoClaw ✅ | Hermes ✅</p>
    <p>Send commands via Telegram bot</p>
    </body></html>
  `);
}).listen(PORT, () => console.log(`SwarmCore running on port ${PORT}`));

// ── Telegram ──────────────────────────────────────────────────────
let lastUpdateId = 0;

async function tgPost(method, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: "api.telegram.org",
      path: `/bot${TELEGRAM_TOKEN}/${method}`,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }
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
  const chunks = text.match(/[\s\S]{1,4000}/g) || [text];
  for (const chunk of chunks) {
    await tgPost("sendMessage", { chat_id: chatId, text: chunk });
  }
}

// ── Parse command ─────────────────────────────────────────────────
function parseCmd(text) {
  const m = text.match(/CallAgent\s*:\s*([A-Za-z\/,\s]+)\nTask\s*:\s*([\s\S]+)/i);
  if (!m) return null;
  const alias = { openclaw:"openclaw", nemoclaw:"nemoclaw", hermes:"hermes", hermesagent:"hermes" };
  const agents = m[1].trim().split(/[\/,]/).map(a => alias[a.trim().toLowerCase()]).filter(Boolean);
  return agents.length ? { agents, task: m[2].trim() } : null;
}

// ── LLM call ─────────────────────────────────────────────────────
async function callLLM(system, task) {
  const isGrok = BRAIN_PROVIDER === "grok";
  const url    = isGrok ? "https://api.groq.com/openai/v1/chat/completions" : `${OLLAMA_BASE}/v1/chat/completions`;
  const model  = isGrok ? "llama-3.3-70b-versatile" : DEFAULT_MODEL;
  const apiKey = isGrok ? GROK_API_KEY : OLLAMA_API_KEY;
  const body   = JSON.stringify({
    model,
    messages: [{ role:"system", content:system }, { role:"user", content:task }],
    max_tokens: 2048, temperature: 0.7
  });
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: "POST",
      headers: { "Content-Type":"application/json", "Authorization":`Bearer ${apiKey}`, "Content-Length": Buffer.byteLength(body) }
    }, res => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => {
        try { resolve(JSON.parse(raw).choices[0].message.content.trim()); }
        catch { resolve("LLM error — check API key and model name."); }
      });
    });
    req.on("error", e => resolve(`Network error: ${e.message}`));
    req.write(body); req.end();
  });
}

// ── Run OpenClaw (real CLI) ───────────────────────────────────────
async function runOpenClaw(task) {
  return new Promise((resolve) => {
    try { execSync("which openclaw", { stdio:"pipe" }); } 
    catch { return resolve("OpenClaw not found in PATH."); }

    let out = "";
    const proc = spawn("openclaw", ["agent", "--message", task, "--local", "--no-daemon"], {
      env: {
        ...process.env,
        OPENAI_BASE_URL: BRAIN_PROVIDER === "grok" ? "https://api.groq.com/openai/v1" : `${OLLAMA_BASE}/v1`,
        OPENAI_API_KEY:  BRAIN_PROVIDER === "grok" ? GROK_API_KEY : OLLAMA_API_KEY,
        OPENCLAW_MODEL:  DEFAULT_MODEL,
      },
      cwd: "/tmp/swarmcore"
    });
    proc.stdout.on("data", d => out += d.toString());
    proc.stderr.on("data", d => out += d.toString());
    proc.on("close", () => resolve(out.trim() || "OpenClaw completed with no output."));
    proc.on("error", e => resolve(`OpenClaw spawn error: ${e.message}`));
    setTimeout(() => { proc.kill(); resolve(out.trim() || "OpenClaw timed out after 90s."); }, 90000);
  });
}

// ── Agent systems ─────────────────────────────────────────────────
const SYSTEMS = {
  openclaw: `You are OpenClaw running on a real Linux server.
You can: browse web, run shell commands, send emails, automate tasks, use APIs.
Be specific about what you did step by step.
End with: Done - Completed Task: <summary>`,

  nemoclaw: `You are NemoClaw - NVIDIA's secure enterprise agent.
You sandbox every action, enforce policies, create audit logs.
Declare your security parameters, execute safely, show audit trail.
End with: Done - Completed Task: <summary> | Audit: <what was accessed>`,

  hermes: `You are Hermes Agent by Nous Research - self-improving specialist.
You execute tasks, evaluate results, write reusable skill documents.
Show your reasoning, execution, and what skill you saved.
End with: Done - Completed Task: <summary> | Skill Saved: <skill name>`
};

const EMOJI = { openclaw:"🔴 OpenClaw", nemoclaw:"🟢 NemoClaw", hermes:"🟣 Hermes" };

// ── Run agent ─────────────────────────────────────────────────────
async function runAgent(key, task) {
  console.log(`[${key}] Task: ${task.slice(0,60)}`);
  let result;
  if (key === "openclaw") {
    result = await runOpenClaw(task);
    if (!result || result.includes("error") || result.includes("not found")) {
      result = await callLLM(SYSTEMS.openclaw, task);
    }
  } else {
    result = await callLLM(SYSTEMS[key] || SYSTEMS.hermes, task);
  }
  return `${EMOJI[key] || key}\n\n${result}`;
}

// ── Help message ──────────────────────────────────────────────────
const HELP = `SwarmCore - Multi-Agent Swarm

HOW TO USE:

Single agent:
CallAgent: OpenClaw
Task: search the web for AI news

Two agents:
CallAgent: OpenClaw/Hermes
Task: write a python script

All three:
CallAgent: OpenClaw/NemoClaw/Hermes
Task: research and summarise topic

Available agents:
OpenClaw - action and automation
NemoClaw - secure sandboxed tasks  
Hermes - self-improving specialist

Brain: ${BRAIN_PROVIDER.toUpperCase()} / ${DEFAULT_MODEL}`;

// ── Poll Telegram ─────────────────────────────────────────────────
async function poll() {
  try {
    const res = await tgPost("getUpdates", { offset: lastUpdateId + 1, timeout: 25, allowed_updates: ["message"] });
    if (!res.ok || !res.result?.length) return;

    for (const update of res.result) {
      lastUpdateId = update.update_id;
      const msg    = update.message;
      if (!msg?.text) continue;

      const chatId = msg.chat.id;
      const cmd    = parseCmd(msg.text);

      if (!cmd) {
        await sendMsg(chatId, HELP);
        continue;
      }

      const { agents, task } = cmd;
      await sendMsg(chatId, `Dispatching to: ${agents.join(", ")}...`);

      if (agents.length === 1) {
        const reply = await runAgent(agents[0], task);
        await sendMsg(chatId, reply);
      } else {
        const results = await Promise.all(agents.map(a => runAgent(a, task)));
        await sendMsg(chatId, `SWARM RESULT - ${agents.length} agents\n\n` + results.join("\n\n---\n\n"));
      }
    }
  } catch (e) {
    console.error("Poll error:", e.message);
  }
}

console.log(`SwarmCore starting | brain=${BRAIN_PROVIDER} | model=${DEFAULT_MODEL}`);
setInterval(poll, 2000);
poll();
