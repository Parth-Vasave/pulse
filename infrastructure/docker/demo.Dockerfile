FROM python:3.12-slim
# Pick up Debian security fixes published after the base image was built.
RUN apt-get update && apt-get upgrade -y --no-install-recommends && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY demo-service/app.py .
RUN useradd --uid 10001 app
USER app
EXPOSE 9000
CMD ["python", "app.py"]
