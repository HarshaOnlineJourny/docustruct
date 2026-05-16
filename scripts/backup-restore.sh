#!/bin/bash
# DocuStruct SaaS - Backup and Restore Script
#
# Usage:
#   ./scripts/backup-restore.sh backup         # Create backup
#   ./scripts/backup-restore.sh restore latest # Restore latest backup
#   ./scripts/backup-restore.sh restore v1     # Restore specific backup

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

BACKUP_DIR="./backups"
DB_FILE="server/data/docustruct.sqlite"
ACTION=${1:-backup}
TARGET=${2:-latest}
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Create backup directory
mkdir -p "$BACKUP_DIR"

log() {
  echo -e "$@"
}

# Backup function
backup() {
  log "${BLUE}Creating backup...${NC}"

  if [ ! -f "$DB_FILE" ]; then
    log "${YELLOW}⚠ Database not found at $DB_FILE${NC}"
    return 1
  fi

  local backup_file="$BACKUP_DIR/docustruct_${TIMESTAMP}.sqlite"

  # Copy database
  cp "$DB_FILE" "$backup_file"

  # Create metadata file
  cat > "${backup_file}.meta" << EOF
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "size_bytes": $(stat -f%z "$DB_FILE" 2>/dev/null || stat -c%s "$DB_FILE"),
  "backup_version": "1.0",
  "schema_version": "9"
}
EOF

  log "${GREEN}✓ Backup created: $backup_file${NC}"
  log "Size: $(du -h "$backup_file" | cut -f1)"

  # Create symlink to latest
  ln -sf "$(basename "$backup_file")" "$BACKUP_DIR/latest.sqlite"

  return 0
}

# List backups function
list_backups() {
  log "${BLUE}Available backups:${NC}"

  if [ ! -d "$BACKUP_DIR" ] || [ -z "$(ls -1 "$BACKUP_DIR"/*.sqlite 2>/dev/null)" ]; then
    log "${YELLOW}No backups found${NC}"
    return 1
  fi

  ls -lht "$BACKUP_DIR"/*.sqlite 2>/dev/null | awk '{print $9, "(" $5 ")"}'
}

# Restore function
restore() {
  local backup_file
  local source_file

  if [ "$TARGET" == "latest" ]; then
    source_file="$BACKUP_DIR/latest.sqlite"
  else
    # Find backup by pattern
    source_file=$(find "$BACKUP_DIR" -name "*${TARGET}*.sqlite" -type f | head -1)
  fi

  if [ ! -f "$source_file" ]; then
    log "${RED}✗ Backup not found: $TARGET${NC}"
    list_backups
    return 1
  fi

  log "${BLUE}Restoring from backup...${NC}"
  log "Source: $source_file"
  log "Target: $DB_FILE"

  # Create backup of current database
  if [ -f "$DB_FILE" ]; then
    log "${YELLOW}Creating backup of current database...${NC}"
    cp "$DB_FILE" "${DB_FILE}.pre-restore.backup"
    log "${GREEN}✓ Current database backed up to ${DB_FILE}.pre-restore.backup${NC}"
  fi

  # Restore
  cp "$source_file" "$DB_FILE"

  log "${GREEN}✓ Database restored successfully${NC}"
  log "Backup timestamp: $(cat "${source_file}.meta" 2>/dev/null | grep timestamp || echo 'unknown')"

  return 0
}

# Verify backup
verify() {
  local backup_file
  local source_file

  if [ "$TARGET" == "latest" ]; then
    source_file="$BACKUP_DIR/latest.sqlite"
  else
    source_file=$(find "$BACKUP_DIR" -name "*${TARGET}*.sqlite" -type f | head -1)
  fi

  if [ ! -f "$source_file" ]; then
    log "${RED}✗ Backup not found: $TARGET${NC}"
    return 1
  fi

  log "${BLUE}Verifying backup...${NC}"
  log "File: $source_file"
  log "Size: $(du -h "$source_file" | cut -f1)"

  if [ -f "${source_file}.meta" ]; then
    log "Metadata:"
    cat "${source_file}.meta" | grep -E "timestamp|size|schema"
  fi

  # Try to read from backup (basic check)
  if sqlite3 "$source_file" "SELECT COUNT(*) as table_count FROM sqlite_master WHERE type='table';" > /dev/null 2>&1; then
    log "${GREEN}✓ Backup is valid and readable${NC}"
    return 0
  else
    log "${RED}✗ Backup may be corrupted${NC}"
    return 1
  fi
}

# Show usage
usage() {
  cat << EOF
${BLUE}DocuStruct SaaS - Backup and Restore${NC}

Usage:
  $0 backup              Create a new backup
  $0 restore [backup]    Restore from backup (latest or specific)
  $0 list                List available backups
  $0 verify [backup]     Verify backup integrity

Examples:
  $0 backup              # Create backup
  $0 restore             # Restore latest backup
  $0 restore v1.0.0      # Restore v1.0.0 backup
  $0 list                # List all backups
  $0 verify latest       # Verify latest backup

Backup location: $BACKUP_DIR
Database location: $DB_FILE
EOF
}

# Main
case "$ACTION" in
  backup)
    backup
    ;;
  restore)
    restore
    ;;
  list)
    list_backups
    ;;
  verify)
    verify
    ;;
  *)
    usage
    exit 1
    ;;
esac

exit $?
