#!/usr/bin/env bash
set -euo pipefail

EXPECTED_SHA256='799803f4882ca2ece436ab1087c41641713377f8a33f9bab0f0f4636a381938e'
SOURCE_RELATIVE_DIR='recommendation-value-v6-prior-sweep-db-timeline-20260726/coarse-s10-a0p1-m10-w025-short-only-v2-3dbbdadce6b7'
TARGET_RELATIVE_DIR='recommendation-value-v6-live-candidates/v6-short-only-20260727'
SOURCE_APP_DIR='/app/apps/api/storage/recommendation-value-v6-prior-sweep-db-timeline-20260726/coarse-s10-a0p1-m10-w025-short-only-v2-3dbbdadce6b7'
VOLUME_NAME="${DEADLOCK_STORAGE_VOLUME_NAME:-deadlock_dynamo_helper_deadlock-storage}"

VOLUME_ROOT="$(sudo docker volume inspect \
  "$VOLUME_NAME" \
  --format '{{ .Mountpoint }}')"
SOURCE_DIR="$VOLUME_ROOT/$SOURCE_RELATIVE_DIR"
TARGET_DIR="$VOLUME_ROOT/$TARGET_RELATIVE_DIR"

if sudo test -e "$TARGET_DIR"; then
  for file_name in model.json manifest.json audit.json evaluation.json promotion.json; do
    sudo test -f "$TARGET_DIR/$file_name"
  done
  ACTUAL_SHA256="$(sudo sha256sum "$TARGET_DIR/model.json" | awk '{print $1}')"
  if [[ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]]; then
    echo "Immutable target exists with an unexpected model SHA-256: $ACTUAL_SHA256" >&2
    exit 1
  fi
  echo "Recommendation Value V6 artifact is already promoted at $TARGET_DIR"
  exit 0
fi

for file_name in model.json manifest.json audit.json evaluation.json; do
  sudo test -f "$SOURCE_DIR/$file_name"
done

sudo mkdir -p "$TARGET_DIR"
sudo cp "$SOURCE_DIR/model.json" "$TARGET_DIR/model.json"
sudo cp "$SOURCE_DIR/manifest.json" "$TARGET_DIR/manifest.json"
sudo cp "$SOURCE_DIR/audit.json" "$TARGET_DIR/audit.json"
sudo cp "$SOURCE_DIR/evaluation.json" "$TARGET_DIR/evaluation.json"

ACTUAL_SHA256="$(sudo sha256sum "$TARGET_DIR/model.json" | awk '{print $1}')"
if [[ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]]; then
  echo "Model SHA-256 mismatch: expected $EXPECTED_SHA256, received $ACTUAL_SHA256" >&2
  exit 1
fi

sudo tee "$TARGET_DIR/promotion.json" >/dev/null <<JSON
{
  "candidateId": "v6-short-only-20260727",
  "sourceDirectory": "$SOURCE_APP_DIR",
  "modelSha256": "$EXPECTED_SHA256",
  "usage": "GLOBAL_CANARY_OPERATOR_OVERRIDE",
  "productionRolloutAuthorized": true,
  "offlineReleaseGatePassed": false,
  "rolloutScope": "ALL_USERS"
}
JSON

sudo chmod -R a-w "$TARGET_DIR"
sudo sha256sum "$TARGET_DIR/model.json"
echo "Promoted immutable Recommendation Value V6 artifact to $TARGET_DIR"
