#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# SwarmCore Agent Installer — Fixed for Render.com
# ─────────────────────────────────────────────────────────────────

set -e
echo "======================================"
echo "  SwarmCore Agent Installer"
echo "======================================"

# ── 1. Node.js check ──────────────────────────────────────────────
echo ""
echo "[1/5] Checking Node.js..."
node --version
npm --version

# ── 2. Install uv (Python package manager Hermes needs) ───────────
echo ""
echo "[2/5] Installing uv (Python package manager)..."
curl -LsSf https://astral.sh/uv/install.sh | sh

# Add uv to PATH for this script
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"

echo "uv version: $(uv --version)"
echo "✅ uv installed"

# ── 3. Install Python 3.11 via uv ─────────────────────────────────
echo ""
echo "[3/5] Installing Python 3.11..."
uv python install 3.11
echo "✅ Python 3.11 ready"

# ── 4. Install OpenClaw ───────────────────────────────────────────
echo ""
echo "[4/5] Installing OpenClaw..."
npm install -g openclaw@latest
openclaw --version && echo "✅ OpenClaw installed" || echo "⚠️ Check OpenClaw"

# ── 5. Install Hermes Agent ───────────────────────────────────────
echo ""
echo "[5/5] Installing Hermes Agent..."
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash

# Add hermes to PATH
export PATH="$HOME/.hermes/bin:$HOME/.local/bin:$PATH"

hermes --version && echo "✅ Hermes installed" || echo "⚠️ Check Hermes"

# ── NemoClaw note ─────────────────────────────────────────────────
echo ""
echo "ℹ️  NemoClaw: runs in secure LLM mode on free tier."
echo "    Full sandbox: curl -fsSL https://nvidia.com/nemoclaw.sh | bash"

# ── Done ──────────────────────────────────────────────────────────
echo ""
echo "======================================"
echo "  Installation Complete!"
echo "======================================"
echo "OpenClaw: $(which openclaw 2>/dev/null || echo 'check PATH')"
echo "Hermes:   $(which hermes 2>/dev/null || echo 'check PATH')"
echo "uv:       $(which uv 2>/dev/null || echo 'check PATH')"

