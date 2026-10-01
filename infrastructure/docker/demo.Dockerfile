FROM python:3.12-slim
WORKDIR /app
COPY demo-service/app.py .
RUN useradd --uid 10001 app
USER app
EXPOSE 9000
CMD ["python", "app.py"]
