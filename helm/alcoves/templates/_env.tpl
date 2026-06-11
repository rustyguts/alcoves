{{- /*
Shared backend env block used by the api, worker, and standalone workloads.
Plain config renders inline; credentials come from the chart-managed secret or
the configured existing secrets.
*/ -}}
{{- define "alcoves.backendEnv" -}}
- name: PORT
  value: {{ .Values.backend.api.port | quote }}
- name: ALCOVES_ENV
  value: {{ .Values.environment | quote }}
- name: ALCOVES_BASE_URL
  value: {{ .Values.baseUrl | quote }}
{{- with .Values.extraCorsOrigins }}
- name: ALCOVES_EXTRA_CORS_ORIGINS
  value: {{ join "," . | quote }}
{{- end }}
- name: ALCOVES_STORAGE_DRIVER
  value: {{ .Values.storage.driver | quote }}
{{- if eq .Values.storage.driver "local" }}
- name: ALCOVES_STORAGE_PATH
  value: /app/data
- name: ALCOVES_AVATAR_STORAGE_PATH
  value: /app/data/avatars
- name: ALCOVES_CACHE_STORAGE_PATH
  value: /app/data/.cache
- name: ALCOVES_MODELS_PATH
  value: /app/data/.models
- name: ALCOVES_WHISPER_MODELS_DIR
  value: /app/data/.whisper
{{- else if eq .Values.storage.driver "s3" }}
- name: ALCOVES_S3_BUCKET
  value: {{ .Values.storage.s3.bucket | quote }}
- name: ALCOVES_S3_REGION
  value: {{ .Values.storage.s3.region | quote }}
- name: ALCOVES_S3_ENDPOINT
  value: {{ .Values.storage.s3.endpoint | quote }}
- name: ALCOVES_S3_FORCE_PATH_STYLE
  value: {{ .Values.storage.s3.forcePathStyle | quote }}
- name: ALCOVES_S3_FILES_PREFIX
  value: {{ .Values.storage.s3.filesPrefix | quote }}
- name: ALCOVES_S3_AVATARS_PREFIX
  value: {{ .Values.storage.s3.avatarsPrefix | quote }}
- name: ALCOVES_S3_CACHE_PREFIX
  value: {{ .Values.storage.s3.cachePrefix | quote }}
{{- end }}
- name: ALCOVES_QUEUE_HOST
  value: {{ .Values.queue.host | quote }}
- name: ALCOVES_QUEUE_PORT
  value: {{ .Values.queue.port | quote }}
- name: ALCOVES_WHISPER_MODEL
  value: {{ .Values.models.whisperModel | quote }}
- name: ALCOVES_WHISPER_LANGUAGE
  value: {{ .Values.models.whisperLanguage | default "auto" | quote }}
- name: ALCOVES_WHISPER_VAD_MODEL
  value: {{ .Values.models.whisperVadModel | default "" | quote }}
- name: ALCOVES_WHISPER_MODEL_BASE_URL
  value: {{ .Values.models.whisperModelBaseUrl | quote }}
- name: ALCOVES_AUDIO_DETECT_MODEL_BASE_URL
  value: {{ .Values.models.audioDetectModelBaseUrl | quote }}
- name: ALCOVES_AUDIO_DETECT_LABELS_URL
  value: {{ .Values.models.audioDetectLabelsUrl | quote }}
{{- if .Values.mcp.httpEnabled }}
- name: ALCOVES_MCP_HTTP_ENABLED
  value: "true"
{{- end }}
{{- if .Values.mcp.oauth.enabled }}
- name: ALCOVES_MCP_OAUTH_ENABLED
  value: "true"
{{- if not .Values.mcp.oauth.dcrEnabled }}
- name: ALCOVES_MCP_OAUTH_DCR_ENABLED
  value: "false"
{{- end }}
{{- with .Values.mcp.oauth.accessTtl }}
- name: ALCOVES_MCP_OAUTH_ACCESS_TTL
  value: {{ . | quote }}
{{- end }}
{{- with .Values.mcp.oauth.refreshTtl }}
- name: ALCOVES_MCP_OAUTH_REFRESH_TTL
  value: {{ . | quote }}
{{- end }}
{{- with .Values.mcp.oauth.codeTtl }}
- name: ALCOVES_MCP_OAUTH_CODE_TTL
  value: {{ . | quote }}
{{- end }}
{{- with .Values.mcp.oauth.allowedRedirectHosts }}
- name: ALCOVES_MCP_OAUTH_ALLOWED_REDIRECT_HOSTS
  value: {{ join "," . | quote }}
{{- end }}
{{- end }}
{{- with .Values.sentry.backendDsn }}
- name: ALCOVES_SENTRY_DSN
  value: {{ . | quote }}
{{- end }}
{{- with .Values.sentry.tracesSampleRate }}
- name: ALCOVES_SENTRY_TRACES_SAMPLE_RATE
  value: {{ . | quote }}
{{- end }}
{{- with .Values.extraEnv }}
{{- toYaml . | nindent 0 }}
{{- end }}
- name: ALCOVES_SESSION_SECRET
  valueFrom:
    secretKeyRef:
      {{- if .Values.existingSessionSecret }}
      name: {{ .Values.existingSessionSecret }}
      key: sessionSecret
      {{- else }}
      name: {{ include "alcoves.appSecretName" . }}
      key: ALCOVES_SESSION_SECRET
      {{- end }}
