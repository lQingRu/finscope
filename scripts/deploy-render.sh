#!/usr/bin/env bash
set -euo pipefail

: "${RENDER_API_KEY:?Set RENDER_API_KEY}"
: "${RENDER_SERVICE_ID:?Set RENDER_SERVICE_ID}"
: "${GITHUB_SHA:?Set GITHUB_SHA}"

deploys_url="https://api.render.com/v1/services/${RENDER_SERVICE_ID}/deploys"
post_data=$(jq -n --arg commit "$GITHUB_SHA" '{commitId: $commit}')
deployment=$(curl --fail --silent --show-error --max-time 30 \
  --header "Authorization: Bearer $RENDER_API_KEY" \
  --header 'Content-Type: application/json' \
  --data "$post_data" "$deploys_url")
deploy_id=$(jq -er '.id | strings | select(length > 0)' <<< "$deployment")

deadline=$((SECONDS + 900))
while (( SECONDS < deadline )); do
  deployment=$(curl --fail --silent --show-error --max-time 30 --retry 3 --retry-max-time 60 \
    --header "Authorization: Bearer $RENDER_API_KEY" "$deploys_url/$deploy_id")
  status=$(jq -er '.status' <<< "$deployment")
  case "$status" in
    live)
      if ! jq -e --arg commit "$GITHUB_SHA" '.commit.id == $commit' <<< "$deployment" > /dev/null; then
        echo "Render deployment $deploy_id went live with a different commit than $GITHUB_SHA." >&2
        exit 1
      fi
      echo "Render deployment $deploy_id is live at $GITHUB_SHA."
      exit 0
      ;;
    created|queued|build_in_progress|pre_deploy_in_progress|update_in_progress)
      sleep 10
      ;;
    *)
      echo "Render deployment $deploy_id returned status $status." >&2
      exit 1
      ;;
  esac
done

echo "Timed out waiting for Render deployment $deploy_id." >&2
exit 1
