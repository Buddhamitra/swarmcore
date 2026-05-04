#!/bin/bash

# Start Ollama in background
ollama serve &
sleep 10

# Pull the models for your swarm
echo "Pulling models..."
ollama pull open-orca # Or your preferred model for OpenClaw
ollama pull nemo      # For NemoClaw security
ollama pull hermes

# Start the Python Telegram bridge
python main.py
