{{- /*
Shared backend env block reused by api + worker deployments.
Sources values from the in-chart secret and any existing-secret references.
*/ -}}
{{- define "alcoves.backendEnv" -}}
- name: PORT
  value: "{{ .Values.backend.api.port }}"
- name: ALCOVES_BASE_URL
  value: {{ .Values.baseUrl | quote }}
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
  value: "{{ .Values.storage.s3.forcePathStyle }}"
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
  value: "{{ .Values.queue.port }}"
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
{{- with .Values.extraEnv }}
{{- toYaml . | nindent 0 }}
{{- end }}

# Pull secrets — combined from generated chart secret + any existing-secret refs.
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
{{- if or .Values.oauth.google.clientId .Values.oauth.google.existingSecret }}
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
