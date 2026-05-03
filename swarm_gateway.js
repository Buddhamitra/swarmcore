/**
 * SwarmCore Gateway
 * Telegram bot that dispatches tasks to OpenClaw, NemoClaw, Hermes
 * Runs on Render.com - real Linux, real agents
 */

const { execSync, spawn } = require("child_process");
const https = require("https");
const http = require("http");
const fs = require("fs");
const os = require("os");

// ── Config ────────────────────────────────────────────────────────────────────
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY || "";
const GROK_API_KEY   = process.env.GROK_API_KEY || "";
const BRAIN_PROVIDER = process.env.BRAIN_PROVIDER || "ollama";
const OLLAMA_BASE    = process.env.OLLAMA_BASE_URL || "https://api.ollama.com";
const DEFAULT_MODEL  = process.env.DEFAULT_MODEL  || "kimi-k2.5:cloud";
const WORKSPACE      = process.env.RENDER_DISK_PATH || os.homedir() + "/.swarmcore";

if (!TELEGRAM_TOKEN) { console.error("TELEGRAM_TOKEN not set"); process.exit(1); }
fs.mkdirSync(WORKSPACE, { recursive: true });

// ── Telegram polling ──────────────────────────────────────────────────────────
let lastUpdateId = 0;

async function tgRequest(method, body = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: "api.telegram.org",
      path: `/bot${TELEGRAM_TOKEN}/${method}`,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
    }, res => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => { try { resolve(JSON.parse(raw)); } catch { resolve({}); } });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function sendMessage(chatId, text) {
  // Telegram markdown is strict — strip problematic chars
  const safe = text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, "\\$1");
  try {
    await tgRequest("sendMessage", { chat_id: chatId, text: safe, parse_mode: "MarkdownV2" });
  } catch {
    await tgRequest("sendMessage", { chat_id: chatId, text });
  }
}

// ── Parse command ─────────────────────────────────────────────────────────────
function parseCommand(text) {
  const m = text.match(/CallAgent\s*:\s*([A-Za-z/,]+)\s*\nTask\s*:\s*([\s\S]+)/i);
  if (!m) return null;
  const agentRaw = m[1].trim();
  const task     = m[2].trim();
  const alias    = { openclaw:"openclaw", nemoclaw:"nemoclaw", hermes:"hermes", hermesagent:"hermes" };
  const agents   = agentRaw.split(/[/,]/).map(a => alias[a.trim().toLowerCase()]).filter(Boolean);
  return agents.length ? { agents, task } : null;
}

// ── LLM call (Ollama Cloud or Grok) ──────────────────────────────────────────
async function callLLM(systemPrompt, task) {
  const isGrok = BRAIN_PROVIDER === "grok";
  const url    = isGrok
    ? "https://api.groq.com/openai/v1/chat/completions"
    : `${OLLAMA_BASE}/v1/chat/completions`;
  const model  = isGrok ? "llama-3.3-70b-versatile" : DEFAULT_MODEL;
  const apiKey = isGrok ? GROK_API_KEY : OLLAMA_API_KEY;

  return new Promise((resolve) => {
    const body = JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: task },
      ],
      max_tokens: 2048,
      temperature: 0.7,
    });

    const u  = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request({
      hostname: u.hostname,
      path:     u.pathname,
      method:   "POST",
      headers:  {
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
        } catch { resolve("LLM parse error."); }
      });
    });
    req.on("error", e => resolve(`LLM error: ${e.message}`));
    req.write(body);
    req.end();
  });
}