- name: ALCOVES_DATABASE_URL
  valueFrom:
    secretKeyRef:
      {{- if .Values.database.existingSecret }}
      name: {{ .Values.database.existingSecret }}
      key: url
      {{- else }}
      name: {{ include "alcoves.appSecretName" . }}
      key: ALCOVES_DATABASE_URL
      {{- end }}
{{- if or .Values.queue.password .Values.queue.existingSecret }}
- name: ALCOVES_QUEUE_PASSWORD
  valueFrom:
    secretKeyRef:
      {{- if .Values.queue.existingSecret }}
      name: {{ .Values.queue.existingSecret }}
      key: password
      {{- else }}
      name: {{ include "alcoves.appSecretName" . }}
      key: ALCOVES_QUEUE_PASSWORD
      {{- end }}
{{- end }}
{{- if include "alcoves.googleAuthEnabled" . }}
- name: ALCOVES_OAUTH_GOOGLE_CLIENT_ID
  valueFrom:
    secretKeyRef:
      {{- if .Values.oauth.google.existingSecret }}
      name: {{ .Values.oauth.google.existingSecret }}
      key: clientId
      {{- else }}
      name: {{ include "alcoves.appSecretName" . }}
      key: ALCOVES_OAUTH_GOOGLE_CLIENT_ID
      {{- end }}
- name: ALCOVES_OAUTH_GOOGLE_CLIENT_SECRET
  valueFrom:
    secretKeyRef:
      {{- if .Values.oauth.google.existingSecret }}
      name: {{ .Values.oauth.google.existingSecret }}
      key: clientSecret
      {{- else }}
      name: {{ include "alcoves.appSecretName" . }}
      key: ALCOVES_OAUTH_GOOGLE_CLIENT_SECRET
      {{- end }}
{{- end }}
{{- if .Values.mcp.signingSecret }}
- name: ALCOVES_MCP_SIGNING_SECRET
  valueFrom:
    secretKeyRef:
      name: {{ include "alcoves.appSecretName" . }}
      key: ALCOVES_MCP_SIGNING_SECRET
{{- end }}
{{- if eq .Values.storage.driver "s3" }}
- name: ALCOVES_S3_ACCESS_KEY_ID
  valueFrom:
    secretKeyRef:
      {{- if .Values.storage.s3.existingSecret }}
      name: {{ .Values.storage.s3.existingSecret }}
      key: accessKeyId
      {{- else }}
      name: {{ include "alcoves.appSecretName" . }}
      key: ALCOVES_S3_ACCESS_KEY_ID
      {{- end }}
- name: ALCOVES_S3_SECRET_ACCESS_KEY
  valueFrom:
    secretKeyRef:
      {{- if .Values.storage.s3.existingSecret }}
      name: {{ .Values.storage.s3.existingSecret }}
      key: secretAccessKey
      {{- else }}
      name: {{ include "alcoves.appSecretName" . }}
      key: ALCOVES_S3_SECRET_ACCESS_KEY
      {{- end }}
{{- end }}
{{- end -}}

{{- /*
SvelteKit (adapter-node) env. Call with
(dict "root" $ "internalApiUrl" <url the SSR server + /api proxy should hit>).
*/ -}}
{{- define "alcoves.frontendEnv" -}}
{{- $root := .root -}}
- name: FRONTEND_HOST
  value: "0.0.0.0"
- name: FRONTEND_PORT
  value: {{ $root.Values.frontend.port | quote }}
{{- /* Derive the request origin from the ingress (no fixed ORIGIN needed). */}}
- name: FRONTEND_PROTOCOL_HEADER
  value: x-forwarded-proto
- name: FRONTEND_HOST_HEADER
  value: x-forwarded-host
{{- /* Unbounded so TUS chunk PATCHes streamed through the /api proxy aren't rejected. */}}
- name: FRONTEND_BODY_SIZE_LIMIT
  value: "Infinity"
- name: INTERNAL_API_URL
  value: {{ .internalApiUrl | quote }}
{{- /*
Browsers reach the API directly so video, image proxy, downloads + the
activity WebSocket bypass the SvelteKit /api proxy (avoids range-buffer
mangling and offloads streaming).
*/}}
- name: PUBLIC_API_ORIGIN
  value: {{ include "alcoves.publicApiOrigin" $root | quote }}
{{- if include "alcoves.googleAuthEnabled" $root }}
- name: PUBLIC_GOOGLE_AUTH_ENABLED
  value: "true"
{{- end }}
{{- with $root.Values.sentry.frontendDsn }}
- name: PUBLIC_SENTRY_DSN
  value: {{ . | quote }}
{{- end }}
{{- with $root.Values.frontend.map.tileUrl }}
- name: PUBLIC_MAP_TILE_URL
  value: {{ . | quote }}
{{- end }}
{{- with $root.Values.frontend.map.attribution }}
- name: PUBLIC_MAP_TILE_ATTRIBUTION
  value: {{ . | quote }}
{{- end }}
{{- with $root.Values.frontend.extraEnv }}
{{- toYaml . | nindent 0 }}
{{- end }}
{{- end -}}
