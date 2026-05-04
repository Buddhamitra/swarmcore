#!/usr/bin/env bash
# Repo 1: OpenClaw + NemoClaw installer
echo "=== Installing OpenClaw ==="
npm install -g openclaw@latest
openclaw --version && echo "✅ OpenClaw installed"
echo "=== Done ==="

