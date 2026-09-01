#!/usr/bin/env bash
set -euo pipefail

expected_revision="${1:?expected revision is required}"
container_id="${2:?API container id is required}"
candidate_image="${3:?candidate image reference is required}"

running_revision="$(docker inspect \
  --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' \
  "$container_id")"
running_image_id="$(docker inspect --format '{{.Image}}' "$container_id")"
candidate_image_id="$(docker image inspect --format '{{.Id}}' "$candidate_image")"

if [ "$running_revision" != "$expected_revision" ]; then
  echo "API revision mismatch: expected $expected_revision, got ${running_revision:-missing}" >&2
  exit 1
fi

if [ "$running_image_id" != "$candidate_image_id" ]; then
  echo "API image mismatch: expected $candidate_image_id, got $running_image_id" >&2
  exit 1
fi

printf 'Verified API revision=%s image=%s\n' "$running_revision" "$running_image_id"
