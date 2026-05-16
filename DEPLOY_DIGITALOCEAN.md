# DocuStruct - DigitalOcean App Platform Deployment

**Platform**: DigitalOcean App Platform  
**Deployment Type**: Git-based (automatic)  
**Estimated Time**: 30-45 minutes  

---

## Prerequisites

✅ DigitalOcean account (with billing set up)  
✅ Git repository (GitHub, GitLab, or Bitbucket)  
✅ Domain name (ready to point to app)  
✅ DocuStruct code pushed to repository  

---

## Step 1: Prepare Your Git Repository

### 1.1 Push Code to GitHub (if not already done)

```bash
cd /path/to/docustruct

# Initialize git (if needed)
git init

# Add remote
git remote add origin https://github.com/your-username/docustruct.git

# Push to GitHub
git branch -M main
git push -u origin main
```

### 1.2 Verify Repository Structure

Your repo should have:
```
docustruct/
├── server/
│   ├── src/
│   ├── data/
│   ├── package.json
│   └── test-*.js
├── package.json (root)
└── .gitignore
```

### 1.3 Create .gitignore (if needed)

```bash
cat > .gitignore << 'EOF'
node_modules/
.env
.env.local
.DS_Store
server/data/docustruct.sqlite*
logs/
backups/
*.log
EOF

git add .gitignore
git commit -m "Add gitignore"
git push origin main
```

---

## Step 2: Create DigitalOcean App Configuration

### 2.1 Create app.yaml in Your Repository

```bash
cat > app.yaml << 'EOF'
name: docustruct
services:
- name: docustruct
  github:
    repo: YOUR_GITHUB_USERNAME/docustruct
    branch: main
  build_command: cd server && npm install
  run_command: cd server && npm start
  envs:
  - key: NODE_ENV
    value: production
  - key: PORT
    value: "3000"
  http_port: 3000
  health_check:
    http_path: /health
    initial_delay_seconds: 30
    period_seconds: 10
  resources:
    limits:
      cpus: "0.5"
      memory_mb: 1024
  log_destinations:
  - name: docustruct_logs
    datadog:
      api_key: ${DATADOG_API_KEY}
EOF

git add app.yaml
git commit -m "Add DigitalOcean App Platform configuration"
git push origin main
```

**Important**: Replace `YOUR_GITHUB_USERNAME` with your actual GitHub username.

### 2.2 Alternative: Simple Configuration (Minimal)

If you want a basic setup first:

```bash
cat > app.yaml << 'EOF'
name: docustruct
services:
- name: api
  github:
    repo: YOUR_GITHUB_USERNAME/docustruct
    branch: main
  build_command: cd server && npm install
  run_command: cd server && npm start
  envs:
  - key: NODE_ENV
    value: production
  - key: PORT
    value: "3000"
  http_port: 3000
EOF

git add app.yaml
git commit -m "Add DigitalOcean App Platform configuration"
git push origin main
```

---

## Step 3: Deploy on DigitalOcean

### 3.1 Create App on DigitalOcean

**Option A: Using Web Console (Easiest)**

1. Go to https://cloud.digitalocean.com/apps
2. Click "Create App"
3. Select GitHub
4. Choose your repository
5. Select `app.yaml` configuration file
6. Review settings
7. Click "Create Resources"
8. Wait for deployment (3-5 minutes)

**Option B: Using CLI**

```bash
# Install doctl CLI
# https://docs.digitalocean.com/reference/doctl/how-to/install/

doctl auth init
# Enter your API token

# Create app
doctl apps create --spec app.yaml

# Get app info
doctl apps list
```

### 3.2 Monitor Deployment

In the DigitalOcean console:
1. Go to Apps
2. Click your app (docustruct)
3. Watch the deployment progress
4. Should see: "Building" → "Deploying" → "Running"

---

## Step 4: Configure Your Domain

### 4.1 Get Your App's URL

After deployment completes:
1. Go to your app in DigitalOcean console
2. Copy the app URL (looks like: `docustruct-abc123.ondigitalocean.app`)

### 4.2 Configure DNS

**For your domain registrar:**

1. Go to your domain registrar (GoDaddy, Namecheap, etc.)
2. Find DNS settings
3. Add a CNAME record:
   - **Name**: `www` (or your subdomain)
   - **Value**: `docustruct-abc123.ondigitalocean.app`
4. Add an A record for root domain:
   - **Name**: `@` or leave blank
   - **Value**: DigitalOcean app IP (or use CNAME alias)

**Or in DigitalOcean:**

1. Go to your app
2. Click "Settings"
3. Scroll to "Domains"
4. Click "Add Domain"
5. Enter your domain
6. Update your domain registrar's DNS to point to DigitalOcean nameservers

### 4.3 Enable HTTPS

In DigitalOcean console:
1. App → Settings → Domains
2. Auto-managed TLS should be enabled by default
3. Certificate will be created automatically (wait 5-10 minutes)

---

## Step 5: Verify Deployment

### 5.1 Health Check

```bash
# Replace with your actual URL
curl https://yourdomain.com/health

# Expected response:
# {"status":"ok","version":"1.0.0","database":"connected"}
```

### 5.2 Test Core Features

```bash
# Get organizations
curl https://yourdomain.com/api/organizations

# Create test organization
curl -X POST https://yourdomain.com/api/organizations \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Org"}'
```

### 5.3 Check Logs

