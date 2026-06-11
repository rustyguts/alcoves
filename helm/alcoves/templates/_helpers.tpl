{{/*
Expand the name of the chart.
*/}}
{{- define "alcoves.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Fully qualified app name.
*/}}
{{- define "alcoves.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "alcoves.frontend.fullname" -}}
{{- printf "%s-frontend" (include "alcoves.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "alcoves.api.fullname" -}}
{{- printf "%s-api" (include "alcoves.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "alcoves.worker.fullname" -}}
{{- printf "%s-worker" (include "alcoves.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "alcoves.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Common labels applied to every resource. commonLabels are merged in so
operators can stamp ownership/team labels chart-wide.
*/}}
{{- define "alcoves.labels" -}}
helm.sh/chart: {{ include "alcoves.chart" . }}
app.kubernetes.io/name: {{ include "alcoves.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- with .Values.commonLabels }}
{{ toYaml . }}
{{- end }}
{{- end -}}

{{/*
Selector labels — stable across chart versions. Never add anything here:
Deployment selectors are immutable, so a change would break in-place upgrades.
*/}}
{{- define "alcoves.selectorLabels" -}}
app.kubernetes.io/name: {{ include "alcoves.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "alcoves.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "alcoves.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/*
Image reference. One unified image runs every role (web | api | worker | all);
the workload templates select the role via the container `args`.
*/}}
{{- define "alcoves.image" -}}
{{- $tag := default .Chart.AppVersion .Values.image.tag -}}
{{ printf "%s:%s" .Values.image.repository $tag }}
{{- end -}}

{{/*
Name of the chart-managed secret referenced by env secretKeyRefs.
*/}}
{{- define "alcoves.appSecretName" -}}
{{- printf "%s-app" (include "alcoves.fullname" .) -}}
{{- end -}}

{{/*
Whether the chart-managed app secret has any keys to hold (every credential
may instead come from existing secrets).
*/}}
{{- define "alcoves.appSecretNeeded" -}}
{{- if or
  (not .Values.existingSessionSecret)
  (and .Values.database.url (not .Values.database.existingSecret))
  (and .Values.queue.password (not .Values.queue.existingSecret))
  (and .Values.oauth.google.clientId (not .Values.oauth.google.existingSecret))
  (and (eq .Values.storage.driver "s3") (not .Values.storage.s3.existingSecret))
  .Values.mcp.signingSecret
-}}
true
{{- end -}}
{{- end -}}

{{/*
Browser-facing API origin: binary streaming + the activity WebSocket bypass
the SvelteKit /api proxy via this origin.
*/}}
{{- define "alcoves.publicApiOrigin" -}}
{{- if .Values.frontend.publicApiOrigin -}}
{{- .Values.frontend.publicApiOrigin -}}
{{- else -}}
{{- .Values.baseUrl -}}
{{- end -}}
{{- end -}}

{{/*
Google login is on when either inline credentials or an existing secret are
configured — drives both the backend env wiring and the frontend's
PUBLIC_GOOGLE_AUTH_ENABLED flag.
*/}}
{{- define "alcoves.googleAuthEnabled" -}}
{{- if or .Values.oauth.google.clientId .Values.oauth.google.existingSecret -}}
true
{{- end -}}
{{- end -}}

{{/*
Pod-spec boilerplate shared by every workload. Call with
(dict "root" $ "comp" <component values>) and nindent to pod-spec level.
*/}}
{{- define "alcoves.podCommon" -}}
{{- $root := .root -}}
{{- $comp := .comp -}}
serviceAccountName: {{ include "alcoves.serviceAccountName" $root }}
automountServiceAccountToken: {{ $root.Values.serviceAccount.automountServiceAccountToken }}
{{- with $root.Values.imagePullSecrets }}
imagePullSecrets:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with $root.Values.podSecurityContext }}
securityContext:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with $comp.terminationGracePeriodSeconds }}
terminationGracePeriodSeconds: {{ . }}
{{- end }}
{{- with $comp.priorityClassName }}
priorityClassName: {{ . }}
{{- end }}
{{- with $comp.nodeSelector }}
nodeSelector:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with $comp.affinity }}
affinity:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with $comp.tolerations }}
tolerations:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with $comp.topologySpreadConstraints }}
topologySpreadConstraints:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end -}}

{{/*
Checksum of the chart-managed secret — annotate pods that consume it so a
credential change rolls them.
*/}}
{{- define "alcoves.appSecretChecksum" -}}
{{- include (print .Template.BasePath "/secret.yaml") . | sha256sum -}}
{{- end -}}

{{/*
Fail-fast validation of value combinations the app itself would reject (or
that would lose data / deadlock at runtime). Rendered from NOTES.txt so it
runs on install, upgrade, and template.
*/}}
{{- define "alcoves.validateValues" -}}
{{- if and (ne .Values.deploymentMode "distributed") (ne .Values.deploymentMode "standalone") -}}
{{- fail (printf "deploymentMode must be 'distributed' or 'standalone', got %q" .Values.deploymentMode) -}}
{{- end -}}
{{- if and (ne .Values.storage.driver "local") (ne .Values.storage.driver "s3") -}}
{{- fail (printf "storage.driver must be 'local' or 's3', got %q" .Values.storage.driver) -}}
{{- end -}}
{{- if and (not .Values.sessionSecret) (not .Values.existingSessionSecret) -}}
{{- fail "sessionSecret or existingSessionSecret is required (AES-GCM key, >=32 bytes; generate with `openssl rand -base64 48`)" -}}
{{- end -}}
{{- if and (not .Values.database.url) (not .Values.database.existingSecret) -}}
{{- fail "database.url or database.existingSecret is required (PostgreSQL with pgvector)" -}}
{{- end -}}
{{- if and .Values.mcp.oauth.enabled (not .Values.mcp.httpEnabled) -}}
{{- fail "mcp.oauth.enabled requires mcp.httpEnabled=true (the OAuth server protects the MCP HTTP transport)" -}}
{{- end -}}
{{- if and (eq .Values.deploymentMode "standalone") (gt (int .Values.standalone.replicaCount) 1) (eq .Values.storage.driver "local") (not (has "ReadWriteMany" .Values.storage.persistentVolume.accessModes)) -}}
{{- fail "standalone.replicaCount > 1 with local storage requires a ReadWriteMany access mode (or storage.driver=s3)" -}}
{{- end -}}
{{- end -}}
