#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE_NAME="smpgbt"
CONTAINER_NAME="smpgbt-run"
ENV_FILE="${SCRIPT_DIR}/.env"
ENV_FILE_DOCKER="${SCRIPT_DIR}/.env.docker"
SCREENSHOT_TARGET="${SCRIPT_DIR}/proof.png"

cleanup() {
  rm -f "${ENV_FILE_DOCKER}" 2>/dev/null || true
  docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if ! command -v docker >/dev/null 2>&1; then
  echo "docker command not found. Install Docker first." >&2
  exit 1
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Environment file ${ENV_FILE} not found. Aborting." >&2
  exit 1
fi

# Produce a Docker-compatible env file (strip comments / blank lines).
sanitize_env() {
  while IFS= read -r line || [[ -n "${line}" ]]; do
    trimmed="${line#"${line%%[![:space:]]*}"}"
    [[ -z "${trimmed}" || "${trimmed:0:1}" == "#" ]] && continue
    sanitized="${trimmed%%[[:space:]]#*}"
    sanitized="${sanitized%"${sanitized##*[![:space:]]}"}"
    [[ -z "${sanitized}" ]] && continue
    echo "${sanitized}"
  done < "${ENV_FILE}"
}
sanitize_env > "${ENV_FILE_DOCKER}"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Building ${IMAGE_NAME} image..."
docker build -t "${IMAGE_NAME}" "${SCRIPT_DIR}"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting container ${CONTAINER_NAME}..."
set +e
docker run \
  --name "${CONTAINER_NAME}" \
  --env-file "${ENV_FILE_DOCKER}" \
  -v "${ENV_FILE}:/app/.env:ro" \
  "${IMAGE_NAME}"
RUN_STATUS=$?
set -e

if [[ ${RUN_STATUS} -ne 0 ]]; then
  echo "Container exited with status ${RUN_STATUS}. Last logs:" >&2
  docker logs "${CONTAINER_NAME}" >&2 || true
  exit "${RUN_STATUS}"
fi

if ! docker cp "${CONTAINER_NAME}:/app/proof.png" "${SCREENSHOT_TARGET}"; then
  echo "Warning: failed to copy proof.png from container." >&2
else
  echo "Screenshot saved to ${SCREENSHOT_TARGET}"
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Completed."

