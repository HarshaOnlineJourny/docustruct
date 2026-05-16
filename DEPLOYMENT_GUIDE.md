# DocuStruct SaaS - Deployment Guide

**Target Platforms**: Heroku, AWS, Digital Ocean, Self-Hosted  
**Database**: SQLite (dev/staging) or PostgreSQL (production)  
**Minimum Requirements**: Node.js 18+, npm 9+

---

## Quick Start Deployment

### Option 1: Heroku (Fastest)

```bash
# 1. Install Heroku CLI
npm install -g heroku

# 2. Login to Heroku
heroku login

# 3. Create Heroku app
heroku create docustruct-saas

# 4. Configure environment
heroku config:set NODE_ENV=production
heroku config:set PORT=5000

# 5. Deploy
git push heroku main

# 6. Verify
heroku logs --tail
heroku open
```

### Option 2: AWS EC2

```bash
# 1. Launch EC2 instance (Ubuntu 22.04)
# t3.medium recommended (2 CPU, 4GB RAM)

# 2. Connect via SSH
ssh -i key.pem ubuntu@your-instance-ip

# 3. Setup Node.js
sudo apt update
sudo apt install nodejs npm -y
node --version  # Should be 18+

# 4. Clone repository
git clone https://github.com/yourorg/docustruct.git
cd docustruct

# 5. Install dependencies
npm --prefix server install

# 6. Configure environment
export NODE_ENV=production
export PORT=3000

# 7. Start application
npm --prefix server start

# 8. Setup PM2 (process manager)
npm install -g pm2
pm2 start "npm --prefix server start" --name docustruct
pm2 startup
pm2 save
```

### Option 3: Digital Ocean App Platform

```bash
# 1. Create app.yaml in your repo
cat > app.yaml << 'EOF'
name: docustruct
services:
- name: docustruct
  github:
    repo: yourorg/docustruct
    branch: main
  build_command: npm --prefix server install
  run_command: npm --prefix server start
  envs:
  - key: NODE_ENV
    value: production
  - key: PORT
    value: "3000"
EOF

# 2. Deploy to Digital Ocean
doctl apps create --spec app.yaml

# 3. Monitor deployment
doctl apps get --format name,updated_at
```

### Option 4: Self-Hosted (Docker)

```bash
# 1. Create Dockerfile
cat > Dockerfile << 'EOF'
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
COPY server/package*.json ./server/

RUN npm install
RUN npm --prefix server install

COPY . .

EXPOSE 3000

ENV NODE_ENV=production

CMD ["npm", "--prefix", "server", "start"]
EOF

# 2. Create Docker Compose
cat > docker-compose.yml << 'EOF'
version: '3.8'
services:
  docustruct:
    build: .
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
    volumes:
      - ./server/data:/app/server/data
    restart: always
EOF

# 3. Build and run
docker-compose up -d

# 4. View logs
docker-compose logs -f
```

---

## Pre-Deployment Checklist

### Application
- [ ] All tests passing (45/45)
- [ ] No console errors
- [ ] No security warnings
- [ ] Environment variables configured
- [ ] API keys stored securely
- [ ] HTTPS configured

### Database
- [ ] Database backup created
- [ ] Migration tested
- [ ] Connection string configured
- [ ] Credentials secured
- [ ] Backup automated

### Infrastructure
- [ ] Hosting account created
- [ ] Server provisioned
- [ ] DNS configured
- [ ] SSL certificate installed
- [ ] Firewall rules set
- [ ] Load balancer configured (if needed)

### Monitoring
- [ ] Error tracking (Sentry) configured
- [ ] Application monitoring configured
- [ ] Logging configured
- [ ] Alerts configured
- [ ] Uptime monitoring configured

---

## Deployment Steps

### 1. Pre-Deployment Testing

```bash
# Run all tests locally
npm --prefix server run test:migration
npm --prefix server run test:phase2
npm --prefix server run test:phase4

# Expected output: All tests passing
```

### 2. Database Backup

```bash
# Backup current database
./scripts/backup-restore.sh backup

# Verify backup
./scripts/backup-restore.sh verify latest
```

### 3. Build and Test

```bash
# Install dependencies
npm --prefix server install

# Run final tests
npm --prefix server run test:phase4

# Build (if applicable)
npm --prefix server run build
```

### 4. Deploy to Staging

```bash
# Deploy to staging environment
./scripts/deploy.sh staging

# Run smoke tests
curl http://staging.example.com/health
curl http://staging.example.com/api/organizations

# Verify multi-tenancy
# Create 2 test organizations
# Verify org A cannot see org B's data
```

### 5. Deploy to Production

```bash
# Create final backup
./scripts/backup-restore.sh backup

# Deploy to production
./scripts/deploy.sh production

# Monitor deployment
./scripts/health-check.sh production
```

### 6. Post-Deployment Verification

```bash
# Check application health
curl https://yourdomain.com/health

# Verify endpoints
curl https://yourdomain.com/api/organizations
curl https://yourdomain.com/api/templates

# Check logs
heroku logs --tail
# or
docker-compose logs -f

# Monitor metrics
# Check error rate, response times, uptime
```

---

## Environment Configuration

### Required Environment Variables

