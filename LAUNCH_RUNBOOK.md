# DocuStruct SaaS - Launch Runbook

**Quick Reference for Launch Day**

---

## Timeline

### T-24 Hours (Day Before)
```
[ ] All team members notified
[ ] Infrastructure verified
[ ] DNS configured
[ ] SSL certificates installed
[ ] Database backups automated
[ ] Monitoring dashboards ready
[ ] Incident response channels active
[ ] Rollback procedure reviewed
```

### T-2 Hours (Before Launch)
```
[ ] Team logged in and ready
[ ] Monitoring dashboards open
[ ] Communication channels active
[ ] Final database backup created
[ ] Health check endpoints verified
[ ] Load testing completed
[ ] Emergency contacts confirmed
```

### T-30 Minutes
```
[ ] All systems go/no-go check
[ ] Team in launch channel
[ ] "Final GO" decision made
[ ] Maintenance window starts (if needed)
```

### T-0 (LAUNCH)

**Step 1: Deploy Code** (2-5 min)
```bash
./scripts/deploy.sh production v1.0.0
# Expect: Deployment logs, tests passing
# Monitor: Error rate, response time
```

**Step 2: Run Database Migration** (1-2 min)
```bash
# Migration runs automatically on startup
# Expect: Database schema v8 → v9
# Monitor: Database connections, migration status
```

**Step 3: Run Post-Deployment Tests** (2-3 min)
```bash
npm --prefix server run test:phase4
# Expect: 45/45 tests passing
# If failed: Initiate rollback
```

**Step 4: Verify All Systems** (5 min)
```bash
# Health checks
curl https://docustruct.com/health
# Expected: {"status": "ok", ...}

# API endpoints
curl https://docustruct.com/api/organizations
# Expected: 200 OK, valid response

# Database
# Check: Connections normal, queries responsive

# Monitoring
# Check: Error rate < 0.1%, response time < 500ms
```

**Step 5: Update Status & Notify Users** (2 min)
```
[ ] Update status page to "OPERATIONAL"
[ ] Send launch notification email
[ ] Update social media
[ ] Notify support team
[ ] Log launch event
```

### T+5 Minutes (Stabilization)
```
[ ] Monitor all error logs
[ ] Check database queries
[ ] Verify no alert spam
[ ] Confirm user sign-ups working
[ ] Monitor CPU/Memory usage
```

### T+15 Minutes (Comprehensive Check)
```
[ ] Create test organization
[ ] Create test template
[ ] Upload test document
[ ] Run test extraction
[ ] Verify multi-tenancy (2 orgs isolated)
[ ] Check response times (p95 < 500ms)
[ ] Verify backups running
```

### T+30 Minutes
```
[ ] Review error logs (should be clean)
[ ] Check database size (growing expected)
[ ] Monitor user adoption
[ ] Verify alert thresholds
[ ] No rollback needed: DECISION POINT
```

### T+1 Hour
```
[ ] Comprehensive system health check
[ ] Team debrief if needed
[ ] Update launch status: SUCCESSFUL
[ ] Continue monitoring for 24 hours
```

---

## Critical Commands

### Start Deployment
```bash
cd /path/to/docustruct
./scripts/deploy.sh production v1.0.0
# Takes ~5-10 minutes
# Includes: tests, backup, build, migration, verify
```

### Monitor Logs
```bash
# Real-time logs
npm --prefix server start

# or (production)
heroku logs --tail
docker-compose logs -f
tail -f /var/log/docustruct
```

### Emergency Rollback
```bash
# Fastest rollback
./scripts/backup-restore.sh restore latest
git checkout [previous-commit]
npm --prefix server install
npm --prefix server start

# Verify
curl https://docustruct.com/health
```

### Check Health
```bash
curl -v https://docustruct.com/health

# Expect:
# HTTP/1.1 200 OK
# {
#   "status": "ok",
#   "version": "1.0.0",
#   "database": "connected",
#   "uptime": 3600
# }
```

### Create Test Data
```bash
# Test with curl
curl -X POST https://docustruct.com/api/organizations \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Org"}'

# Expect: {"id": 1, "name": "Test Org", ...}
```

---

## Monitoring During Launch

### Key Metrics to Watch
```
Error Rate:        Should be < 0.1%
Response Time p95: Should be < 500ms
Uptime:            Should be 100% (initially)
CPU Usage:         Should be < 70%
Memory Usage:      Should be < 80%
Database Size:     Should be growing normally
Active Users:      Should be increasing
```

### Tools
- **Errors**: Sentry / CloudWatch
- **Performance**: DataDog / New Relic
- **Uptime**: UptimeRobot / Pingdom
- **Logs**: ELK Stack / Splunk / CloudWatch

### Alert Thresholds (Adjust Based on Traffic)
```
Error Rate > 1%:     WARNING
Response Time > 1s:  WARNING
CPU Usage > 85%:     CRITICAL
Memory > 90%:        CRITICAL
Database Disk > 80%: WARNING
```

