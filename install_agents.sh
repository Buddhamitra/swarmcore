#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# SwarmCore Agent Installer
# Installs OpenClaw, Hermes, and sets up Render environment
# Run once after deploying to Render
# ─────────────────────────────────────────────────────────────────

set -e
echo "======================================"
echo "  SwarmCore Agent Installer"
echo "======================================"

# ── 1. Node.js check ──────────────────────────────────────────────
echo ""
echo "[1/4] Checking Node.js..."
node --version || { echo "Node not found"; exit 1; }
npm --version

# ── 2. Install OpenClaw ───────────────────────────────────────────
echo ""
echo "[2/4] Installing OpenClaw..."
npm install -g openclaw@latest

echo "Verifying OpenClaw..."
openclaw --version && echo "✅ OpenClaw installed" || echo "⚠️ OpenClaw install may need manual check"

# ── 3. Install Hermes Agent ───────────────────────────────────────
echo ""
echo "[3/4] Installing Hermes Agent..."
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash

echo "Verifying Hermes..."
hermes --version && echo "✅ Hermes installed" || echo "⚠️ Hermes install may need manual check"

# ── 4. NemoClaw note ──────────────────────────────────────────────
echo ""
echo "[4/4] NemoClaw..."
echo "ℹ️  NemoClaw requires Docker + 8GB RAM + NVIDIA drivers."
echo "    On Render free tier it runs in secure LLM mode."
echo "    For full NemoClaw: curl -fsSL https://nvidia.com/nemoclaw.sh | bash"

# ── Done ──────────────────────────────────────────────────────────
echo ""
echo "======================================"
echo "  Installation Complete!"
echo "======================================"
echo ""
echo "OpenClaw: $(which openclaw 2>/dev/null || echo 'not found')"
echo "Hermes:   $(which hermes 2>/dev/null || echo 'not found')"
echo ""
echo "Now deploy swarm_gateway.js on Render as a Web Service."
