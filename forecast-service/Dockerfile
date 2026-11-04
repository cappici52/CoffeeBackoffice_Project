FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py model.py selection.py engine.py forecast_errors.py ./
COPY artifacts ./artifacts
RUN useradd --create-home forecast && mkdir runtime && chown forecast:forecast runtime
USER forecast
EXPOSE 8001
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8001"]
