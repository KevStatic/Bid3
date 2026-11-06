FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY bid3_engine ./bid3_engine

# Attach a Railway volume at /data so auctions survive restarts (the VOLUME keyword is rejected by Railway).
ENV DATABASE_PATH=/data/bid3.sqlite

EXPOSE 8010
CMD ["python", "-m", "bid3_engine"]
