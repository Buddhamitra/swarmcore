FROM python:3.10-slim

# Install system dependencies
RUN apt-get update && apt-get install -y curl

# Install Ollama
RUN curl -fsSL https://ollama.com/install.sh | sh

WORKDIR /app
COPY . /app

# Install Python requirements
RUN pip install pyTelegramBotAPI

# Make startup script executable
RUN chmod +x start.sh

# Expose a port so Render stays happy
EXPOSE 8080

CMD ["./start.sh"]

