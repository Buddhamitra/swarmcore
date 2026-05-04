#!/bin/bash
ollama serve & 
sleep 5

echo "Pulling stable models..."
# Using standard names that are small enough for Render's 512MB RAM
ollama pull llama3.2:1b
ollama pull tinydolphin

echo "Starting Trident Core..."
python main.py
