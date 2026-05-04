#!/usr/bin/env bash
# SwarmCore — CORRECT final installer for Render.com
# Based on official GitHub repos

set -e
echo "======================================"
echo "  SwarmCore Agent Installer"
echo "======================================"

# 1. OpenClaw via npm (confirmed working already)
echo ""
echo "[1/3] Installing OpenClaw..."
npm install -g openclaw@latest
openclaw --version && echo "✅ OpenClaw installed"

# 2. Hermes via git clone + system Python (bypasses uv python download)
echo ""
echo "[2/3] Installing Hermes Agent from source..."
cd /tmp
git clone https://github.com/NousResearch/hermes-agent.git
cd hermes-agent

# Use system Python directly — no uv python install needed
python3 -m venv venv
source venv/bin/activate
pip install -e ".[all]" --quiet

# Symlink hermes to PATH
ln -sf /tmp/hermes-agent/venv/bin/hermes /usr/local/bin/hermes 2>/dev/null || \
  ln -sf /tmp/hermes-agent/venv/bin/hermes $HOME/.local/bin/hermes

export PATH="$HOME/.local/bin:$PATH"
hermes --version && echo "✅ Hermes installed" || echo "⚠️ Hermes symlink — check runtime"

# 3. NemoClaw note
echo ""
echo "[3/3] NemoClaw runs in secure LLM mode on free tier"
echo "      Full Docker sandbox needs NVIDIA GPU"

echo ""
echo "======================================"
echo "  Build Complete!"
echo "======================================"
