$ErrorActionPreference = "Stop"

# Define paths
$projectRoot = Get-Location
$ansibleDir = Join-Path $projectRoot "ansible"
$kubeconfigPath = Join-Path $ansibleDir "kubeconfig_flattened"

Write-Host "Preparing Kubeconfig for Ansible..."
# Flatten kubeconfig to include certificates and output to a temp file in ansible dir
kubectl config view --flatten > $kubeconfigPath

# Replace 'localhost' or '127.0.0.1' with 'host.docker.internal' to allow container access to minikube
# Note: This is a simple replace. If your minikube IP is different, this might need adjustment.
# But usually minikube tunnel or proxy makes localhost work on host, but from container we need host.docker.internal
$content = Get-Content $kubeconfigPath -Raw
$content = $content -replace "127.0.0.1", "host.docker.internal" -replace "localhost", "host.docker.internal"
Set-Content -Path $kubeconfigPath -Value $content

Write-Host "Running Ansible Playbook in Docker..."
# Run Ansible in Docker
# We mount:
# 1. Project root to /project
# 2. ansible/kubeconfig_flattened to /root/.kube/config
# We use cytopia/ansible or alpine/ansible or similar that has kubernetes collection or pip installed
# Let's use a custom command to ensure dependencies.
# We'll use a standard python image and install ansible + kubernetes lib on the fly for reliability, or a fat ansible image if available.
# 'willhallonline/ansible:alpine' is a popular one. Let's try to use a standard one.

docker run --rm -it `
  -v "${projectRoot}:/project" `
  -v "${kubeconfigPath}:/root/.kube/config" `
  --add-host=host.docker.internal:host-gateway `
  -e K8S_AUTH_KUBECONFIG=/root/.kube/config `
  willhallonline/ansible:alpine `
  sh -c "apk add --no-cache curl && curl -LO https://dl.k8s.io/release/v1.28.0/bin/linux/amd64/kubectl && chmod +x kubectl && mv kubectl /usr/local/bin/ && ansible-playbook -i /project/ansible/inventory /project/ansible/deploy.yml"

Write-Host "Ansible execution complete."
