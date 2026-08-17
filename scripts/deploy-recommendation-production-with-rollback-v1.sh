#!/usr/bin/env bash
set -euo pipefail

PRODUCTION_TARGET="${RECOMMENDATION_PRODUCTION_TARGET:-/home/ubuntu/apps/deadlock_dynamo_helper}"
CANDIDATE_SOURCE="${RECOMMENDATION_CANDIDATE_SOURCE:?RECOMMENDATION_CANDIDATE_SOURCE is required}"
EVIDENCE_ROOT="${RECOMMENDATION_DEPLOY_EVIDENCE_ROOT:-/home/ubuntu/apps/deadlock_dynamo_helper-training/production-deploy-evidence}"
DEPLOY_ID="${RECOMMENDATION_DEPLOY_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
EVIDENCE_DIR="$EVIDENCE_ROOT/$DEPLOY_ID"
API_SERVICE="${RECOMMENDATION_API_SERVICE:-api}"
API_HEALTH_URL="${RECOMMENDATION_API_HEALTH_URL:-http://127.0.0.1:3000/health}"
RECOMMENDATION_STATUS_URL="${RECOMMENDATION_STATUS_URL:-http://127.0.0.1:3000/deadlock/analysis/contextual-v3-live/status}"
PREFLIGHT_SCRIPT="${RECOMMENDATION_PREFLIGHT_SCRIPT:-scripts/verify-contextual-v3-production-artifact-bundle.mjs}"
HEALTH_ATTEMPTS="${RECOMMENDATION_HEALTH_ATTEMPTS:-30}"
HEALTH_DELAY_SECONDS="${RECOMMENDATION_HEALTH_DELAY_SECONDS:-2}"

MUTATION_STARTED=false
ROLLBACK_STARTED=false
DEPLOY_SUCCEEDED=false
ROLLBACK_SOURCE_SHA=''
ROLLBACK_CONTAINER_ID=''
ROLLBACK_IMAGE_ID=''
ROLLBACK_IMAGE_REF=''
CANDIDATE_IMAGE_ID=''

mkdir -p "$EVIDENCE_DIR"

log() {
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$EVIDENCE_DIR/deploy.log"
}

write_state() {
  jq -n \
    --arg deployId "$DEPLOY_ID" \
    --arg phase "$1" \
    --arg productionTarget "$PRODUCTION_TARGET" \
    --arg candidateSource "$CANDIDATE_SOURCE" \
    --arg rollbackSourceSha "$ROLLBACK_SOURCE_SHA" \
    --arg rollbackContainerId "$ROLLBACK_CONTAINER_ID" \
    --arg rollbackImageId "$ROLLBACK_IMAGE_ID" \
    --arg rollbackImageRef "$ROLLBACK_IMAGE_REF" \
    --arg candidateImageId "$CANDIDATE_IMAGE_ID" \
    --argjson mutationStarted "$MUTATION_STARTED" \
    --argjson rollbackStarted "$ROLLBACK_STARTED" \
    --argjson deploySucceeded "$DEPLOY_SUCCEEDED" \
    '{schemaVersion:1,operation:"RECOMMENDATION_PRODUCTION_DEPLOY_WITH_ROLLBACK",deployId:$deployId,phase:$phase,productionTarget:$productionTarget,candidateSource:$candidateSource,rollbackSourceSha:$rollbackSourceSha,rollbackContainerId:$rollbackContainerId,rollbackImageId:$rollbackImageId,rollbackImageRef:$rollbackImageRef,candidateImageId:$candidateImageId,mutationStarted:$mutationStarted,rollbackStarted:$rollbackStarted,deploySucceeded:$deploySucceeded,trainingPerformed:false,valueTrainingPerformed:false,futureTestEvaluated:false}' \
    > "$EVIDENCE_DIR/state.json"
}

