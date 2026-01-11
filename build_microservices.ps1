$services = @("auth", "user", "friend", "message", "realtime", "gateway")

foreach ($service in $services) {
    Write-Host "Building secure-whisper-$service..."
    minikube image build -t secure-whisper-$service:latest ./services/$service
}

Write-Host "All microservices built successfully!"
