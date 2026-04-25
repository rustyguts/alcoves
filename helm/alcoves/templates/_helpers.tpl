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

{{- define "alcoves.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
app.kubernetes.io/name: {{ include "alcoves.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

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
Image reference helpers.
*/}}
{{- define "alcoves.backend.image" -}}
{{- $tag := default .Chart.AppVersion .Values.image.backend.tag -}}
{{ printf "%s:%s" .Values.image.backend.repository $tag }}
{{- end -}}

{{- define "alcoves.frontend.image" -}}
{{- $tag := default .Chart.AppVersion .Values.image.frontend.tag -}}
{{ printf "%s:%s" .Values.image.frontend.repository $tag }}
{{- end -}}

{{/*
Names of generated secrets so we can reference them from envFrom blocks.
*/}}
{{- define "alcoves.appSecretName" -}}
{{- printf "%s-app" (include "alcoves.fullname" .) -}}
{{- end -}}

{{- define "alcoves.publicApiOrigin" -}}
{{- if .Values.frontend.publicApiOrigin -}}
{{- .Values.frontend.publicApiOrigin -}}
{{- else -}}
{{- .Values.baseUrl -}}
{{- end -}}
{{- end -}}
