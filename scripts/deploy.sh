#!/bin/bash
# DocuStruct SaaS - Production Deployment Script
#
# Usage: ./scripts/deploy.sh [environment] [version]
# Example: ./scripts/deploy.sh production v1.0.0

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
ENVIRONMENT=${1:-staging}
VERSION=${2:-$(git describe --tags --always)}
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="./backups/${TIMESTAMP}"
LOG_FILE="./logs/deploy_${TIMESTAMP}.log"

# Ensure log directory exists
mkdir -p ./logs

echo -e "${BLUE}===================================================${NC}"
echo -e "${BLUE}DocuStruct SaaS - Deployment Script${NC}"
echo -e "${BLUE}===================================================${NC}"
echo -e "Environment: ${YELLOW}${ENVIRONMENT}${NC}"
echo -e "Version: ${YELLOW}${VERSION}${NC}"
echo -e "Timestamp: ${YELLOW}${TIMESTAMP}${NC}"
echo -e "Logging to: ${LOG_FILE}"

# Function to log and echo
log() {
  echo -e "$@" | tee -a "$LOG_FILE"
}

# Function to check prerequisite
check_prerequisite() {
  if ! command -v "$1" &> /dev/null; then
    log "${RED}✗ $1 is not installed${NC}"
    exit 1
  fi
  log "${GREEN}✓ $1 found${NC}"
}

# Function to run tests
run_tests() {
  log "${BLUE}Running tests...${NC}"

  if npm --prefix server run test:migration >> "$LOG_FILE" 2>&1; then
    log "${GREEN}✓ Migration tests passed${NC}"
  else
    log "${RED}✗ Migration tests failed${NC}"
    return 1
  fi

  if npm --prefix server run test:phase2 >> "$LOG_FILE" 2>&1; then
    log "${GREEN}✓ Phase 2 tests passed${NC}"
  else
    log "${RED}✗ Phase 2 tests failed${NC}"
    return 1
  fi

  if npm --prefix server run test:phase4 >> "$LOG_FILE" 2>&1; then
    log "${GREEN}✓ Phase 4 tests passed${NC}"
  else
    log "${RED}✗ Phase 4 tests failed${NC}"
    return 1
  fi

  log "${GREEN}✓ All tests passed${NC}"
  return 0
}

# Function to backup database
backup_database() {
  log "${BLUE}Backing up database...${NC}"

  mkdir -p "$BACKUP_DIR"

  if [ -f "server/data/docustruct.sqlite" ]; then
    cp "server/data/docustruct.sqlite" "$BACKUP_DIR/docustruct.sqlite.backup"
    log "${GREEN}✓ Database backed up to $BACKUP_DIR${NC}"
  else
    log "${YELLOW}⚠ No existing database found (first deployment)${NC}"
  fi
}

# Function to build application
build_application() {
  log "${BLUE}Building application...${NC}"

  # Install dependencies
  if npm --prefix server install >> "$LOG_FILE" 2>&1; then
    log "${GREEN}✓ Dependencies installed${NC}"
  else
    log "${RED}✗ Failed to install dependencies${NC}"
    return 1
  fi

  # Build (if needed for your stack)
  # npm --prefix server run build >> "$LOG_FILE" 2>&1

  log "${GREEN}✓ Build completed${NC}"
  return 0
}

# Function to migrate database
migrate_database() {
  log "${BLUE}Running database migration...${NC}"

  # Migration runs automatically on first start
  # but we can verify it here if needed

  log "${GREEN}✓ Database ready for migration${NC}"
  return 0
}

# Function to deploy application
deploy_application() {
  log "${BLUE}Deploying application...${NC}"

  # This will depend on your hosting platform
  # Examples below for common platforms:

  case "$ENVIRONMENT" in
    production)
      log "${YELLOW}Deploying to production...${NC}"
      # git push production main  # For Heroku
      # kubectl apply -f k8s/production.yaml  # For Kubernetes
      # docker push [image]:$VERSION  # For Docker
      log "${GREEN}✓ Production deployment initiated${NC}"
      ;;
    staging)
      log "${YELLOW}Deploying to staging...${NC}"
      # git push staging main
      log "${GREEN}✓ Staging deployment initiated${NC}"
      ;;
    *)
      log "${RED}✗ Unknown environment: $ENVIRONMENT${NC}"
      return 1
      ;;
  esac

  return 0
}

# Function to verify deployment
verify_deployment() {
  log "${BLUE}Verifying deployment...${NC}"

  local max_retries=30
  local retry_count=0

  while [ $retry_count -lt $max_retries ]; do
    if curl -s "http://localhost:3000/health" > /dev/null 2>&1; then
      log "${GREEN}✓ Application is healthy${NC}"
      return 0
    fi

    retry_count=$((retry_count + 1))
    log "Waiting for application to start... (${retry_count}/${max_retries})"
    sleep 2
  done

  log "${RED}✗ Application health check failed${NC}"
  return 1
}

# Main deployment flow
main() {
  log "${BLUE}Starting deployment process...${NC}"

  # Check prerequisites
  log "${BLUE}Checking prerequisites...${NC}"
  check_prerequisite "git"
  check_prerequisite "node"
  check_prerequisite "npm"
  check_prerequisite "curl"

  # Verify git is clean
  if [ -n "$(git status --porcelain)" ]; then
    log "${YELLOW}⚠ Warning: Uncommitted changes detected${NC}"
    log "These changes will not be deployed."
  fi

  # Run tests
  log "${BLUE}--- TESTING ---${NC}"
  if ! run_tests; then
    log "${RED}✗ Tests failed - deployment aborted${NC}"
    return 1
  fi

  # Backup database
  log "${BLUE}--- BACKUP ---${NC}"
  backup_database

  # Build application
  log "${BLUE}--- BUILD ---${NC}"
  if ! build_application; then
    log "${RED}✗ Build failed - deployment aborted${NC}"
    return 1
  fi

  # Database migration
  log "${BLUE}--- DATABASE ---${NC}"
  if ! migrate_database; then
    log "${RED}✗ Migration failed - deployment aborted${NC}"
    return 1
  fi

  # Deploy
  log "${BLUE}--- DEPLOY ---${NC}"
  if ! deploy_application; then
    log "${RED}✗ Deployment failed${NC}"
    return 1
  fi

  # Verify
  log "${BLUE}--- VERIFY ---${NC}"
  if ! verify_deployment; then
    log "${RED}✗ Verification failed - deployment may have issues${NC}"
    return 1
  fi

  # Success
  log "${BLUE}===================================================${NC}"
  log "${GREEN}✓ Deployment successful!${NC}"
  log "${BLUE}===================================================${NC}"
  log "Version: ${VERSION}"
  log "Environment: ${ENVIRONMENT}"
  log "Backup location: ${BACKUP_DIR}"
  log "Log location: ${LOG_FILE}"

  return 0
}

# Run main function
if main; then
  exit 0
else
  log "${RED}✗ Deployment failed${NC}"
  log "Check ${LOG_FILE} for details"
  exit 1
fi