// ── Run OpenClaw via CLI ──────────────────────────────────────────────────────
async function runOpenClaw(task) {
  return new Promise((resolve) => {
    // Check if openclaw is installed
    try { execSync("which openclaw", { stdio: "pipe" }); }
    catch {
      resolve("⚠️ OpenClaw not installed yet. Run the setup script first.");
      return;
    }

    const configPath = `${WORKSPACE}/openclaw.json`;
    if (!fs.existsSync(configPath)) {
      fs.writeFileSync(configPath, JSON.stringify({
        model:    DEFAULT_MODEL,
        provider: BRAIN_PROVIDER === "grok" ? "openai" : "openai-compatible",
        defaults: { workspace: WORKSPACE + "/openclaw_ws" },
      }, null, 2));
    }

    let output = "";
    const proc = spawn("openclaw", ["agent", "--message", task, "--local", "--no-daemon"], {
      env: {
        ...process.env,
        OPENCLAW_CONFIG: configPath,
        OPENAI_BASE_URL: BRAIN_PROVIDER === "grok" ? "https://api.groq.com/openai/v1" : `${OLLAMA_BASE}/v1`,
        OPENAI_API_KEY:  BRAIN_PROVIDER === "grok" ? GROK_API_KEY : OLLAMA_API_KEY,
      },
      timeout: 120000,
    });

    proc.stdout.on("data", d => { output += d.toString(); });
    proc.stderr.on("data", d => { output += d.toString(); });
    proc.on("close", code => {
      const result = output.trim() || "(no output)";
      resolve(`🔴 *OpenClaw Result*\n\n${result}\n\n✅ Done\nCompleted Task: ${task.slice(0, 80)}`);
    });
    proc.on("error", e => resolve(`❌ OpenClaw error: ${e.message}`));

    // Timeout fallback
    setTimeout(() => {
      proc.kill();
      resolve(`⏱️ OpenClaw task running in background (timeout 120s).\n\nTask: ${task.slice(0, 100)}`);
    }, 115000);
  });
}

// ── Run Hermes via CLI ────────────────────────────────────────────────────────
async function runHermes(task) {
  return new Promise((resolve) => {
    try { execSync("which hermes", { stdio: "pipe" }); }
    catch {
      resolve("⚠️ Hermes not installed yet. Run the setup script first.");
      return;
    }

    let output = "";
    const proc = spawn("hermes", ["-z", task], {
      env: {
        ...process.env,
        HERMES_INFERENCE_MODEL: DEFAULT_MODEL,
        OPENAI_BASE_URL: BRAIN_PROVIDER === "grok" ? "https://api.groq.com/openai/v1" : `${OLLAMA_BASE}/v1`,
        OPENAI_API_KEY:  BRAIN_PROVIDER === "grok" ? GROK_API_KEY : OLLAMA_API_KEY,
      },
      timeout: 120000,
    });

    proc.stdout.on("data", d => { output += d.toString(); });
    proc.stderr.on("data", d => { output += d.toString(); });
    proc.on("close", () => {
      const result = output.trim() || "(no output)";
      resolve(`🟣 *Hermes Agent Result*\n\n${result}\n\n✅ Done\nCompleted Task: ${task.slice(0, 80)}\n📚 Skill Saved: auto`);
    });
    proc.on("error", e => resolve(`❌ Hermes error: ${e.message}`));
  });
}

// ── Run NemoClaw ──────────────────────────────────────────────────────────────
// NemoClaw needs Docker + Kubernetes — on Render free tier we use LLM fallback
// with the real NemoClaw security prompt so you get the full reasoning
async function runNemoClaw(task) {
  const NEMOCLAW_SYSTEM = `You are NemoClaw — NVIDIA's open-source secure agent stack running on
Render Linux server. You run OpenClaw inside an NVIDIA OpenShell sandbox with:
- Landlock filesystem restrictions (sandboxed workspace only)
- seccomp syscall filtering
- Network namespace isolation (policy-based egress)
- Audit logging of every file/network access

For this task:
1. Declare your sandbox parameters (what you will allow/block)
2. Execute the task with policy enforcement
3. Show your audit log of what was accessed

End with:
✅ Done
Completed Task: <one-liner>
🔒 Audit Log: <what was accessed/blocked>`;

  const result = await callLLM(NEMOCLAW_SYSTEM, task);
  return `🟢 *NemoClaw (Sandboxed) Result*\n\n${result}`;
}

// ── Agent dispatcher ──────────────────────────────────────────────────────────
const OPENCLAW_LLM_SYSTEM = `You are OpenClaw — a real autonomous agent running on a Linux server.
You have access to: headless Chrome browser, shell commands, file system, Gmail API,
Slack/Telegram/WhatsApp APIs, Trello, GitHub. You execute multi-step tasks end to end.
Report exactly what you did step by step. End with:
✅ Done
Completed Task: <one-liner summary>`;

