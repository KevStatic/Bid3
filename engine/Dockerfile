FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY bid3_engine ./bid3_engine

# Mount a persistent volume here so auctions survive restarts.
ENV DATABASE_PATH=/data/bid3.sqlite
VOLUME ["/data"]

EXPOSE 8000
CMD ["python", "-m", "bid3_engine"]
