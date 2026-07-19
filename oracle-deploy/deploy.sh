#!/bin/bash
set -e

echo "========================================="
echo "Deploying Background Remover to Oracle"
echo "========================================="

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '#' | xargs)
fi

echo "[1/5] Building Docker image..."
docker-compose build --no-cache

echo "[2/5] Stopping existing containers..."
docker-compose down

echo "[3/5] Starting new containers..."
docker-compose up -d

echo "[4/5] Waiting for services to be healthy..."
sleep 10

echo "[5/5] Checking service health..."
if curl -f http://localhost:5000/health > /dev/null 2>&1; then
    echo "✅ Background Remover API is healthy!"
else
    echo "⚠️  Warning: Health check failed. Check logs with: docker-compose logs -f"
fi

echo ""
echo "========================================="
echo "Deployment complete!"
echo "========================================="
echo ""
echo "Service URLs:"
echo "  API: http://$(curl -s ifconfig.me)"
echo "  Health: http://$(curl -s ifconfig.me)/health"
echo "  Queue Stats: http://$(curl -s ifconfig.me)/api/queue/stats"
echo ""
echo "Useful commands:"
echo "  docker-compose ps          - View running containers"
echo "  docker-compose logs -f     - View live logs"
echo "  docker-compose restart     - Restart services"
echo "  docker-compose down        - Stop all services"
echo ""