require_clean_candidate() {
  test -d "$CANDIDATE_SOURCE/.git"
  if [ -n "$(git -C "$CANDIDATE_SOURCE" status --porcelain)" ]; then
    echo 'Candidate source must be a clean Git checkout.' >&2
    exit 1
  fi
}

capture_rollback_target() {
  test -d "$PRODUCTION_TARGET/.git"
  test -r "$PRODUCTION_TARGET/.env"
  ROLLBACK_SOURCE_SHA="$(git -C "$PRODUCTION_TARGET" rev-parse HEAD)"
  ROLLBACK_CONTAINER_ID="$(cd "$PRODUCTION_TARGET" && sudo docker compose --env-file .env ps -q "$API_SERVICE" | head -n 1)"
  if [ -z "$ROLLBACK_CONTAINER_ID" ]; then
    echo 'Production API container is unavailable; no proven rollback target.' >&2
    exit 1
  fi
  ROLLBACK_IMAGE_ID="$(sudo docker inspect --format='{{.Image}}' "$ROLLBACK_CONTAINER_ID")"
  ROLLBACK_IMAGE_REF="$(cd "$PRODUCTION_TARGET" && sudo docker compose --env-file .env config --images | head -n 1)"
  if [ -z "$ROLLBACK_IMAGE_ID" ] || [ -z "$ROLLBACK_IMAGE_REF" ]; then
    echo 'Unable to capture production API rollback image.' >&2
    exit 1
  fi
  git -C "$PRODUCTION_TARGET" status --porcelain > "$EVIDENCE_DIR/production-status-before.txt"
  sudo docker inspect "$ROLLBACK_CONTAINER_ID" > "$EVIDENCE_DIR/rollback-container-inspect.json"
  sudo docker image inspect "$ROLLBACK_IMAGE_ID" > "$EVIDENCE_DIR/rollback-image-inspect.json"
  printf '%s\n' "$ROLLBACK_SOURCE_SHA" > "$EVIDENCE_DIR/rollback-source-sha.txt"
  printf '%s\n' "$ROLLBACK_IMAGE_ID" > "$EVIDENCE_DIR/rollback-image-id.txt"
  printf '%s\n' "$ROLLBACK_IMAGE_REF" > "$EVIDENCE_DIR/rollback-image-ref.txt"
  write_state 'ROLLBACK_TARGET_CAPTURED'
}

run_preflight() {
  log 'Running Contextual V3 artifact preflight before any production mutation.'
  (
    cd "$CANDIDATE_SOURCE"
    node "$PREFLIGHT_SCRIPT"
  ) | tee "$EVIDENCE_DIR/contextual-v3-preflight.json"
  write_state 'PREFLIGHT_PASSED'
}

verify_application_health() {
  local attempt
  for attempt in $(seq 1 "$HEALTH_ATTEMPTS"); do
    if curl --fail --silent --show-error "$API_HEALTH_URL" > "$EVIDENCE_DIR/application-health.json" 2> "$EVIDENCE_DIR/application-health.err"; then
      return 0
    fi
    sleep "$HEALTH_DELAY_SECONDS"
  done
  return 1
}

verify_recommendation_readiness() {
  local attempt
  for attempt in $(seq 1 "$HEALTH_ATTEMPTS"); do
    if curl --fail --silent --show-error "$RECOMMENDATION_STATUS_URL" > "$EVIDENCE_DIR/recommendation-status.json" 2> "$EVIDENCE_DIR/recommendation-status.err"; then
      if jq -e '.mode == "PRODUCTION" and .model.state == "READY"' "$EVIDENCE_DIR/recommendation-status.json" >/dev/null; then
        return 0
      fi
    fi
    sleep "$HEALTH_DELAY_SECONDS"
  done
  return 1
}

restore_source() {
  git -C "$PRODUCTION_TARGET" reset --hard "$ROLLBACK_SOURCE_SHA"
  git -C "$PRODUCTION_TARGET" clean -fd \
    -e .env \
    -e storage \
    -e 'storage/**'
}