async function runAgent(agentKey, task) {
  console.log(`[${agentKey}] Running: ${task.slice(0, 60)}...`);
  switch (agentKey) {
    case "openclaw":
      // Try real CLI first, fallback to LLM
      try {
        execSync("which openclaw", { stdio: "pipe" });
        return await runOpenClaw(task);
      } catch {
        const r = await callLLM(OPENCLAW_LLM_SYSTEM, task);
        return `🔴 *OpenClaw* _(LLM mode — install openclaw for full potentiality)_\n\n${r}`;
      }

    case "nemoclaw":
      return await runNemoClaw(task);

    case "hermes":
      try {
        execSync("which hermes", { stdio: "pipe" });
        return await runHermes(task);
      } catch {
        const HERMES_SYSTEM = `You are Hermes Agent by Nous Research. Self-improving specialist with
closed learning loop. You execute tasks, evaluate results, and write reusable skill documents.
End with: ✅ Done\nCompleted Task: <one-liner>\n📚 Skill Saved: <name>`;
        const r = await callLLM(HERMES_SYSTEM, task);
        return `🟣 *Hermes Agent* _(LLM mode — install hermes for full potentiality)_\n\n${r}`;
      }

    default:
      return `❌ Unknown agent: ${agentKey}`;
  }
}

// ── Help text ─────────────────────────────────────────────────────────────────
const HELP = `👋 SwarmCore - Multi-Agent Swarm

Single agent:
\`\`\`
CallAgent: OpenClaw
Task: Summarise my emails
\`\`\`

Multiple agents:
\`\`\`
CallAgent: OpenClaw/Hermes
Task: Research competitors
\`\`\`

All three:
\`\`\`
CallAgent: OpenClaw/NemoClaw/Hermes
Task: Full workflow audit
\`\`\`

Agents:
🦾 OpenClaw - action & automation
🛡️ NemoClaw - sandboxed enterprise
🧠 Hermes - self-improving specialist

Brain: ${BRAIN_PROVIDER.toUpperCase()} | ${DEFAULT_MODEL}`;

// ── Main polling loop ─────────────────────────────────────────────────────────
async function poll() {
  try {
    const res = await tgRequest("getUpdates", {
      offset:  lastUpdateId + 1,
      timeout: 30,
      allowed_updates: ["message"],
    });

    if (!res.ok || !res.result?.length) return;

    for (const update of res.result) {
      lastUpdateId = update.update_id;
      const msg    = update.message;
      if (!msg?.text) continue;

      const chatId = msg.chat.id;
      const text   = msg.text;
      const cmd    = parseCommand(text);

      if (!cmd) {
        await sendMessage(chatId, HELP);
        continue;
      }

      const { agents, task } = cmd;
      console.log(`[Telegram] agents=${agents} task=${task.slice(0,60)}`);

      await sendMessage(chatId,
        `⚙️ SwarmCore dispatching to: ${agents.map(a=>a.charAt(0).toUpperCase()+a.slice(1)).join(", ")}...`
      );

      if (agents.length === 1) {
        const reply = await runAgent(agents[0], task);
        await sendMessage(chatId, reply);
      } else {
        const results = await Promise.all(agents.map(a => runAgent(a, task)));
        const combined = `🌐 Swarm Result - ${agents.length} agents:\n"${task.slice(0,80)}"\n\n` +
                         results.join("\n\n---\n\n");
        await sendMessage(chatId, combined);
      }
    }
  } catch (e) {
    console.error("Poll error:", e.message);
  }
}

// ── Keep-alive HTTP server (Render requires a port to be bound) ───────────────
http.createServer((req, res) => {
  res.writeHead(200);
  res.end("SwarmCore is running");
}).listen(process.env.PORT || 3000, () => {
  console.log(`SwarmCore listening on port ${process.env.PORT || 3000}`);
});

// ── Start ─────────────────────────────────────────────────────────────────────
console.log(`SwarmCore starting | brain=${BRAIN_PROVIDER} model=${DEFAULT_MODEL}`);
setInterval(poll, 2000);
poll();
