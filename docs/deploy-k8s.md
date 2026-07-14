# Deploy no Kubernetes

Guia passo a passo para instalar o MemoryHub em qualquer cluster Kubernetes.
O MemoryHub usa um Helm chart único que funciona em todas as distribuições — o que muda entre plataformas é o **ingress controller** e a **storage class**.

---

## Sumário

- [Pré-requisitos](#pré-requisitos)
- [Visão geral das plataformas](#visão-geral-das-plataformas)
- [K3s (VPS / servidor próprio)](#k3s-vps--servidor-próprio)
- [EKS (Amazon Web Services)](#eks-amazon-web-services)
- [GKE (Google Cloud)](#gke-google-cloud)
- [AKS (Microsoft Azure)](#aks-microsoft-azure)
- [K8s genérico (Rancher, Microk8s, etc.)](#k8s-genérico)
- [Configurações comuns](#configurações-comuns)
- [Troubleshooting](#troubleshooting)

---

## Pré-requisitos

Necessários em **todas** as plataformas:

```bash
# Helm 3+
helm version   # deve retornar v3.x

# kubectl configurado para o cluster
kubectl cluster-info

# (opcional mas recomendado) cert-manager para TLS automático
# — instalação está em cada seção abaixo
```

Clonar o repositório para ter o Helm chart local:

```bash
git clone https://github.com/Tonny-Francis/MemoryHub.git
cd MemoryHub
```

---

## Visão geral das plataformas

| Plataforma | Ingress padrão | Storage class | TLS | Custo mínimo |
|---|---|---|---|---|
| **K3s** | Traefik (incluso) | local-path (incluso) | cert-manager | $5/mês (VPS) |
| **EKS** | AWS Load Balancer Controller | gp3 (EBS) | ACM | ~$70/mês |
| **GKE** | nginx-ingress ou GKE Ingress | standard-rwo | cert-manager | ~$70/mês |
| **AKS** | nginx-ingress | managed-csi | cert-manager | ~$70/mês |
| **K8s genérico** | nginx-ingress | depende do provider | cert-manager | variável |

---

## K3s (VPS / servidor próprio)

A opção mais simples e barata. Funciona em qualquer VPS (DigitalOcean, Hetzner, Vultr, Linode) com 2 GB RAM.

### 1. Instalar K3s

```bash
# No servidor (Ubuntu/Debian)
curl -sfL https://get.k3s.io | sh -

# Verificar
sudo k3s kubectl get nodes
```

K3s já vem com:
- **Traefik** como ingress controller (porta 80/443)
- **local-path-provisioner** para PVCs
- **CoreDNS**

### 2. Configurar kubectl local (opcional, para gerenciar do seu PC)

```bash
# No servidor
sudo cat /etc/rancher/k3s/k3s.yaml

# Copiar para ~/.kube/config no seu PC e trocar "127.0.0.1" pelo IP do servidor
```

### 3. Instalar cert-manager (TLS automático via Let's Encrypt)

```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/latest/download/cert-manager.yaml

# Aguardar os pods
kubectl -n cert-manager rollout status deployment/cert-manager
```

Criar o ClusterIssuer para Let's Encrypt:

```bash
cat <<EOF | kubectl apply -f -
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: seu@email.com
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
      - http01:
          ingress:
            class: traefik
EOF
```

### 4. Criar os secrets

```bash
kubectl create secret generic memoryhub-secrets \
  --from-literal=jwtSecret="$(openssl rand -hex 32)" \
  --from-literal=initialAdminEmail="admin@suaempresa.com" \
  --from-literal=initialAdminPassword="$(openssl rand -base64 16)" \
  --from-literal=gitVaultRepoUrl="https://oauth2:SEU_TOKEN@gitlab.com/org/vault.git" \
  --from-literal=gitlabToken="" \
  --from-literal=discordBotToken="" \
  --from-literal=discordChannelIds="" \
  --from-literal=trelloApiKey="" \
  --from-literal=trelloToken="" \
  --from-literal=anthropicApiKey=""
```

> **Dica:** salve os valores gerados — você vai precisar do `initialAdminPassword` para o primeiro login.

### 5. Instalar o MemoryHub

```bash
helm install memoryhub ./helm/memoryhub \
  --set ingress.className=traefik \
  --set ingress.annotations."cert-manager\.io/cluster-issuer"=letsencrypt-prod \
  --set 'ingress.annotations.traefik\.ingress\.kubernetes\.io/router\.entrypoints'=websecure \
  --set ingress.host=memoryhub.seudominio.com \
  --set ingress.tls=true \
  --set vault.persistence.storageClass=local-path \
  --set postgres.persistence.storageClass=local-path
```

### 6. Verificar

```bash
kubectl get pods          # memoryhub-xxx e memoryhub-postgres-xxx devem estar Running
kubectl get ingress       # deve mostrar o IP do servidor em ADDRESS
```

Apontar o DNS `memoryhub.seudominio.com` para o IP do servidor e aguardar 1-2 minutos para o certificado ser emitido.

---

## EKS (Amazon Web Services)

### 1. Pré-requisitos EKS

```bash
# AWS CLI configurado
aws sts get-caller-identity

# eksctl (para criar cluster, se necessário)
brew install eksctl   # ou https://eksctl.io

# Atualizar kubeconfig
aws eks update-kubeconfig --name NOME_DO_CLUSTER --region us-east-1
```

### 2. Criar cluster (pular se já existir)

```bash
eksctl create cluster \
  --name memoryhub \
  --region us-east-1 \
  --nodegroup-name workers \
  --node-type t3.medium \
  --nodes 2 \
  --nodes-min 1 \
  --nodes-max 3 \
  --managed
```

> Leva ~15 minutos. Cria VPC, subnets, node group e configura kubeconfig automaticamente.

### 3. Instalar AWS Load Balancer Controller

```bash
# IAM policy (só na primeira vez)
curl -o iam-policy.json https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/main/docs/install/iam_policy.json

aws iam create-policy \
  --policy-name AWSLoadBalancerControllerIAMPolicy \
  --policy-document file://iam-policy.json

# Service account com IRSA
eksctl create iamserviceaccount \
  --cluster=memoryhub \
  --namespace=kube-system \
  --name=aws-load-balancer-controller \
  --attach-policy-arn=arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):policy/AWSLoadBalancerControllerIAMPolicy \
  --approve

# Instalar via Helm
helm repo add eks https://aws.github.io/eks-charts
helm repo update
helm install aws-load-balancer-controller eks/aws-load-balancer-controller \
  -n kube-system \
  --set clusterName=memoryhub \
  --set serviceAccount.create=false \
  --set serviceAccount.name=aws-load-balancer-controller
```

### 4. Criar secrets

```bash
kubectl create secret generic memoryhub-secrets \
  --from-literal=jwtSecret="$(openssl rand -hex 32)" \
  --from-literal=initialAdminEmail="admin@suaempresa.com" \
  --from-literal=initialAdminPassword="$(openssl rand -base64 16)" \
  --from-literal=gitVaultRepoUrl="https://oauth2:TOKEN@gitlab.com/org/vault.git" \
  --from-literal=gitlabToken="" \
  --from-literal=discordBotToken="" \
  --from-literal=discordChannelIds="" \
  --from-literal=trelloApiKey="" \
  --from-literal=trelloToken="" \
  --from-literal=anthropicApiKey=""
```

### 5. Obter o ARN do certificado ACM

```bash
# Listar certificados disponíveis
aws acm list-certificates --region us-east-1 \
  | jq -r '.CertificateSummaryList[] | "\(.DomainName) — \(.CertificateArn)"'

# Se não tiver, solicitar um
aws acm request-certificate \
  --domain-name memoryhub.seudominio.com \
  --validation-method DNS \
  --region us-east-1
# Depois validar o DNS no painel da AWS
```

### 6. Instalar o MemoryHub

```bash
helm install memoryhub ./helm/memoryhub \
  --set ingress.host=memoryhub.seudominio.com \
  --set ingress.annotations."alb\.ingress\.kubernetes\.io/certificate-arn"=arn:aws:acm:us-east-1:123456789:certificate/xxxx \
  --set postgres.persistence.storageClass=gp3
```

> O `ingress.className=alb` já é o padrão do chart — não precisa especificar.

### 7. Obter o DNS do ALB

```bash
kubectl get ingress memoryhub
# ADDRESS vai mostrar algo como: xxxx.us-east-1.elb.amazonaws.com
```

Criar um CNAME no seu DNS apontando `memoryhub.seudominio.com` → esse endereço.

---

## GKE (Google Cloud)

### 1. Pré-requisitos GKE

```bash
# gcloud CLI configurado
gcloud auth login
gcloud config set project SEU_PROJETO

# Criar cluster (Autopilot — gerenciado, sem configurar nodes)
gcloud container clusters create-auto memoryhub \
  --region=us-central1

# Ou cluster Standard (mais controle)
gcloud container clusters create memoryhub \
  --zone=us-central1-a \
  --machine-type=e2-medium \
  --num-nodes=2

# Configurar kubectl
gcloud container clusters get-credentials memoryhub --region=us-central1
```

### 2. Instalar nginx-ingress

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update
helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace
```

### 3. Instalar cert-manager

```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/latest/download/cert-manager.yaml
kubectl -n cert-manager rollout status deployment/cert-manager
```

Criar ClusterIssuer:

```bash
cat <<EOF | kubectl apply -f -
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: seu@email.com
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
      - http01:
          ingress:
            class: nginx
EOF
```

### 4. Criar secrets e instalar

```bash
kubectl create secret generic memoryhub-secrets \
  --from-literal=jwtSecret="$(openssl rand -hex 32)" \
  --from-literal=initialAdminEmail="admin@suaempresa.com" \
  --from-literal=initialAdminPassword="$(openssl rand -base64 16)" \
  --from-literal=gitVaultRepoUrl="https://oauth2:TOKEN@gitlab.com/org/vault.git" \
  --from-literal=gitlabToken="" \
  --from-literal=discordBotToken="" \
  --from-literal=discordChannelIds="" \
  --from-literal=trelloApiKey="" \
  --from-literal=trelloToken=""

helm install memoryhub ./helm/memoryhub \
  --set ingress.className=nginx \
  --set ingress.annotations."cert-manager\.io/cluster-issuer"=letsencrypt-prod \
  --set ingress.annotations."nginx\.ingress\.kubernetes\.io/ssl-redirect"='"true"' \
  --set ingress.host=memoryhub.seudominio.com \
  --set ingress.tls=true \
  --set postgres.persistence.storageClass=standard-rwo
```

### 5. Obter IP externo

```bash
kubectl -n ingress-nginx get svc ingress-nginx-controller
# Pegar o EXTERNAL-IP e criar registro A no DNS
```

---

## AKS (Microsoft Azure)

### 1. Pré-requisitos AKS

```bash
# Azure CLI
az login
az account set --subscription "Sua Subscription"

# Criar resource group e cluster
az group create --name memoryhub-rg --location eastus

az aks create \
  --resource-group memoryhub-rg \
  --name memoryhub \
  --node-count 2 \
  --node-vm-size Standard_B2s \
  --generate-ssh-keys

# Configurar kubectl
az aks get-credentials --resource-group memoryhub-rg --name memoryhub
```

### 2. Instalar nginx-ingress e cert-manager

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update
helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace

kubectl apply -f https://github.com/cert-manager/cert-manager/releases/latest/download/cert-manager.yaml

cat <<EOF | kubectl apply -f -
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: seu@email.com
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
      - http01:
          ingress:
            class: nginx
EOF
```

### 3. Criar secrets e instalar

```bash
kubectl create secret generic memoryhub-secrets \
  --from-literal=jwtSecret="$(openssl rand -hex 32)" \
  --from-literal=initialAdminEmail="admin@suaempresa.com" \
  --from-literal=initialAdminPassword="$(openssl rand -base64 16)" \
  --from-literal=gitVaultRepoUrl="https://oauth2:TOKEN@gitlab.com/org/vault.git" \
  --from-literal=gitlabToken="" \
  --from-literal=discordBotToken="" \
  --from-literal=discordChannelIds="" \
  --from-literal=trelloApiKey="" \
  --from-literal=trelloToken=""

helm install memoryhub ./helm/memoryhub \
  --set ingress.className=nginx \
  --set ingress.annotations."cert-manager\.io/cluster-issuer"=letsencrypt-prod \
  --set ingress.host=memoryhub.seudominio.com \
  --set ingress.tls=true \
  --set postgres.persistence.storageClass=managed-csi
```

---

## K8s genérico

Para Rancher, Microk8s, Kind (local), OpenShift, ou qualquer K8s self-hosted.

### Passos universais

```bash
# 1. Instalar nginx-ingress (se não houver outro)
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace

# 2. Instalar cert-manager
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/latest/download/cert-manager.yaml

# 3. ClusterIssuer
cat <<EOF | kubectl apply -f -
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: seu@email.com
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
      - http01:
          ingress:
            class: nginx
EOF

# 4. Secrets
kubectl create secret generic memoryhub-secrets \
  --from-literal=jwtSecret="$(openssl rand -hex 32)" \
  --from-literal=initialAdminEmail="admin@suaempresa.com" \
  --from-literal=initialAdminPassword="$(openssl rand -base64 16)" \
  --from-literal=gitVaultRepoUrl="https://oauth2:TOKEN@gitlab.com/org/vault.git" \
  --from-literal=gitlabToken="" \
  --from-literal=discordBotToken="" \
  --from-literal=discordChannelIds="" \
  --from-literal=trelloApiKey="" \
  --from-literal=trelloToken=""

# 5. Instalar
helm install memoryhub ./helm/memoryhub \
  --set ingress.className=nginx \
  --set ingress.annotations."cert-manager\.io/cluster-issuer"=letsencrypt-prod \
  --set ingress.host=memoryhub.seudominio.com \
  --set ingress.tls=true
```

Para descobrir a storage class disponível no seu cluster:

```bash
kubectl get storageclass
```

Passar o nome com `--set postgres.persistence.storageClass=NOME` e `--set vault.persistence.storageClass=NOME`.

---

## Configurações comuns

### Banco de dados externo (RDS, Cloud SQL, etc.)

```bash
# 1. Adicionar a connection string ao secret
kubectl patch secret memoryhub-secrets \
  --type='json' \
  -p='[{"op":"add","path":"/data/databaseUrl","value":"'$(echo -n "postgresql://user:pass@host:5432/memoryhub" | base64)'"}]'

# 2. Instalar desabilitando o postgres bundled
helm install memoryhub ./helm/memoryhub \
  --set postgres.enabled=false \
  --set ingress.host=memoryhub.seudominio.com \
  # ... demais flags
```

> O banco externo precisa ter a extensão `vector` instalada:
> ```sql
> CREATE EXTENSION IF NOT EXISTS vector;
> ```

### Atualizar o MemoryHub

```bash
# Puxar novo código
git pull

# Rebuild da imagem (se self-hosted)
docker build -t ghcr.io/tonnysousa/memoryhub:latest .
docker push ghcr.io/tonnysousa/memoryhub:latest

# Atualizar o Helm release
helm upgrade memoryhub ./helm/memoryhub --reuse-values

# Ou forçar restart sem mudar values
kubectl rollout restart deployment/memoryhub
```

### Adicionar chaves de IA depois do deploy

```bash
# Patch no secret existente
kubectl patch secret memoryhub-secrets \
  --type='json' \
  -p='[
    {"op":"add","path":"/data/anthropicApiKey","value":"'$(echo -n "sk-ant-..." | base64)'"},
    {"op":"add","path":"/data/openaiApiKey","value":"'$(echo -n "sk-..." | base64)'"}
  ]'

# Restart para pegar as novas vars
kubectl rollout restart deployment/memoryhub
```

### Backup do vault

O vault é um volume persistente com git. Opção mais simples: configurar `GIT_VAULT_REPO_URL` para um repo privado no GitLab/GitHub — cada escrita é commitada e sincronizada automaticamente.

Para backup manual do PVC:

```bash
kubectl exec -it deployment/memoryhub -- tar czf - /data/vault > vault-backup-$(date +%Y%m%d).tar.gz
```

### Namespace dedicado

```bash
kubectl create namespace memoryhub

kubectl create secret generic memoryhub-secrets -n memoryhub \
  --from-literal=jwtSecret="..." \
  # ... outros secrets

helm install memoryhub ./helm/memoryhub \
  --namespace memoryhub \
  --set ingress.host=memoryhub.seudominio.com \
  # ... outros flags
```

---

## Troubleshooting

### Pod não sobe (CrashLoopBackOff)

```bash
kubectl logs deployment/memoryhub
kubectl describe pod -l app.kubernetes.io/name=memoryhub
```

Causas comuns:
- **Secret não encontrado**: verificar se `memoryhub-secrets` existe com `kubectl get secret memoryhub-secrets`
- **DATABASE_URL errada**: se `postgres.enabled=true`, a URL é gerada automaticamente — não precisa no secret
- **JWT_SECRET curto**: deve ter pelo menos 32 caracteres

### Postgres não inicializa

```bash
kubectl logs -l app.kubernetes.io/name=memoryhub-postgres
kubectl describe pvc memoryhub-postgres-pvc
```

Se a `storageClass` não existir, o PVC fica em `Pending`. Verificar com:

```bash
kubectl get storageclass
kubectl get pvc
```

### Certificado TLS pendente

```bash
kubectl describe certificate -l app.kubernetes.io/name=memoryhub
kubectl get challenges -A
```

Se o challenge ficar preso em `Pending`, verificar se o domínio resolve para o IP do ingress:

```bash
nslookup memoryhub.seudominio.com
kubectl get ingress memoryhub
```

### Ingress sem ADDRESS

No EKS: verificar se o AWS Load Balancer Controller está rodando:
```bash
kubectl -n kube-system get pods -l app.kubernetes.io/name=aws-load-balancer-controller
```

No K3s/GKE/AKS: verificar se o nginx-ingress tem IP externo:
```bash
kubectl -n ingress-nginx get svc ingress-nginx-controller
```

### Ver todos os logs de uma vez

```bash
kubectl logs deployment/memoryhub --follow
kubectl logs -l app.kubernetes.io/name=memoryhub-postgres --follow
```

### Reset completo (desenvolvimento)

```bash
helm uninstall memoryhub
kubectl delete secret memoryhub-secrets memoryhub-postgres-secret
kubectl delete pvc memoryhub-vault-pvc memoryhub-postgres-pvc
```

---

## Valores do Helm chart (referência completa)

| Valor | Padrão | Descrição |
|---|---|---|
| `image.repository` | `ghcr.io/tonnysousa/memoryhub` | Imagem Docker |
| `image.tag` | `latest` | Tag da imagem |
| `replicaCount` | `1` | Réplicas do app |
| `ingress.className` | `alb` | Ingress controller (`alb`, `nginx`, `traefik`) |
| `ingress.host` | `memoryhub.example.com` | Hostname público |
| `ingress.tls` | `true` | Habilitar TLS |
| `postgres.enabled` | `true` | Postgres in-cluster |
| `postgres.persistence.size` | `5Gi` | Tamanho do volume do banco |
| `postgres.persistence.storageClass` | `""` | Storage class (vazio = default do cluster) |
| `vault.persistence.size` | `2Gi` | Tamanho do volume do vault |
| `vault.persistence.storageClass` | `""` | Storage class do vault |
| `ingestion.enabled` | `true` | Habilitar CronJob de ingestão |
| `ingestion.schedule` | `0 */6 * * *` | Schedule do CronJob (a cada 6h) |
| `config.gitSyncIntervalMs` | `300000` | Intervalo de sync do vault (ms) |
| `secrets.existingSecret` | `memoryhub-secrets` | Nome do K8s Secret com credenciais |

Todos os valores podem ser sobrescritos com `--set chave=valor` ou via `values.yaml` customizado:

```bash
helm install memoryhub ./helm/memoryhub -f meu-values.yaml
```