In DigitalOcean console:
1. App → docustruct → Component logs
2. Should see: "Database initialized", "Migration complete", "Server running on port 3000"

---

## Step 6: Post-Deployment Configuration

### 6.1 Set Environment Variables

If you need additional configuration:

1. App → Settings → Environment Variables
2. Add any additional variables:
   ```
   SENTRY_DSN=https://...  (for error tracking)
   LOG_LEVEL=info
   ```

### 6.2 Configure Auto-Deployment

Already configured in `app.yaml`! 
- Every push to `main` branch will auto-deploy

### 6.3 Configure Backups

DigitalOcean stores data in `/app/server/data/`:

1. App → Settings → Disks (if available)
2. Or manually backup via API

---

## Step 7: Run Tests (After Deployment)

### 7.1 SSH into App (Optional)

```bash
# Connect to your app's console
doctl apps get --format id docustruct | \
  xargs -I {} doctl apps create-exec {} --command "bash"

# Or run tests:
cd /app && npm --prefix server run test:phase4
```

### 7.2 Verify Multi-Tenancy

```bash
# Create 2 test organizations
# Verify Org A cannot see Org B's data
# This confirms deployment was successful
```

---

## Troubleshooting

### App Won't Start

**Error**: "Build failed"
```bash
# Check logs in DigitalOcean console
# Common issues:
# - Missing dependencies: Check npm install worked
# - Wrong node version: Update package.json engines field
# - Port already in use: Change PORT env variable
```

**Fix**:
```bash
# Fix locally first
npm --prefix server install
npm --prefix server run test:phase4

# Push to GitHub
git push origin main

# DigitalOcean will redeploy automatically
```

### Database Issues

**Error**: "Database connection failed"
```bash
# DigitalOcean App Platform uses local storage by default
# Database location: /app/server/data/docustruct.sqlite

# If persisting data is needed:
# Add a managed database and set DATABASE_URL environment variable
```

**Fix**: 
```bash
# Database auto-initializes on first run
# If issues persist, SSH and manually initialize:
cd /app/server
npm start
# Kill with Ctrl+C after database initializes
```

### Domain Not Working

**Error**: Domain not resolving
```bash
# Wait 5-10 minutes for DNS propagation
# Check: nslookup yourdomain.com
```

**Fix**:
```bash
# Verify CNAME/A records are set correctly
# Wait for DNS propagation (can take 24 hours)
# Test: curl https://yourdomain.com/health
```

### HTTPS Not Working

**Error**: Certificate not issued
```bash
# DigitalOcean auto-manages TLS
# Wait 5-10 minutes for cert generation
# Check App → Settings → Domains for cert status
```

**Fix**:
```bash
# If still not working:
# 1. Verify domain points to DigitalOcean
# 2. Check certificate status in console
# 3. Redeploy app (git push origin main)
```

---

## Monitoring

### 7.1 Set Up Alerts

In DigitalOcean:
1. Monitoring → Alerts
2. Add alerts for:
   - High CPU usage (> 70%)
   - High memory usage (> 80%)
   - App is down

### 7.2 View Metrics

1. App → Metrics
2. Monitor:
   - CPU usage (should be low)
   - Memory usage (should be < 500MB)
   - HTTP requests
   - Error rate

### 7.3 Check Logs

```bash
# In console:
App → docustruct → Component logs

# Monitor for:
- ✅ Database initialization
- ✅ Migration completion
- ✅ Server startup
- ❌ Any error messages
```

---

## Scaling

### Auto-scaling (Premium Feature)

1. App → Settings → Scaling
2. Set min/max instances
3. DigitalOcean auto-scales based on CPU/memory

### Manual Scaling

1. App → Components → docustruct
2. Increase instance count
3. Takes a few minutes to deploy

---

## Costs

### DigitalOcean App Platform Pricing

- **Compute**: $0.015/hour per container
- **Build**: $0.13/hour during builds
- **Transfer**: $0.01/GB outbound (first 100GB free)

**Estimated monthly cost** (1 container, low traffic): **$10-20/month**

---

## Next Steps

1. ✅ Prepare Git repository
2. ✅ Create app.yaml
3. ✅ Create app on DigitalOcean
4. ✅ Configure domain
5. ✅ Verify deployment
6. ✅ Monitor and scale

---

## Support & Rollback

### Check Status

```bash
doctl apps get docustruct
doctl apps list-deployments docustruct
```

### View Recent Deployments

In console: App → Deployments (shows all deployments with status)

### Rollback to Previous Version

```bash
# In console: Deployments tab
# Click the deployment you want to rollback to
# Click "Rollback"
```

### Emergency Stop

```bash
doctl apps delete docustruct
# or use console: App → Settings → Destroy App
```

---

## Success Checklist

- ✅ Repository pushed to GitHub
- ✅ app.yaml created and committed
- ✅ App created on DigitalOcean
- ✅ Deployment complete (status: Running)
- ✅ Domain configured
- ✅ HTTPS working
- ✅ Health check passing
- ✅ Tests passing
- ✅ Multi-tenancy verified

---

## Your App is Live! 🎉

**URL**: https://yourdomain.com  
**API**: https://yourdomain.com/api  
**Status Page**: https://yourdomain.com/health  

---

**Need help?** Check [LAUNCH_RUNBOOK.md](LAUNCH_RUNBOOK.md) for post-launch monitoring.