rollback() {
  local original_status="$1"
  if [ "$MUTATION_STARTED" != true ] || [ "$DEPLOY_SUCCEEDED" = true ]; then
    return "$original_status"
  fi
  ROLLBACK_STARTED=true
  write_state 'ROLLBACK_STARTED'
  log "Deployment failed after mutation; restoring source $ROLLBACK_SOURCE_SHA and image $ROLLBACK_IMAGE_ID."

  set +e
  restore_source
  source_status=$?
  sudo docker image tag "$ROLLBACK_IMAGE_ID" "$ROLLBACK_IMAGE_REF"
  tag_status=$?
  (
    cd "$PRODUCTION_TARGET"
    sudo docker compose --env-file .env up -d --no-deps --no-build "$API_SERVICE"
  )
  restart_status=$?
  verify_application_health
  health_status=$?
  verify_recommendation_readiness
  readiness_status=$?
  set -e

  jq -n \
    --argjson sourceRestored "$([ "$source_status" -eq 0 ] && echo true || echo false)" \
    --argjson imageRetagged "$([ "$tag_status" -eq 0 ] && echo true || echo false)" \
    --argjson apiRestarted "$([ "$restart_status" -eq 0 ] && echo true || echo false)" \
    --argjson applicationHealthy "$([ "$health_status" -eq 0 ] && echo true || echo false)" \
    --argjson recommendationReady "$([ "$readiness_status" -eq 0 ] && echo true || echo false)" \
    '{schemaVersion:1,operation:"RECOMMENDATION_PRODUCTION_DEPLOY_ROLLBACK",sourceRestored:$sourceRestored,imageRetagged:$imageRetagged,apiRestarted:$apiRestarted,applicationHealthy:$applicationHealthy,recommendationReady:$recommendationReady,workflowMustRemainFailed:true,trainingPerformed:false,futureTestEvaluated:false}' \
    > "$EVIDENCE_DIR/rollback.json"
  write_state 'ROLLBACK_FINISHED'

  if [ "$source_status" -ne 0 ] || [ "$tag_status" -ne 0 ] || [ "$restart_status" -ne 0 ] || [ "$health_status" -ne 0 ] || [ "$readiness_status" -ne 0 ]; then
    log 'Rollback verification failed.'
    return 90
  fi
  log 'Rollback completed and previous recommendation readiness was verified. Deployment still fails by contract.'
  return "$original_status"
}

on_exit() {
  local status=$?
  trap - EXIT
  rollback "$status"
  exit $?
}
trap on_exit EXIT

require_clean_candidate
capture_rollback_target
run_preflight

log 'Preflight passed. Starting production source mutation.'
MUTATION_STARTED=true
write_state 'MUTATION_STARTED'

rsync -a --delete \
  --exclude '.git/' \
  --exclude '.env' \
  --exclude 'storage/' \
  "$CANDIDATE_SOURCE/" "$PRODUCTION_TARGET/"

(
  cd "$PRODUCTION_TARGET"
  sudo docker compose --env-file .env build "$API_SERVICE"
)
CANDIDATE_IMAGE_ID="$(cd "$PRODUCTION_TARGET" && sudo docker compose --env-file .env images -q "$API_SERVICE" | head -n 1)"
write_state 'CANDIDATE_BUILT'

(
  cd "$PRODUCTION_TARGET"
  sudo docker compose --env-file .env up -d --no-deps "$API_SERVICE"
)
write_state 'CANDIDATE_RESTARTED'

if ! verify_application_health; then
  log 'Candidate application health failed.'
  exit 20
fi
write_state 'APPLICATION_HEALTH_PASSED'

if ! verify_recommendation_readiness; then
  log 'Candidate recommendation readiness failed.'
  exit 21
fi

DEPLOY_SUCCEEDED=true
write_state 'DEPLOYMENT_PASSED'
log 'Candidate deployment passed application health and recommendation readiness.'
trap - EXIT