```bash
NODE_ENV=production
PORT=3000
DATABASE_URL=file:./data/docustruct.sqlite (or postgresql://...)
LOG_LEVEL=info
DEBUG=false
```

### Optional Environment Variables

```bash
# Security
CORS_ORIGIN=https://yourdomain.com
SECURE_COOKIES=true
SESSION_SECRET=your-random-secret-key

# Monitoring
SENTRY_DSN=https://...@sentry.io/...
DATADOG_API_KEY=...

# Email (for notifications)
SMTP_HOST=smtp.sendgrid.net
SMTP_USER=apikey
SMTP_PASS=...

# Backup
BACKUP_FREQUENCY=daily
BACKUP_RETENTION_DAYS=30
```

### Setting Environment Variables

**Heroku**:
```bash
heroku config:set NODE_ENV=production
heroku config:set PORT=3000
```

**AWS EC2**:
```bash
export NODE_ENV=production
# Add to ~/.bashrc or systemd service
```

**Docker**:
```bash
# In docker-compose.yml or docker run
environment:
  NODE_ENV: production
  PORT: 3000
```

---

## Database Configuration

### SQLite (Development/Small Scale)
```bash
# Automatically created at: server/data/docustruct.sqlite
# No additional configuration needed
# Suitable for: <1000 users, <1GB data
```

### PostgreSQL (Production/Large Scale)

```bash
# 1. Create database
createdb docustruct_prod

# 2. Create user
createuser docustruct_user
psql -U postgres -d docustruct_prod -c "ALTER USER docustruct_user WITH PASSWORD 'secure-password';"

# 3. Grant privileges
psql -U postgres -d docustruct_prod -c "GRANT ALL PRIVILEGES ON DATABASE docustruct_prod TO docustruct_user;"

# 4. Set connection string
export DATABASE_URL="postgresql://docustruct_user:secure-password@localhost:5432/docustruct_prod"

# 5. Update db.js to use PostgreSQL
# (See DATABASE_ADAPTER configuration)
```

---

## Monitoring Setup

### Application Monitoring (Sentry)

```bash
# 1. Create Sentry account and project
# 2. Get DSN from project settings
# 3. Set environment variable
heroku config:set SENTRY_DSN=https://...@sentry.io/...

# 4. Sentry will automatically capture errors
```

### Logging Setup

```bash
# View logs locally
npm --prefix server start

# Production logs
heroku logs --tail            # Heroku
docker-compose logs -f        # Docker
tail -f /var/log/docustruct   # Self-hosted
```

### Performance Monitoring

Monitor these metrics:
- **Error Rate**: Target <0.1%
- **Response Time p95**: Target <500ms
- **Uptime**: Target 99.9%
- **CPU Usage**: Target <70%
- **Memory Usage**: Target <80%
- **Database Connections**: Monitor for leaks

---

## Scaling

### Horizontal Scaling

```bash
# Heroku
heroku ps:scale web=2     # Add dyno
heroku ps:scale web=5     # Scale up

# AWS
# Use Auto Scaling Group
# Update min/max instances

# Docker
docker-compose up -d --scale docustruct=3
```

### Database Scaling

```bash
# Migrate SQLite → PostgreSQL
# Add read replicas
# Enable connection pooling
# Optimize indices
```

---

## Rollback Procedure

### If Deployment Fails

```bash
# 1. Stop the application
# heroku restart
# docker-compose down

# 2. Restore from backup
./scripts/backup-restore.sh restore latest

# 3. Rollback code
git revert HEAD
git push heroku rollback:main

# 4. Restart
# heroku ps:restart
# docker-compose up -d

# 5. Verify
curl https://yourdomain.com/health
```

---

## Health Check

```bash
# Create health check endpoint
curl https://yourdomain.com/health

# Expected response:
{
  "status": "ok",
  "version": "v1.0.0",
  "database": "connected",
  "uptime": 3600
}
```

---

## Updates & Patches

### Deploying Updates

```bash
# 1. Test locally
npm --prefix server run test:phase4

# 2. Deploy to staging
./scripts/deploy.sh staging

# 3. Test on staging
npm --prefix server run test:phase4

# 4. Deploy to production
./scripts/deploy.sh production

# 5. Verify
npm --prefix server run test:phase4
```

### Zero-Downtime Deployments

```bash
# Use blue-green deployment
# 1. Deploy new version to separate instance
# 2. Run tests
# 3. Switch load balancer
# 4. Keep old version for quick rollback
```

---

## Support & Troubleshooting

### Common Issues

**Port already in use**:
```bash
lsof -i :3000
kill -9 <PID>
```

**Database locked**:
```bash
# SQLite only - single connection
# Switch to PostgreSQL for production
```

**Memory leak**:
```bash
# Monitor memory usage
# Restart application gracefully
```

### Emergency Contacts

- **Platform Support**: [Platform's support email]
- **Database Admin**: [Admin contact]
- **DevOps Engineer**: [Engineer contact]

---

## Success Criteria

✅ Application starts without errors  
✅ All endpoints responding  
✅ Database connection established  
✅ Multi-tenancy verified  
✅ Tests passing (45/45)  
✅ Monitoring active  
✅ Alerts configured  

**Deployment Status**: Ready for production ✅

