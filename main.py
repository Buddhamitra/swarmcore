import os
import telebot
import subprocess

# Get API key from Render Environment Variables
bot = telebot.TeleBot(os.getenv('BOT_TOKEN'))

@bot.message_handler(func=lambda m: True)
def handle_swarm(message):
    if message.text.startswith("CALL:"):
        lines = message.text.split("\n")
        agent = lines[0].replace("CALL:", "").strip().lower()
        task = lines[1].replace("Task:", "").strip() if len(lines) > 1 else ""

        bot.reply_to(message, f"⚡ Swarm activating: {agent.upper()} is processing...")

        # Map 'CALL' names to Ollama models
        model_map = {
            "openclaw": "open-orca",
            "nemoclaw": "nemo",
            "hermes": "hermes"
        }

        model = model_map.get(agent)
        if not model:
            bot.reply_to(message, "❌ Unknown Agent.")
            return

        # Execute command via Ollama
        try:
            result = subprocess.check_output(f"ollama run {model} '{task}'", shell=True)
            bot.send_message(message.chat.id, result.decode('utf-8'))
        except Exception as e:
            bot.reply_to(message, f"Error: {str(e)}")

bot.infinity_polling()