---

## Decision Tree

### If Deployment Fails (T+5 min)

```
❌ Tests failing?
├─ YES → Stop. Rollback immediately.
│         Find and fix issue.
│         Re-deploy when ready.
└─ NO → Continue

❌ Health checks failing?
├─ YES → Database issue possible
│         Check connection logs
│         Rollback if persistent
└─ NO → Continue

❌ High error rate?
├─ YES (>1%) → Investigate logs
│               Determine if critical
│               Rollback if catastrophic
└─ NO → Continue

✅ All checks green?
├─ YES → Launch successful!
│         Continue monitoring
└─ NO → Investigate each failure
```

### If Error Rate Spikes (T+30 min)

```
Step 1: Identify pattern
├─ Specific endpoint? → Check logs for that endpoint
├─ Database? → Check connections, slow queries
├─ Code? → Check recent changes
└─ Infrastructure? → Check CPU, memory, network

Step 2: Assess severity
├─ Critical (>5% error rate) → Consider rollback
├─ Major (1-5%) → Start investigation, monitor closely
└─ Minor (<1%) → Monitor and log

Step 3: Decide
├─ Rollback if uncertain
└─ Fix if confident in solution
```

---

## Communication

### Launch Channels
- **Slack**: #launch-live (for real-time updates)
- **PagerDuty**: All-hands alert for critical issues
- **Email**: User notification when ready
- **Status Page**: Update docustruct.statuspage.io

### Launch Announcement Template
```
Subject: DocuStruct SaaS is Live! 🎉

We're excited to announce that DocuStruct SaaS 
is now available to all users.

What's new:
✅ Secure multi-tenant architecture
✅ Template management
✅ Document extraction
✅ AI-powered insights

Get started: https://docustruct.com

Support: support@docustruct.com
Status: https://docustruct.statuspage.io
```

---

## Post-Launch (First 24 Hours)

### Hour 1-4: Intensive Monitoring
```
[ ] Monitor every 5 minutes
[ ] Check error logs continuously
[ ] Watch user adoption
[ ] Verify backup completion
[ ] Confirm multi-tenancy working
[ ] Check database performance
```

### Hour 4-12: Regular Monitoring
```
[ ] Monitor every 15 minutes
[ ] Review error logs for patterns
[ ] Check database growth
[ ] Monitor user feedback channels
[ ] Verify all features working
```

### Hour 12-24: Maintenance Monitoring
```
[ ] Monitor every hour
[ ] Comprehensive system check
[ ] Prepare daily report
[ ] Document any issues
[ ] Plan any follow-up improvements
```

### Post-Launch Report (Day +1)
```
Launch Time:        [timestamp]
Status:             [Successful/Issues/Rollback]
Errors Encountered: [List any issues]
Resolution Time:    [Time to resolution if issues]
Performance:        [p95 response time, error rate]
Users Onboarded:    [Number]
Next Steps:         [Follow-up items]
```

---

## Team Roles

| Role | Responsibilities | Contact |
|------|------------------|---------|
| Launch Lead | Overall coordination | [Name] |
| DevOps | Deployment, infrastructure | [Name] |
| Database | Database migration, backups | [Name] |
| Monitoring | Alert response, metrics | [Name] |
| Support | User communication | [Name] |
| Product | Feature verification | [Name] |

---

## Escalation

```
Level 1: Engineer on-call
  ├─ Response time: 5 min
  └─ Authority: Fix immediate issues

Level 2: Engineering Manager
  ├─ Response time: 15 min
  └─ Authority: Approve rollback

Level 3: VP Engineering
  ├─ Response time: 30 min
  └─ Authority: Major decisions

Level 4: CTO/CEO
  ├─ Response time: Immediate
  └─ Authority: Final decisions
```

---

## Success Checklist

Launch is successful when:

- ✅ Deployment completed without errors
- ✅ All 45 tests passing
- ✅ Health checks green
- ✅ Error rate < 0.1%
- ✅ Response time p95 < 500ms
- ✅ Database connected and responsive
- ✅ Users can sign up
- ✅ Core features working
- ✅ Multi-tenancy verified
- ✅ No rollback initiated

**If all above checked**: 🎉 LAUNCH SUCCESSFUL

---

## Quick Reference

```
LAUNCH COMMAND:
./scripts/deploy.sh production v1.0.0

MONITORING:
heroku logs --tail

HEALTH CHECK:
curl https://docustruct.com/health

ROLLBACK:
./scripts/backup-restore.sh restore latest

EMERGENCY CONTACTS:
DevOps: [phone]
Database: [phone]
Engineering: [phone]
CTO: [phone]
```

---

**Status**: Ready to Launch 🚀  
**Last Updated**: 2026-05-16  
**Version**: 1.0.0

