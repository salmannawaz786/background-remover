FROM python:3.9-slim
RUN apt-get update && apt-get install -y libgl1
WORKDIR /app
COPY . .
RUN pip install --no-cache-dir -r requirements.txt
CMD ["waitress-serve", "--port=$PORT", "server:app"]
